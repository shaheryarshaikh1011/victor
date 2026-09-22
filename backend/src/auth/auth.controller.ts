import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService, SessionResult, SignupResult } from './auth.service';
import { LoginDto, SignupDto } from './dto/auth.dto';

/**
 * Public authentication endpoints. These routes are intentionally unguarded so
 * a visitor can obtain a session (Requirements 1.1, 1.2, 1.3).
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  signup(@Body() dto: SignupDto): Promise<SignupResult> {
    return this.authService.signup(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<SessionResult> {
    return this.authService.login(dto);
  }
}
