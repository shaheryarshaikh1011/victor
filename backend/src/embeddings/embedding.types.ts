/**
 * Embedding abstraction for VICTOR V2 memory.
 *
 * Embeddings are produced behind a pluggable {@link EmbeddingProvider} rather
 * than being hardcoded to a single vendor (Requirement 10.1). All vectors are
 * fixed at {@link EMBEDDING_DIMENSION} so the `vector(768)` column and the ANN
 * index remain consistent regardless of the active provider.
 */

/** Dimension of every embedding vector produced in the system. */
export const EMBEDDING_DIMENSION = 768;

/**
 * A source of embedding vectors. Implementations must return a vector of length
 * {@link EMBEDDING_DIMENSION}, or `null` when embedding is unavailable (e.g. an
 * upstream failure) so callers can degrade gracefully (Requirement 11.1).
 */
export interface EmbeddingProvider {
  /** Stable identifier used for logging without leaking secrets. */
  readonly name: string;

  /**
   * Produce an embedding for the given text.
   *
   * @returns a vector of length {@link EMBEDDING_DIMENSION}, or `null` on
   *   failure. Implementations must not throw for expected upstream errors.
   */
  embed(text: string): Promise<number[] | null>;
}
