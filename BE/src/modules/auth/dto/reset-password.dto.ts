import { IsString, Length } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @Length(20, 2048)
  token!: string;

  @IsString()
  @Length(8, 128)
  new_password!: string;
}
