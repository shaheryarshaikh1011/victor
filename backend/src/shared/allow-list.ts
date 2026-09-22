import { AIProviderName } from './types';

/**
 * The supported (provider, model) allow-list for VICTOR V1.
 *
 * Settings updates and AI requests are validated against this list. Any pair
 * not present here is rejected (Requirements 2.3, 6.1). Keep this in sync with
 * the default model env vars documented in `.env.example`.
 */
export const SUPPORTED_MODELS: Readonly<Record<AIProviderName, readonly string[]>> = {
  gemini: ['gemini-1.5-flash', 'gemini-1.5-pro'],
  groq: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
  openrouter: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'],
} as const;

/** All supported provider names derived from the allow-list. */
export const SUPPORTED_PROVIDERS = Object.keys(
  SUPPORTED_MODELS,
) as AIProviderName[];

/** The default provider selected when a user has no explicit setting. */
export const DEFAULT_PROVIDER: AIProviderName = 'gemini';

/** The default model for the default provider. */
export const DEFAULT_MODEL: string = SUPPORTED_MODELS[DEFAULT_PROVIDER][0];

/**
 * Returns true when the given (provider, model) pair is present in the
 * allow-list.
 */
export function isSupportedModel(
  provider: string,
  model: string,
): provider is AIProviderName {
  const models = (SUPPORTED_MODELS as Record<string, readonly string[]>)[
    provider
  ];
  return models !== undefined && models.includes(model);
}
