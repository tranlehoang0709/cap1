import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'mysql2/promise';
import { MYSQL_POOL } from './database.constants';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  getPool(): Pool {
    return this.pool;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
