import { Injectable, NotFoundException } from '@nestjs/common';
import { InternalApiRepository } from './internal-api.repository';
@Injectable() export class InternalApiService { constructor(private readonly repo:InternalApiRepository){} createSession(d:Record<string,unknown>){return this.repo.createSession(d)} async updateSession(id:string,d:Record<string,unknown>){const r=await this.repo.updateSession(id,d);if(!r)throw new NotFoundException('AI session was not found');return r} usage(d:Record<string,unknown>){return this.repo.usage(d)} }
