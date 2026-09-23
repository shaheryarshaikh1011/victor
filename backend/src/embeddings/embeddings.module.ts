import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { GeminiEmbeddingProvider } from './gemini-embedding.provider';
import { HashEmbeddingProvider } from './hash-embedding.provider';

/**
 * EmbeddingsModule provides the pluggable embedding providers and the
 * EmbeddingService facade that memory features depend on for producing query
 * and content embeddings (Requirement 10.1).
 */
@Module({
  providers: [
    GeminiEmbeddingProvider,
    HashEmbeddingProvider,
    EmbeddingService,
  ],
  exports: [EmbeddingService],
})
export class EmbeddingsModule {}
