import { Injectable, Logger } from '@nestjs/common';
import {
  AIChunk,
  AIProvider,
  AIProviderName,
  AIRequest,
  AIResult,
  UserSettings,
} from '../shared';
import { GeminiProvider } from './gemini.provider';
import { GroqProvider } from './groq.provider';
import { OpenRouterProvider } from './openrouter.provider';

/**
 * Error surfaced when every configured AI_Provider fails for a request
 * (Requirement 6.3). The AI_Router returns exactly one of these after
 * exhausting the ordered provider list.
 */
export class AIUnavailableError extends Error {
  constructor(message = 'All AI providers failed to produce a response') {
    super(message);
    this.name = 'AIUnavailableError';
  }
}

/** The fixed fallback order used to append secondary/tertiary providers. */
const FALLBACK_ORDER: readonly AIProviderName[] = [
  'gemini',
  'groq',
  'openrouter',
];

/** Consecutive failures after which a provider is skipped for a while. */
const BREAKER_THRESHOLD = 3;

/** How long a tripped provider is skipped before it is tried again. */
const BREAKER_COOLDOWN_MS = 60_000;

interface ProviderHealth {
  failures: number;
  openUntil: number;
}

/**
 * AIRouter — selects the AI_Provider and model configured for a user and
 * performs bounded, ordered fallback across the remaining providers.
 *
 * Selection: the primary provider/model comes from the user's settings
 * (Requirement 6.1). Fallback: on failure or rate-limit, the router attempts
 * the secondary then tertiary providers in a fixed order (Requirement 6.2),
 * attempting each provider at most once per request (Requirement 6.4). If every
 * provider fails, the router returns a single {@link AIUnavailableError}
 * (Requirement 6.3).
 */
@Injectable()
export class AIRouter {
  private readonly logger = new Logger(AIRouter.name);
  private readonly providers: Record<AIProviderName, AIProvider>;
  /**
   * Circuit breaker state per provider. A provider that keeps failing is
   * skipped until its cooldown expires, so requests stop paying its latency.
   */
  private readonly health = new Map<AIProviderName, ProviderHealth>();

  constructor(
    gemini: GeminiProvider,
    groq: GroqProvider,
    openrouter: OpenRouterProvider,
  ) {
    this.providers = { gemini, groq, openrouter };
  }

  /**
   * Resolves the ordered list of (provider, model) attempts for a request.
   * The primary is the user's configured provider/model; the remaining
   * providers follow in the fixed fallback order, each appearing at most once.
   * Fallback providers use their first available model as the request model.
   */
  resolveProviderOrder(settings: UserSettings): {
    name: AIProviderName;
    provider: AIProvider;
    model: string;
  }[] {
    const primaryName = settings.provider;
    const orderedNames: AIProviderName[] = [
      primaryName,
      ...FALLBACK_ORDER.filter((name) => name !== primaryName),
    ];

    return orderedNames.map((name) => ({
      name,
      provider: this.providers[name],
      model: name === primaryName ? settings.model : '',
    }));
  }

  /**
   * Generates a completion, trying each configured provider in order until one
   * succeeds. Throws {@link AIUnavailableError} if all providers fail.
   */
  async generate(
    request: AIRequest,
    settings: UserSettings,
  ): Promise<AIResult> {
    const attempts = await this.buildAttempts(request, settings);

    for (const attempt of attempts) {
      try {
        this.logger.log(
          `generate attempt provider=${attempt.name} model=${attempt.request.model}`,
        );
        const result = await attempt.provider.generate(attempt.request);
        this.logger.log(
          `generate success provider=${attempt.name} model=${attempt.request.model}`,
        );
        this.recordSuccess(attempt.name);
        return result;
      } catch (err) {
        if (request.signal?.aborted) {
          throw err;
        }
        // Provider failed or was rate limited; fall through to the next.
        this.logger.warn(
          `generate failed provider=${attempt.name} model=${attempt.request.model}`,
        );
        this.recordFailure(attempt.name);
        continue;
      }
    }

    this.logger.error('generate exhausted all providers');
    throw new AIUnavailableError();
  }

