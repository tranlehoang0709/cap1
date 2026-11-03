import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdatePrivacyDto {
  @ApiProperty({ description: 'Whether conversation history may be stored' })
  @IsBoolean()
  save_history!: boolean;
}
