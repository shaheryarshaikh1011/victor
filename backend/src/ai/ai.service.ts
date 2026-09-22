import { Injectable } from '@nestjs/common';
import { AIChunk, AIRequest, AIResult, UserSettings } from '../shared';
import { AIRouter } from './ai-router';

/**
 * AIService — the single backend facade for AI generation (Requirement 5.1).
 *
 * It exposes `generate()` and `stream()` operations to the rest of the backend
 * and delegates provider selection and bounded fallback to the {@link AIRouter}.
 * Callers depend only on this facade, keeping the concrete providers and the
 * routing logic replaceable.
 */
@Injectable()
export class AIService {
  constructor(private readonly router: AIRouter) {}

  /**
   * Produces a completed (non-streamed) AI response for the request, using the
   * provider/model resolved from the caller's settings with bounded fallback.
   */
  generate(request: AIRequest, settings: UserSettings): Promise<AIResult> {
    return this.router.generate(request, settings);
  }

  /**
   * Produces an ordered sequence of streamed chunks for the request, using the
   * provider/model resolved from the caller's settings with bounded fallback.
   */
  stream(request: AIRequest, settings: UserSettings): AsyncIterable<AIChunk> {
    return this.router.stream(request, settings);
  }
}
