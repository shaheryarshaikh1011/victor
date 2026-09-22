import { Logger } from '@nestjs/common';
import { contextWindowFor } from './allow-list';
import { AIProviderName } from './types';

/**
 * Normalized token usage for a single AI request, independent of provider
 * response shape.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Extracts token usage from an OpenAI-compatible `usage` block
 * (`prompt_tokens` / `completion_tokens` / `total_tokens`), as returned by the
 * Groq and OpenRouter chat completions APIs.
 */
export function usageFromOpenAI(usage: unknown): TokenUsage | undefined {
  if (typeof usage !== 'object' || usage === null) {
    return undefined;
  }
  const u = usage as Record<string, unknown>;
  const prompt = numberOr(u.prompt_tokens, 0);
  const completion = numberOr(u.completion_tokens, 0);
  const total = numberOr(u.total_tokens, prompt + completion);
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
  };
}

/**
 * Extracts token usage from a Gemini `usageMetadata` block
 * (`promptTokenCount` / `candidatesTokenCount` / `totalTokenCount`).
 */
export function usageFromGemini(usage: unknown): TokenUsage | undefined {
  if (typeof usage !== 'object' || usage === null) {
    return undefined;
  }
  const u = usage as Record<string, unknown>;
  const prompt = numberOr(u.promptTokenCount, 0);
  const completion = numberOr(u.candidatesTokenCount, 0);
  const total = numberOr(u.totalTokenCount, prompt + completion);
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
  };
}

/**
 * Logs token usage in one consistent, human-readable format across all
 * providers, expressing consumption against the model's context window:
 * how many tokens were used, the window size, the percent used, and how many
 * tokens remain.
 */
export function logTokenUsage(
  logger: Logger,
  provider: AIProviderName,
  model: string,
  usage: TokenUsage | undefined,
): void {
  if (!usage) {
    return;
  }
  const window = contextWindowFor(model);
  const used = usage.totalTokens;
  const remaining = Math.max(window - used, 0);
  const percentUsed = window > 0 ? (used / window) * 100 : 0;

  logger.log(
    `Token usage for ${provider}/${model}: ` +
      `${used.toLocaleString()} / ${window.toLocaleString()} tokens used ` +
      `(${percentUsed.toFixed(1)}%), ` +
      `${remaining.toLocaleString()} tokens left ` +
      `[prompt=${usage.promptTokens.toLocaleString()}, ` +
      `completion=${usage.completionTokens.toLocaleString()}]`,
  );
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}
