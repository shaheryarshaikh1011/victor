import { AIProviderName, UserSettings } from './types';

/**
 * The supported (provider, model) allow-list for VICTOR V1.
 *
 * Settings updates and AI requests are validated against this list. Any pair
 * not present here is rejected (Requirements 2.3, 6.1). Keep this in sync with
 * the default model env vars documented in `.env.example`.
 */
export const SUPPORTED_MODELS: Readonly<Record<AIProviderName, readonly string[]>> = {
  gemini: ['gemini-3.6-flash', 'gemini-2.5-pro'],
  groq: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
  openrouter: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4.5'],
} as const;

/**
 * Context-window size (max tokens) per supported model. Used to express token
 * usage as a percentage of a model's capacity and how many tokens remain.
 */
export const MODEL_CONTEXT_WINDOW: Readonly<Record<string, number>> = {
  'gemini-3.6-flash': 1_048_576,
  'gemini-2.5-pro': 1_048_576,
  'openai/gpt-oss-20b': 131_072,
  'openai/gpt-oss-120b': 131_072,
  'openai/gpt-4o-mini': 128_000,
  'anthropic/claude-sonnet-4.5': 200_000,
} as const;

/** Fallback context window when a model is not listed above. */
export const DEFAULT_CONTEXT_WINDOW = 8_192;

/** Returns the context window (max tokens) for a model. */
export function contextWindowFor(model: string): number {
  return MODEL_CONTEXT_WINDOW[model] ?? DEFAULT_CONTEXT_WINDOW;
}

/** All supported provider names derived from the allow-list. */
export const SUPPORTED_PROVIDERS = Object.keys(
  SUPPORTED_MODELS,
) as AIProviderName[];

/** The default provider selected when a user has no explicit setting. */
export const DEFAULT_PROVIDER: AIProviderName = 'groq';

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

/**
 * The fast, cheap model used for background work (memory extraction, command
 * normalization, summaries, titles) regardless of the user's chat model.
 * Override with UTILITY_PROVIDER / UTILITY_MODEL; an unsupported pair falls
 * back to the default.
 */
export function utilitySettings(userId: string): UserSettings {
  const provider = process.env.UTILITY_PROVIDER ?? 'groq';
  const model = process.env.UTILITY_MODEL ?? 'openai/gpt-oss-20b';
  const valid = isSupportedModel(provider, model);
  return {
    userId,
    provider: valid ? provider : 'groq',
    model: valid ? model : 'openai/gpt-oss-20b',
    updatedAt: new Date(0).toISOString(),
  };
}
