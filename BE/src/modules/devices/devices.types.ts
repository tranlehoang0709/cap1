export type DeviceLifecycleStatus = 'available' | 'pending_approval' | 'assigned' | 'reset_pending' | 'maintenance';
export type ConnectionStatus = 'online' | 'offline';
export type PairingRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface DeviceRecord {
  id: string;
  device_uid: string;
  display_name: string | null;
  hardware_model: string | null;
  lifecycle_status: DeviceLifecycleStatus;
  connection_status: ConnectionStatus;
  last_seen_at: Date | null;
  battery_percent: number | null;
  wifi_rssi: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface PairingRequestRecord {
  id: string;
  device_id: string;
  user_id: string;
  status: PairingRequestStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  created_at: Date;
}

export interface DevicePrincipal { deviceId: string; deviceUid: string; }
