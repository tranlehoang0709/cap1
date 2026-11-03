import { ApiProperty } from '@nestjs/swagger';
import { IsJWT, IsString } from 'class-validator';

export class RefreshDto {
  @ApiProperty({ writeOnly: true })
  @IsString()
  @IsJWT()
  refresh_token!: string;
}
