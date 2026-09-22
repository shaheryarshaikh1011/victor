import { Module } from '@nestjs/common';
import { GeminiProvider } from './gemini.provider';
import { GroqProvider } from './groq.provider';
import { OpenRouterProvider } from './openrouter.provider';
import { AIRequestCodec } from './ai-request.codec';
import { AIRouter } from './ai-router';

/**
 * AIModule provides the AI provider implementations, the request codec, and the
 * AIRouter (selection + bounded fallback). The AIService facade is added in a
 * subsequent task (9) and will consume the AIRouter exported here.
 */
@Module({
  providers: [
    GeminiProvider,
    GroqProvider,
    OpenRouterProvider,
    AIRequestCodec,
    AIRouter,
  ],
  exports: [
    GeminiProvider,
    GroqProvider,
    OpenRouterProvider,
    AIRequestCodec,
    AIRouter,
  ],
})
export class AIModule {}
