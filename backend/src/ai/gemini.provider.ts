import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIChunk,
  AIProvider,
  AIRequest,
  AIResult,
  logTokenUsage,
  SUPPORTED_MODELS,
  usageFromGemini,
} from '../shared';

const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * GeminiProvider — calls the Google Gemini generateContent API.
 *
 * The API key is read from the GEMINI_API_KEY environment variable and is never
 * included in any value returned to callers (Requirement 5.5).
 */
@Injectable()
export class GeminiProvider implements AIProvider {
  readonly name = 'gemini' as const;
  private readonly logger = new Logger(GeminiProvider.name);

  constructor(private readonly config: ConfigService) {}

  async generate(request: AIRequest): Promise<AIResult> {
    const apiKey = this.requireApiKey();
    const body = this.toGeminiBody(request);

    const response = await fetch(
      `${GEMINI_BASE_URL}/${encodeURIComponent(request.model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      },
    );

    if (!response.ok) {
      throw new Error(
        `Gemini request failed with status ${response.status}`,
      );
    }

    const json = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: unknown;
    };
    const content =
      json.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('') ?? '';

    const usage = usageFromGemini(json.usageMetadata);
    logTokenUsage(this.logger, this.name, request.model, usage);

    return { content, provider: this.name, model: request.model, usage };
  }

  async *stream(request: AIRequest): AsyncIterable<AIChunk> {
    const apiKey = this.requireApiKey();
    const body = this.toGeminiBody(request);

    let response: Response;
    try {
      response = await fetch(
        `${GEMINI_BASE_URL}/${encodeURIComponent(
          request.model,
        )}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
          signal: request.signal,
        },
      );
    } catch (err) {
      yield { type: 'error', message: (err as Error).message };
      return;
    }

    if (!response.ok || !response.body) {
      yield {
        type: 'error',
        message: `Gemini stream failed with status ${response.status}`,
      };
      return;
    }

    let usage: unknown;
    for await (const data of readSseData(response.body)) {
      const parsed = JSON.parse(data) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: unknown;
      };
      if (parsed.usageMetadata) {
        usage = parsed.usageMetadata;
      }
      const text =
        parsed.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? '')
          .join('') ?? '';
      if (text.length > 0) {
        yield { type: 'chunk', content: text };
      }
    }
    const finalUsage = usageFromGemini(usage);
    logTokenUsage(this.logger, this.name, request.model, finalUsage);
    if (finalUsage) {
      yield {
        type: 'usage',
        provider: this.name,
        model: request.model,
        usage: finalUsage,
      };
    }
  }

  async getAvailableModels(): Promise<string[]> {
    return [...SUPPORTED_MODELS[this.name]];
  }

  private toGeminiBody(request: AIRequest): Record<string, unknown> {
    const contents = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
    const systemText = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');

    const body: Record<string, unknown> = { contents };
    if (systemText.length > 0) {
      body.systemInstruction = { parts: [{ text: systemText }] };
    }
    if (request.temperature !== undefined) {
      body.generationConfig = { temperature: request.temperature };
    }
    return body;
  }

  private requireApiKey(): string {
    const key = this.config.get<string>('GEMINI_API_KEY');
    if (!key) {
      throw new Error('Missing required environment variable: GEMINI_API_KEY');
    }
    return key;
  }
}

/**
 * Reads a `text/event-stream` body and yields the payload after each `data:`
 * field, stopping at the `[DONE]` sentinel. Shared by SSE-based providers.
 */
export async function* readSseData(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.startsWith('data:')) {
        continue;
      }
      const data = line.slice('data:'.length).trim();
      if (data === '[DONE]' || data.length === 0) {
        continue;
      }
      yield data;
    }
  }
}
