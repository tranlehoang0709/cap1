import { Injectable } from '@nestjs/common';
import { MonitoringRepository } from './monitoring.repository';

@Injectable()
export class MonitoringService {
  constructor(private readonly repo: MonitoringRepository) {}
  dashboard() { return this.repo.dashboard(); }
  instances() { return this.repo.instances(); }
  heartbeat(data: Record<string, unknown>) { return this.repo.heartbeat(data); }
  metrics(id: string, data: Record<string, unknown>) { return this.repo.metrics(id, data); }
}