  /**
   * Streams a completion, trying each configured provider in order. If a
   * provider's stream yields no error chunk, its chunks are forwarded and the
   * stream completes. If a provider errors (thrown or an error chunk before any
   * content), the router advances to the next provider. When all providers
   * fail, a single error chunk is emitted (Requirement 6.3).
   */
  async *stream(
    request: AIRequest,
    settings: UserSettings,
  ): AsyncIterable<AIChunk> {
    const attempts = await this.buildAttempts(request, settings);

    for (const attempt of attempts) {
      let produced = false;
      let failed = false;

      this.logger.log(
        `stream attempt provider=${attempt.name} model=${attempt.request.model}`,
      );
      try {
        for await (const chunk of attempt.provider.stream(attempt.request)) {
          if (chunk.type === 'usage') {
            yield chunk;
            continue;
          }
          if (chunk.type === 'error') {
            failed = true;
            // If content already streamed, we cannot restart on another
            // provider without duplicating output, so surface the error.
            if (produced) {
              yield chunk;
              return;
            }
            break;
          }
          produced = true;
          yield chunk;
        }
      } catch {
        failed = true;
      }

      if (!failed) {
        this.logger.log(
          `stream success provider=${attempt.name} model=${attempt.request.model}`,
        );
        this.recordSuccess(attempt.name);
        return;
      }
      if (request.signal?.aborted) {
        // The client went away; neither a failure nor worth a fallback.
        return;
      }
      this.logger.warn(
        `stream failed provider=${attempt.name} model=${attempt.request.model}`,
      );
      this.recordFailure(attempt.name);
      if (produced) {
        return;
      }
      // No content produced yet; try the next provider.
    }

    this.logger.error('stream exhausted all providers');
    yield { type: 'error', message: new AIUnavailableError().message };
  }

  /**
   * Builds the ordered per-provider requests. Each fallback provider uses its
   * first available model in place of the primary model.
   */
  private async buildAttempts(
    request: AIRequest,
    settings: UserSettings,
  ): Promise<
    { name: AIProviderName; provider: AIProvider; request: AIRequest }[]
  > {
    const order = this.skipTripped(this.resolveProviderOrder(settings));
    const attempts: {
      name: AIProviderName;
      provider: AIProvider;
      request: AIRequest;
    }[] = [];

    for (const { name, provider, model } of order) {
      const resolvedModel =
        model !== '' ? model : (await provider.getAvailableModels())[0];
      attempts.push({
        name,
        provider,
        request: { ...request, model: resolvedModel },
      });
    }

    this.logger.log(
      `resolved providers for user=${settings.userId}: ` +
        attempts
          .map((a) => `${a.name}(${a.request.model})`)
          .join(' -> '),
    );

    return attempts;
  }

  /**
   * Drops providers whose breaker is open, keeping the order. If every
   * provider is tripped the full order is returned so requests can still
   * probe for recovery.
   */
  private skipTripped<T extends { name: AIProviderName }>(order: T[]): T[] {
    const now = Date.now();
    const healthy = order.filter(
      ({ name }) => (this.health.get(name)?.openUntil ?? 0) <= now,
    );
    if (healthy.length < order.length) {
      this.logger.warn(
        `skipping tripped providers: ${order
          .filter((o) => !healthy.includes(o))
          .map((o) => o.name)
          .join(', ')}`,
      );
    }
    return healthy.length > 0 ? healthy : order;
  }

  private recordSuccess(name: AIProviderName): void {
    this.health.delete(name);
  }

  private recordFailure(name: AIProviderName): void {
    const state = this.health.get(name) ?? { failures: 0, openUntil: 0 };
    state.failures += 1;
    if (state.failures >= BREAKER_THRESHOLD) {
      state.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
      state.failures = 0;
      this.logger.warn(
        `provider ${name} tripped; skipping for ${BREAKER_COOLDOWN_MS / 1000}s`,
      );
    }
    this.health.set(name, state);
  }
}
