/**
 * Frontend mirror of the backend supported (provider, model) allow-list.
 *
 * Used to populate the settings selection controls. The Backend_API remains the
 * authoritative validator and rejects unsupported pairs (Requirement 2.3); this
 * list only shapes the choices offered in the UI.
 */
import type { AIProviderName } from './types';

export const SUPPORTED_MODELS: Record<AIProviderName, string[]> = {
  gemini: ['gemini-3.6-flash', 'gemini-2.5-pro'],
  groq: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
  openrouter: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'],
};

export const SUPPORTED_PROVIDERS = Object.keys(
  SUPPORTED_MODELS,
) as AIProviderName[];
