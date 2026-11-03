import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class UpdateRoleDto {
  @ApiProperty({ enum: ['ADMIN', 'USER'] })
  @IsIn(['ADMIN', 'USER'])
  role!: 'ADMIN' | 'USER';
}
