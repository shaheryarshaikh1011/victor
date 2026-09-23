import { Module } from '@nestjs/common';
import { AIModule } from '../ai';
import { AuthModule } from '../auth';
import { EmbeddingsModule } from '../embeddings';
import { MemoryController } from './memory.controller';
import { MemoryRepository } from './memory.repository';
import { MemoryService } from './memory.service';
import { MemoryRetriever } from './services/memory-retriever.service';

/**
 * MemoryModule exposes the user-scoped memory CRUD/search API (Requirement 3)
 * and the memory domain service reused by the chat pipeline.
 *
 * It imports EmbeddingsModule for query/content embeddings (Requirement 10.1),
 * AuthModule for `SupabaseService`/`SupabaseAuthGuard`, and AIModule for the
 * shared provider abstraction used by extraction/summarization. `MemoryService`
 * is exported so the MessagesModule can integrate memory into chat.
 */
@Module({
  imports: [EmbeddingsModule, AuthModule, AIModule],
  controllers: [MemoryController],
  providers: [MemoryRepository, MemoryService, MemoryRetriever],
  exports: [MemoryService, MemoryRetriever],
})
export class MemoryModule {}
