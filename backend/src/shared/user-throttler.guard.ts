import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  AUTH_USER_ID_KEY,
  AuthenticatedRequest,
} from '../auth/supabase-auth.guard';

/**
 * Rate-limit guard keyed on the Authenticated_User_Id.
 *
 * The default ThrottlerGuard tracks requests per client IP; VICTOR limits per
 * user so a single account cannot exceed the configured Rate_Limit regardless
 * of source address (Requirement 9.2). When no session id is present the guard
 * falls back to the request IP so unauthenticated traffic is still bounded.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: AuthenticatedRequest): Promise<string> {
    const userId = req[AUTH_USER_ID_KEY];
    if (userId) {
      return `user:${userId}`;
    }
    return `ip:${req.ip ?? 'unknown'}`;
  }
}
