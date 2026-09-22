import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

/** Body for signup: create a new auth user and profile. */
export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

/** Body for login: exchange credentials for a session token. */
export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
