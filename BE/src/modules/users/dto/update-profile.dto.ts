import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiProperty({ example: 'Nguyen Van A' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  display_name!: string;
}
