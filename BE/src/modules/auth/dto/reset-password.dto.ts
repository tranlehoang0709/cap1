import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Mã OTP phải gồm đúng 6 chữ số.' })
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  new_password!: string;
}
