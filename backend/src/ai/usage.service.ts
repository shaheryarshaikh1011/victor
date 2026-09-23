import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../auth/supabase.service';
import { AIProviderName, AIUsageKind, TokenUsage } from '../shared';

/**
 * Persists token usage per AI call to `usage_events` so cost can be tracked
 * per user and per purpose (chat vs background work). Writes are best-effort
 * and never affect the AI call they describe.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly supabase: SupabaseService) {}

  record(
    userId: string,
    kind: AIUsageKind,
    provider: AIProviderName,
    model: string,
    usage: TokenUsage,
  ): void {
    void Promise.resolve(
      this.supabase.admin.from('usage_events').insert({
        user_id: userId,
        kind,
        provider,
        model,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
      }),
    )
      .then(({ error }) => {
        if (error) {
          this.logger.warn(`Failed to record usage: ${error.message}`);
        }
      })
      .catch((err: Error) =>
        this.logger.warn(`Failed to record usage: ${err.message}`),
      );
  }
}
