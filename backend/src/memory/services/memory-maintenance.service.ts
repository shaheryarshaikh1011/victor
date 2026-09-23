import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { MemoryService } from '../memory.service';

/** Memories re-embedded per maintenance pass. */
const REEMBED_BATCH = 100;

/** Interval between maintenance passes. */
const REEMBED_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Background upkeep for the memory store. Re-embeds memories whose vector is
 * missing or was produced by a different embedding model (e.g. after the
 * provider or API key changed), so they rejoin retrieval without user action.
 */
@Injectable()
export class MemoryMaintenance
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MemoryMaintenance.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly memories: MemoryService) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    void this.run();
    this.timer = setInterval(() => void this.run(), REEMBED_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async run(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const count = await this.memories.reembedStale(REEMBED_BATCH);
      if (count > 0) {
        this.logger.log(`Re-embedded ${count} memories`);
      }
    } catch (err) {
      this.logger.warn(`Re-embed pass failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
