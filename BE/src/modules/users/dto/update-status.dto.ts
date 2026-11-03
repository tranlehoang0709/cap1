import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class UpdateStatusDto {
  @ApiProperty({ enum: ['active', 'suspended', 'disabled'] })
  @IsIn(['active', 'suspended', 'disabled'])
  status!: 'active' | 'suspended' | 'disabled';
}
