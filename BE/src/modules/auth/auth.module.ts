import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../database/database.module';
import { UsersModule } from '../users/users.module';
import { AdminSeeder } from './admin-seeder.service';
import { AdminUsersController } from './admin-users.controller';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';

@Module({
  imports: [DatabaseModule, UsersModule, JwtModule.register({})],
  controllers: [AuthController, AdminUsersController],
  providers: [AuthRepository, AuthService, AdminSeeder],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
