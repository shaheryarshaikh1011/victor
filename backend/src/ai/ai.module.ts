import { Module } from '@nestjs/common';
import { GeminiProvider } from './gemini.provider';
import { GroqProvider } from './groq.provider';
import { OpenRouterProvider } from './openrouter.provider';
import { AIRequestCodec } from './ai-request.codec';
import { AIRouter } from './ai-router';
import { AIService } from './ai.service';
import { PromptBuilder } from './prompt-builder';
import { UsageService } from './usage.service';

/**
 * AIModule provides the AI provider implementations, the request codec, the
 * AIRouter (selection + bounded fallback), and the AIService facade that
 * backend callers depend on for generation and streaming.
 */
@Module({
  providers: [
    GeminiProvider,
    GroqProvider,
    OpenRouterProvider,
    AIRequestCodec,
    AIRouter,
    AIService,
    UsageService,
    PromptBuilder,
  ],
  exports: [
    GeminiProvider,
    GroqProvider,
    OpenRouterProvider,
    AIRequestCodec,
    AIRouter,
    AIService,
    UsageService,
    PromptBuilder,
  ],
})
export class AIModule {}
