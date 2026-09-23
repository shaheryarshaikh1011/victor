import { Injectable } from '@nestjs/common';
import {
  AIChunk,
  AIRequest,
  AIResult,
  AIUsageKind,
  UserSettings,
  utilitySettings,
} from '../shared';
import { AIRouter } from './ai-router';
import { UsageService } from './usage.service';

/**
 * AIService — the single backend facade for AI generation (Requirement 5.1).
 *
 * It exposes `generate()` and `stream()` operations to the rest of the backend
 * and delegates provider selection and bounded fallback to the {@link AIRouter}.
 * Every call's token usage is recorded under a {@link AIUsageKind}. Callers
 * depend only on this facade, keeping the concrete providers and the routing
 * logic replaceable.
 */
@Injectable()
export class AIService {
  constructor(
    private readonly router: AIRouter,
    private readonly usage: UsageService,
  ) {}

  /**
   * Produces a completed (non-streamed) AI response for the request, using the
   * provider/model resolved from the caller's settings with bounded fallback.
   */
  async generate(
    request: AIRequest,
    settings: UserSettings,
    kind: AIUsageKind = 'chat',
  ): Promise<AIResult> {
    const result = await this.router.generate(request, settings);
    if (result.usage) {
      this.usage.record(
        settings.userId,
        kind,
        result.provider,
        result.model,
        result.usage,
      );
    }
    return result;
  }

  /**
   * Runs a short background task (extraction, summary, title) on the cheap
   * utility model rather than the user's chat model. Returns the trimmed text.
   */
  async generateUtility(
    userId: string,
    kind: AIUsageKind,
    system: string,
    user: string,
  ): Promise<string> {
    const settings = utilitySettings(userId);
    const result = await this.generate(
      {
        model: settings.model,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      settings,
      kind,
    );
    return result.content.trim();
  }

  /**
   * Produces an ordered sequence of streamed chunks for the request, using the
   * provider/model resolved from the caller's settings with bounded fallback.
   * Usage chunks are recorded here and never forwarded to callers.
   */
  async *stream(
    request: AIRequest,
    settings: UserSettings,
    kind: AIUsageKind = 'chat',
  ): AsyncIterable<Exclude<AIChunk, { type: 'usage' }>> {
    for await (const chunk of this.router.stream(request, settings)) {
      if (chunk.type === 'usage') {
        this.usage.record(
          settings.userId,
          kind,
          chunk.provider,
          chunk.model,
          chunk.usage,
        );
        continue;
      }
      yield chunk;
    }
  }
}
