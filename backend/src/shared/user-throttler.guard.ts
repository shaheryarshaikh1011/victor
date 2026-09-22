import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';
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
  private readonly rateLogger = new Logger(UserThrottlerGuard.name);

  protected async getTracker(req: AuthenticatedRequest): Promise<string> {
    const userId = req[AUTH_USER_ID_KEY];
    if (userId) {
      return `user:${userId}`;
    }
    return `ip:${req.ip ?? 'unknown'}`;
  }

  /**
   * Performs the single rate-limit increment/decision and logs per-tracker
   * usage (hits vs limit) so consumption against the configured Rate_Limit is
   * observable. Increment happens exactly once per request to avoid distorting
   * the count.
   */
  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const { context, limit, ttl, throttler, blockDuration } = requestProps;
    const name = throttler.name ?? 'default';
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tracker = await this.getTracker(req);
    const key = this.generateKey(context, tracker, name);

    const { totalHits, timeToBlockExpire } =
      await this.storageService.increment(
        key,
        ttl,
        limit,
        blockDuration ?? 0,
        name,
      );

    this.rateLogger.log(
      `rate-limit tracker=${tracker} usage=${totalHits}/${limit} ttlMs=${ttl}`,
    );

    if (totalHits > limit) {
      await this.throwThrottlingException(context, {
        limit,
        ttl,
        key,
        tracker,
        totalHits,
        timeToExpire: timeToBlockExpire,
        isBlocked: true,
        timeToBlockExpire,
      });
    }

    return true;
  }
}
