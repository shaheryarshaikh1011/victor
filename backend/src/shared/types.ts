/**
 * Shared VICTOR V1 domain types.
 *
 * These interfaces model the persisted records and the AI request/response
 * contracts used across the backend modules (users, conversations, messages,
 * ai). They mirror the data models in the design document.
 */

/** Supported AI providers in V1. */
export type AIProviderName = 'gemini' | 'groq' | 'openrouter';

/** Role of a chat message. */
export type MessageRole = 'user' | 'assistant';

/** Role accepted by an AI provider request (includes system). */
export type AIMessageRole = 'user' | 'assistant' | 'system';

/**
 * profiles — 1:1 with the Supabase auth user.
 * `id` is the Authenticated_User_Id (Supabase auth uid).
 */
export interface Profile {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

/** user_settings — the caller's provider/model preferences. */
export interface UserSettings {
  userId: string;
  provider: AIProviderName;
  model: string;
  updatedAt: string;
}

/** conversations — a container owned by a single user. */
export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** messages — a unit of chat content belonging to one conversation. */
export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

/** A request submitted to an AI provider. */
export interface AIRequest {
  model: string;
  messages: { role: AIMessageRole; content: string }[];
  temperature?: number;
}

/** A completed (non-streamed) AI response. */
export interface AIResult {
  content: string;
  provider: AIProviderName;
  model: string;
}

/** A single streamed unit from an AI provider. */
export type AIChunk =
  | { type: 'chunk'; content: string }
  | { type: 'error'; message: string };

/**
 * The AIProvider interface implemented by GeminiProvider, GroqProvider, and
 * OpenRouterProvider. Defined here so all modules share one contract.
 */
export interface AIProvider {
  readonly name: AIProviderName;
  generate(request: AIRequest): Promise<AIResult>;
  stream(request: AIRequest): AsyncIterable<AIChunk>;
  getAvailableModels(): Promise<string[]>;
}
