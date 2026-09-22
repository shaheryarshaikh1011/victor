import { Logger } from '@nestjs/common';
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

/** Logs token usage in one consistent format across all providers. */
export function logTokenUsage(
  logger: Logger,
  provider: AIProviderName,
  model: string,
  usage: TokenUsage | undefined,
): void {
  if (!usage) {
    return;
  }
  logger.log(
    `usage provider=${provider} model=${model} ` +
      `promptTokens=${usage.promptTokens} ` +
      `completionTokens=${usage.completionTokens} ` +
      `totalTokens=${usage.totalTokens}`,
  );
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}
