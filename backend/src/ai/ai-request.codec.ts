import { Injectable } from '@nestjs/common';
import { AIMessageRole, AIRequest } from '../shared';

const VALID_ROLES: readonly AIMessageRole[] = ['user', 'assistant', 'system'];

/**
 * AIRequestCodec — serializes an {@link AIRequest} to a provider payload string
 * and parses it back.
 *
 * The codec guarantees that `decode(encode(request))` yields a request
 * equivalent to the original (Requirement 5.3, Property 11). Encoding produces a
 * canonical JSON form: only the defined fields are included, and `temperature`
 * is omitted when it is `undefined` so the round trip preserves equivalence.
 */
@Injectable()
export class AIRequestCodec {
  encode(request: AIRequest): string {
    const canonical: {
      model: string;
      messages: { role: AIMessageRole; content: string }[];
      temperature?: number;
    } = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
    if (request.temperature !== undefined) {
      canonical.temperature = request.temperature;
    }
    return JSON.stringify(canonical);
  }

  decode(payload: string): AIRequest {
    const parsed = JSON.parse(payload) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Invalid AI request payload: not an object');
    }

    const obj = parsed as Record<string, unknown>;
    if (typeof obj.model !== 'string') {
      throw new Error('Invalid AI request payload: missing model');
    }
    if (!Array.isArray(obj.messages)) {
      throw new Error('Invalid AI request payload: messages must be an array');
    }

    const messages = obj.messages.map((entry) => {
      const m = entry as Record<string, unknown>;
      if (
        typeof m.role !== 'string' ||
        !VALID_ROLES.includes(m.role as AIMessageRole)
      ) {
        throw new Error('Invalid AI request payload: invalid message role');
      }
      if (typeof m.content !== 'string') {
        throw new Error('Invalid AI request payload: invalid message content');
      }
      return { role: m.role as AIMessageRole, content: m.content };
    });

    const request: AIRequest = { model: obj.model, messages };
    if (typeof obj.temperature === 'number') {
      request.temperature = obj.temperature;
    }
    return request;
  }
}
