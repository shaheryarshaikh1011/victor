/**
 * Session token storage for the Web_Client.
 *
 * The Web_Client only ever holds the user's Supabase session token so it can
 * authenticate against the Backend_API (Requirement 1.3). It never stores or
 * transmits AI provider credentials (Requirement 5.4) — those live exclusively
 * in the backend environment.
 */

const ACCESS_TOKEN_KEY = 'victor.accessToken';

/** The persisted session token, or null when the user is not authenticated. */
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

/** Persist the session token after a successful login. */
export function setAccessToken(token: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

/** Clear the session token on logout or when a session expires. */
export function clearAccessToken(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
}
