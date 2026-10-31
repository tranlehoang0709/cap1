import { BadRequestException, ConflictException, ForbiddenException, HttpException,
  Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CurrentUser } from '../auth/access-role.guard';
import { CreatePairingDto, PairingListDto, ReviewPairingDto, pairingCode, pairingId } from './dto/pairing.dto';
import { PairingRepository, PairingTransaction } from './pairing.repository';
import { PairingCode, PairingDevice } from './pairing.types';

@Injectable()
export class PairingService {
  constructor(private readonly repository: PairingRepository) {}

  private requireRole(actor: CurrentUser, role: 'ADMIN' | 'USER') {
    if (!actor || actor.role !== role) throw new ForbiddenException('Required role missing');
    pairingId(actor.userId);
  }

  private async authorizeTransaction(tx: PairingTransaction, actor: CurrentUser, requesterId?: string) {
    // Match UsersService's ascending user lock order. Reuse its public user/role repository.
    const ids = [...new Set([actor.userId, ...(requesterId ? [requesterId] : [])])]
      .sort((a,b) => BigInt(a) < BigInt(b) ? -1 : 1);
    for (const id of ids) {
      const user = await tx.users.findByIdForUpdate(id);
      const roles = user ? await tx.users.findUserRoles(id) : [];
      const expectedRole = id === actor.userId ? actor.role : 'USER';
      const eligible = user && user.status === 'active' && user.email_verified_at !== null
        && roles.length === 1 && roles[0].code === expectedRole;
      if (!eligible) {
        if (id === actor.userId) throw new ForbiddenException('Active verified account with the required role is required');
        throw new ConflictException('Requesting User is no longer eligible');
      }
    }
  }

  /** SHA-256 lowercase hex, exact case-sensitive code bytes; provisioning contract. */
  async validatePairingCode(tx: PairingTransaction, raw: unknown): Promise<PairingCode> {
    const code = pairingCode(raw);
    const hash = createHash('sha256').update(code, 'utf8').digest('hex');
    const found = await tx.findCodeByHash(hash);
    if (!found || !found.usable) throw new BadRequestException('Invalid or unavailable pairing code');
    return found;
  }

  private async checkDeviceEligibility(tx: PairingTransaction, device: PairingDevice, code: PairingCode) {
    if (!['available', 'pending_approval'].includes(device.lifecycleStatus)) {
      throw new ConflictException('Device lifecycle does not allow pairing');
    }
    if (await tx.getActiveAssignment(device.id)) throw new ConflictException('Device already has an owner');
    if (!await tx.resetAllowsPairing(device.id, code.createdAt)) {
      throw new ConflictException('Confirmed reset and a fresh pairing code are required');
    }
  }

  async createPairingRequest(actor: CurrentUser, body: unknown) {
    this.requireRole(actor, 'USER');
    const codeText = CreatePairingDto.parse(body);
    return this.databaseOperation(() => this.repository.withTransaction(async tx => {
      const candidate = await this.validatePairingCode(tx, codeText);
      const device = await tx.findDeviceById(candidate.deviceId);
      if (!device) throw new BadRequestException('Invalid or unavailable pairing code');
      await this.authorizeTransaction(tx, actor);
      const code = await tx.lockCode(candidate.id);
      if (!code || code.deviceId !== device.id || !code.usable) {
        throw new BadRequestException('Invalid or unavailable pairing code');
      }
      await this.checkDeviceEligibility(tx, device, code);
      if (await tx.hasPendingRequest(device.id, actor.userId)) {
        throw new ConflictException('A pending request already exists for this User and device');
      }
      const id = await tx.createRequest(device.id, actor.userId, code.id);
      await tx.setLifecycle(device.id, 'pending_approval');
      await tx.writePairingRequestAudit(actor.userId,id,device.id);
      return {id, deviceId:device.id, status:'PENDING' as const};
    }));
  }

  async listPairingRequests(actor: CurrentUser, input: Record<string, unknown>) {
    if (!actor || !['ADMIN','USER'].includes(actor.role)) throw new ForbiddenException('Required role missing');
    pairingId(actor.userId);
    const filters = PairingListDto.parse(input);
    return this.databaseOperation(() => this.repository.list(filters, actor.role === 'USER' ? actor.userId : undefined));
  }

  async approvePairing(requestId: unknown, actor: CurrentUser, body: unknown) {
    this.requireRole(actor, 'ADMIN');
    const id = pairingId(requestId);
    const note = ReviewPairingDto.parse(body);
    return this.databaseOperation(() => this.repository.withTransaction(async tx => {
      const candidate = await tx.findRequest(id);
      if (!candidate) throw new NotFoundException('Pairing request not found');
      const device = await tx.findDeviceById(candidate.deviceId);
      if (!device) throw new NotFoundException('Device not found');
      const request = await tx.findRequest(id, true);
      if (!request || request.deviceId !== device.id || request.status !== 'pending') {
        throw new ConflictException('Pairing request is no longer pending');
      }
      await this.authorizeTransaction(tx, actor, request.userId);
      const code = await tx.lockCode(request.pairingCodeId);
      if (!code || code.deviceId !== device.id || !code.usable) {
        throw new ConflictException('Pairing code expired, revoked or consumed');
      }
      await this.checkDeviceEligibility(tx, device, code);
      // Consume with a final expiry predicate in the same transaction before assigning.
      await tx.consumeCode(code.id);
      await tx.createAssignment(request, actor.userId);
      await tx.reviewRequest(request.id, 'approved', actor.userId, note);
      await tx.setLifecycle(device.id, 'assigned');
      await tx.writePairingAudit(actor.userId, request, 'approved', note);
      return {status:'APPROVED' as const, assignment:{deviceId:device.id,userId:request.userId}};
    }));
  }

  async rejectPairing(requestId: unknown, actor: CurrentUser, body: unknown) {
    this.requireRole(actor, 'ADMIN');
    const id = pairingId(requestId);
    const note = ReviewPairingDto.parse(body);
    return this.databaseOperation(() => this.repository.withTransaction(async tx => {
      const candidate = await tx.findRequest(id);
      if (!candidate) throw new NotFoundException('Pairing request not found');
      const device = await tx.findDeviceById(candidate.deviceId);
      if (!device) throw new NotFoundException('Device not found');
      const request = await tx.findRequest(id, true);
      if (!request || request.deviceId !== device.id || request.status !== 'pending') {
        throw new ConflictException('Pairing request is no longer pending');
      }
      await this.authorizeTransaction(tx, actor);
      await tx.reviewRequest(id, 'rejected', actor.userId, note);
      if (device.lifecycleStatus === 'pending_approval'
        && !await tx.getActiveAssignment(device.id) && !await tx.hasAnyPending(device.id)) {
        await tx.setLifecycle(device.id, 'available');
      }
      await tx.writePairingAudit(actor.userId, request, 'rejected', note);
      return {status:'REJECTED' as const,reviewNote:note};
    }));
  }

  private async databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      const code = (error as {code?:string})?.code;
      if (['ER_DUP_ENTRY','ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT','PAIRING_CONFLICT'].includes(code ?? '')) {
        throw new ConflictException('Pairing state changed concurrently; refresh before retrying');
      }
      throw new InternalServerErrorException('Unable to process pairing request');
    }
  }
}
