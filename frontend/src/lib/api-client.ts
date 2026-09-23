/**
 * apiClient — the single seam through which the Web_Client reaches the
 * Backend_API.
 *
 * The client attaches the stored session token as a Bearer header on every
 * request (Requirement 1.3). It never holds or forwards AI provider credentials
 * (Requirement 5.4); those remain backend-only. All AI responses are obtained
 * through the Backend_API rather than by contacting a provider directly.
 */
import { getAccessToken } from './session';
import type {
  Conversation,
  CreateMemoryInput,
  Message,
  MemoryType,
  MemoryView,
  Profile,
  SessionResult,
  SignupResult,
  UpdateMemoryInput,
  UpdateSettingsInput,
  UserSettings,
} from './types';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

/** Error thrown for non-2xx responses, carrying the HTTP status. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** When false, the request is sent without a session token (auth routes). */
  auth?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (auth) {
    const token = getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ApiError(response.status, await extractErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as {
      error?: { message?: string };
      message?: string;
    };
    return data.error?.message ?? data.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

export const apiClient = {
  // --- Auth (unauthenticated routes) ---
  signup(input: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<SignupResult> {
    return request<SignupResult>('/auth/signup', {
      method: 'POST',
      body: input,
      auth: false,
    });
  },

  login(input: { email: string; password: string }): Promise<SessionResult> {
    return request<SessionResult>('/auth/login', {
      method: 'POST',
      body: input,
      auth: false,
    });
  },

  // --- Users ---
  getProfile(): Promise<Profile> {
    return request<Profile>('/users/me');
  },

  getSettings(): Promise<UserSettings> {
    return request<UserSettings>('/users/me/settings');
  },

  updateSettings(input: UpdateSettingsInput): Promise<UserSettings> {
    return request<UserSettings>('/users/me/settings', {
      method: 'PATCH',
      body: input,
    });
  },

  // --- Conversations ---
  listConversations(): Promise<Conversation[]> {
    return request<Conversation[]>('/conversations');
  },

  createConversation(input: { title?: string } = {}): Promise<Conversation> {
    return request<Conversation>('/conversations', {
      method: 'POST',
      body: input,
    });
  },

  deleteConversation(id: string): Promise<void> {
    return request<void>(`/conversations/${id}`, { method: 'DELETE' });
  },

  listMessages(conversationId: string): Promise<Message[]> {
    return request<Message[]>(`/conversations/${conversationId}/messages`);
  },

  /**
   * Opens the SSE send stream for a conversation. Returns the raw `Response`
   * whose body carries the ordered assistant chunks (Requirements 7.1, 7.2).
   * The session token is attached; provider credentials are never sent.
   */
  streamSend(conversationId: string, content: string): Promise<Response> {
    return openStream(`/conversations/${conversationId}/messages`, { content });
  },

  /**
   * Opens the SSE regenerate stream for an assistant message, requesting a new
   * reply for the preceding user message (Requirement 8.4).
   */
  streamRegenerate(
    conversationId: string,
    messageId: string,
  ): Promise<Response> {
    return openStream(
      `/conversations/${conversationId}/messages/${messageId}/regenerate`,
      undefined,
    );
  },

  // --- Memory (Requirement 3) ---
  /**
   * List the caller's memories with optional type and text-search filtering
   * (Requirements 3.1, 3.2). The response is the API-safe `MemoryView` and
   * never includes embeddings.
   */
  listMemories(
    params: { memoryType?: MemoryType; search?: string } = {},
  ): Promise<MemoryView[]> {
    const query = new URLSearchParams();
    if (params.memoryType) {
      query.set('memory_type', params.memoryType);
    }
    if (params.search) {
      query.set('search', params.search);
    }
    const suffix = query.toString();
    return request<MemoryView[]>(`/memory${suffix ? `?${suffix}` : ''}`);
  },

  getMemory(id: string): Promise<MemoryView> {
    return request<MemoryView>(`/memory/${id}`);
  },

  createMemory(input: CreateMemoryInput): Promise<MemoryView> {
    return request<MemoryView>('/memory', { method: 'POST', body: input });
  },

  updateMemory(id: string, input: UpdateMemoryInput): Promise<MemoryView> {
    return request<MemoryView>(`/memory/${id}`, {
      method: 'PATCH',
      body: input,
    });
  },

  deleteMemory(id: string): Promise<void> {
    return request<void>(`/memory/${id}`, { method: 'DELETE' });
  },

  deleteAllMemories(): Promise<void> {
    return request<void>('/memory', { method: 'DELETE' });
  },
};

/** Opens an authenticated POST stream, throwing {@link ApiError} on failure. */
async function openStream(
  path: string,
  body: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ApiError(response.status, await extractErrorMessage(response));
  }
  return response;
}
