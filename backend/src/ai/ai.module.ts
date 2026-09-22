import { Module } from '@nestjs/common';
import { GeminiProvider } from './gemini.provider';
import { GroqProvider } from './groq.provider';
import { OpenRouterProvider } from './openrouter.provider';
import { AIRequestCodec } from './ai-request.codec';

/**
 * AIModule provides the AI provider implementations and the request codec.
 * The AIRouter and AIService facade are added in subsequent tasks (8, 9) and
 * will consume the providers exported here.
 */
@Module({
  providers: [
    GeminiProvider,
    GroqProvider,
    OpenRouterProvider,
    AIRequestCodec,
  ],
  exports: [GeminiProvider, GroqProvider, OpenRouterProvider, AIRequestCodec],
})
export class AIModule {}
