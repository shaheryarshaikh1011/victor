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

/** The kind of remembered information (Requirement 1.2). */
export type MemoryType =
  | 'explicit'
  | 'preference'
  | 'personal_fact'
  | 'episodic'
  | 'behavioral';

/** How a memory was captured. */
export type MemorySource = 'user_explicit' | 'auto_extracted';

/** Coarse retention/ranking signal (Requirement 1.3). */
export type Importance = 'low' | 'medium' | 'high';

/** Lifecycle status; superseded memories are soft-invalidated. */
export type MemoryStatus = 'active' | 'superseded';

/**
 * API-safe projection of a memory returned by the Backend_API (Requirement
 * 3.3). Mirrors the backend `MemoryView` and never exposes the embedding or
 * other internal database columns.
 */
export interface MemoryView {
  id: string;
  content: string;
  memoryType: MemoryType;
  source: MemorySource;
  sourceConversationId: string | null;
  importance: Importance;
  confidence: number;
  status: MemoryStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
}

/** Body accepted by `POST /memory`. */
export interface CreateMemoryInput {
  content: string;
  memoryType: MemoryType;
  importance?: Importance;
}

/** Body accepted by `PATCH /memory/:id`. */
export interface UpdateMemoryInput {
  content?: string;
  memoryType?: MemoryType;
  importance?: Importance;
}
