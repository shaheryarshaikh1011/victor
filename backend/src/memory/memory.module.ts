import { Module } from '@nestjs/common';
import { AIModule } from '../ai';
import { AuthModule } from '../auth';
import { EmbeddingsModule } from '../embeddings';
import { UsersModule } from '../users/users.module';
import { MemoryController } from './memory.controller';
import { MemoryRepository } from './memory.repository';
import { MemoryService } from './memory.service';
import { MemoryExtractor } from './services/memory-extractor.service';
import { MemoryMaintenance } from './services/memory-maintenance.service';
import { MemoryManager } from './services/memory-manager.service';
import { MemoryRetriever } from './services/memory-retriever.service';

/**
 * MemoryModule exposes the user-scoped memory CRUD/search API (Requirement 3)
 * and the memory domain service reused by the chat pipeline.
 *
 * It imports EmbeddingsModule for query/content embeddings (Requirement 10.1),
 * AuthModule for `SupabaseService`/`SupabaseAuthGuard`, AIModule for the shared
 * provider abstraction used by extraction/summarization, and UsersModule for
 * the caller's model settings used by the extractor. `MemoryService` and
 * `MemoryManager` are exported so the MessagesModule can integrate memory into
 * chat (Requirements 4.x, 6.3).
 */
@Module({
  imports: [EmbeddingsModule, AuthModule, AIModule, UsersModule],
  controllers: [MemoryController],
  providers: [
    MemoryRepository,
    MemoryService,
    MemoryRetriever,
    MemoryExtractor,
    MemoryManager,
    MemoryMaintenance,
  ],
  exports: [MemoryService, MemoryRetriever, MemoryManager],
})
export class MemoryModule {}
