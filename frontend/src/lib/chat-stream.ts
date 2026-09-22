/**
 * Server-Sent Events consumption for streaming assistant replies.
 *
 * The Backend_API delivers the assistant reply as an ordered sequence of
 * `AIChunk` events over `text/event-stream` (Requirements 7.1, 7.2). This helper
 * parses that byte stream into typed chunks in delivery order so the caller can
 * append content incrementally.
 */

export type AIChunk =
  | { type: 'chunk'; content: string }
  | { type: 'error'; message: string };

/**
 * Parses an SSE `Response` body into an async iterable of {@link AIChunk},
 * preserving delivery order. Each SSE event carries a JSON `data:` payload.
 */
export async function* readChunks(response: Response): AsyncIterable<AIChunk> {
  const body = response.body;
  if (!body) {
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line.
      let separatorIndex: number;
      while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const chunk = parseEvent(rawEvent);
        if (chunk) {
          yield chunk;
        }
      }
    }

    const tail = parseEvent(buffer);
    if (tail) {
      yield tail;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Extracts and parses the `data:` payload from a single SSE event block. */
function parseEvent(rawEvent: string): AIChunk | null {
  const dataLine = rawEvent
    .split('\n')
    .map((line) => line.trimEnd())
    .find((line) => line.startsWith('data:'));
  if (!dataLine) {
    return null;
  }
  const json = dataLine.slice('data:'.length).trim();
  if (json.length === 0) {
    return null;
  }
  try {
    return JSON.parse(json) as AIChunk;
  } catch {
    return null;
  }
}
