import { Injectable } from '@nestjs/common';
import { LogsRepository } from './logs.repository';

@Injectable()
export class LogsService {
  constructor(private readonly repo: LogsRepository) {}
  ingest(data: Record<string, unknown>) { return this.repo.ingest(data); }
  system(page: number, limit: number, severity?: string, component?: string) { return this.repo.system(page, limit, severity, component); }
  audit(page: number, limit: number) { return this.repo.audit(page, limit); }
}
