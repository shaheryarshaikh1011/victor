/**
 * Frontend mirror of the backend supported (provider, model) allow-list.
 *
 * Used to populate the settings selection controls. The Backend_API remains the
 * authoritative validator and rejects unsupported pairs (Requirement 2.3); this
 * list only shapes the choices offered in the UI.
 */
import type { AIProviderName } from './types';

export const SUPPORTED_MODELS: Record<AIProviderName, string[]> = {
  gemini: ['gemini-1.5-flash', 'gemini-1.5-pro'],
  groq: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
  openrouter: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'],
};

export const SUPPORTED_PROVIDERS = Object.keys(
  SUPPORTED_MODELS,
) as AIProviderName[];
