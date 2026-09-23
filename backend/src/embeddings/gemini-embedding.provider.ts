import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EMBEDDING_DIMENSION,
  EmbeddingProvider,
} from './embedding.types';

const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';
const EMBEDDING_MODEL = 'text-embedding-004';

/**
 * GeminiEmbeddingProvider — produces embeddings via the Google Gemini
 * `text-embedding-004` model (768 dimensions) (Requirement 10.1).
 *
 * The API key is read from `GEMINI_API_KEY` and is never included in any value
 * returned to callers or in logs. On any upstream failure the provider returns
 * `null` rather than throwing so the memory pipeline can degrade gracefully
 * (Requirement 11.1).
 */
@Injectable()
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini-embedding';
  readonly modelId = `gemini:${EMBEDDING_MODEL}`;
  private readonly logger = new Logger(GeminiEmbeddingProvider.name);

  constructor(private readonly config: ConfigService) {}

  /** True when an embedding API key is configured. */
  isConfigured(): boolean {
    return Boolean(this.config.get<string>('GEMINI_API_KEY'));
  }

  async embed(text: string): Promise<number[] | null> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      return null;
    }

    try {
      const response = await fetch(
        `${GEMINI_BASE_URL}/${EMBEDDING_MODEL}:embedContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            model: `models/${EMBEDDING_MODEL}`,
            content: { parts: [{ text }] },
            outputDimensionality: EMBEDDING_DIMENSION,
          }),
        },
      );

      if (!response.ok) {
        this.logger.warn(
          `Embedding request failed with status ${response.status}`,
        );
        return null;
      }

      const json = (await response.json()) as {
        embedding?: { values?: number[] };
      };
      const values = json.embedding?.values;
      if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSION) {
        this.logger.warn('Embedding response had unexpected shape');
        return null;
      }
      return values;
    } catch (err) {
      this.logger.warn(
        `Embedding request errored: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
