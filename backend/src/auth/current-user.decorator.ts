import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  AUTH_USER_ID_KEY,
  AuthenticatedRequest,
} from './supabase-auth.guard';

/**
 * Injects the session-derived Authenticated_User_Id into a route handler.
 *
 * This value comes exclusively from the verified session attached by
 * `SupabaseAuthGuard`, so any `userId` present in the request body is ignored
 * in favor of the trusted session id (Requirement 1.5).
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    const userId = request[AUTH_USER_ID_KEY];
    if (!userId) {
      // Reaching a handler without an authenticated id means the guard was not
      // applied; fail loudly rather than trusting untrusted input.
      throw new InternalServerErrorException(
        'Authenticated user id is not available on the request',
      );
    }
    return userId;
  },
);
