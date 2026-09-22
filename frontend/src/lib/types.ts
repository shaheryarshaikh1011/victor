/**
 * Frontend-facing view of the Backend_API contracts.
 *
 * These mirror the backend `shared/types.ts` and auth service result shapes so
 * the API client stays typed without importing across package boundaries.
 */

export type AIProviderName = 'gemini' | 'groq' | 'openrouter';

export type MessageRole = 'user' | 'assistant';

export interface Profile {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

export interface UserSettings {
  userId: string;
  provider: AIProviderName;
  model: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

/** Body accepted by `PATCH /users/me/settings`. */
export interface UpdateSettingsInput {
  provider: string;
  model: string;
}

/** Result returned by `POST /auth/login`. */
export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
}

/** Result returned by `POST /auth/signup`. */
export interface SignupResult {
  profile: Profile;
}
