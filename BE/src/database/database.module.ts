import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createPool, Pool } from 'mysql2/promise';
import { MYSQL_POOL } from './database.constants';
import { DatabaseService } from './database.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MYSQL_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => createPool({
        host: config.getOrThrow<string>('database.host'),
        port: config.getOrThrow<number>('database.port'),
        user: config.getOrThrow<string>('database.user'),
        password: config.getOrThrow<string>('database.password'),
        database: config.getOrThrow<string>('database.name'),
        waitForConnections: true,
        connectionLimit: config.getOrThrow<number>('database.connectionLimit'),
        supportBigNumbers: true,
        bigNumberStrings: true,
        timezone: 'Z',
      }),
    },
    DatabaseService,
  ],
  exports: [MYSQL_POOL, DatabaseService],
})
export class DatabaseModule {}

