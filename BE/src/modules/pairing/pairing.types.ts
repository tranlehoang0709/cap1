import { RequestStatus } from './dto/pairing.dto';

export interface PairingRequest {
  id: string;
  deviceId: string;
  userId: string;
  pairingCodeId: string;
  status: RequestStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface PairingCode {
  id: string;
  deviceId: string;
  usable: number;
  createdAt: Date;
}

export interface PairingDevice { id: string; lifecycleStatus: string }
export interface ActiveAssignment { deviceId: string; userId: string }
