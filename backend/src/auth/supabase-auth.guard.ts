import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { SupabaseService } from './supabase.service';

/** The request property under which the verified user id is attached. */
export const AUTH_USER_ID_KEY = 'authenticatedUserId';

/** Request augmented with the session-derived Authenticated_User_Id. */
export interface AuthenticatedRequest extends Request {
  [AUTH_USER_ID_KEY]?: string;
}

/**
 * Verifies the Supabase bearer token on each request. On success the
 * Authenticated_User_Id derived from the verified session is attached to the
 * request context (Requirement 1.5). Missing or invalid tokens are rejected
 * with a 401 (Requirement 1.4).
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing session token');
    }

    const user = await this.supabase.getUserFromToken(token);
    if (!user) {
      throw new UnauthorizedException('Invalid session token');
    }

    // Derive the user id from the verified session; ignore any body-supplied id.
    request[AUTH_USER_ID_KEY] = user.id;
    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const header = request.headers['authorization'];
    if (!header || typeof header !== 'string') {
      return null;
    }
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) {
      return null;
    }
    return value.trim();
  }
}
