import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIChunk,
  AIProvider,
  AIRequest,
  AIResult,
  logTokenUsage,
  SUPPORTED_MODELS,
  usageFromOpenAI,
} from '../shared';
import { readSseData } from './gemini.provider';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * GroqProvider — calls the Groq OpenAI-compatible chat completions API.
 *
 * The API key is read from the GROQ_API_KEY environment variable and is never
 * included in any value returned to callers (Requirement 5.5).
 */
@Injectable()
export class GroqProvider implements AIProvider {
  readonly name = 'groq' as const;
  private readonly logger = new Logger(GroqProvider.name);

  constructor(private readonly config: ConfigService) {}

  async generate(request: AIRequest): Promise<AIResult> {
    const apiKey = this.requireApiKey();
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(this.toBody(request, false)),
    });

    if (!response.ok) {
      throw new Error(`Groq request failed with status ${response.status}`);
    }

    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: unknown;
    };
    const content = json.choices?.[0]?.message?.content ?? '';
    logTokenUsage(
      this.logger,
      this.name,
      request.model,
      usageFromOpenAI(json.usage),
    );
    return { content, provider: this.name, model: request.model };
  }

  async *stream(request: AIRequest): AsyncIterable<AIChunk> {
    const apiKey = this.requireApiKey();
    let response: Response;
    try {
      response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(this.toBody(request, true)),
      });
    } catch (err) {
      yield { type: 'error', message: (err as Error).message };
      return;
    }

    if (!response.ok || !response.body) {
      yield {
        type: 'error',
        message: `Groq stream failed with status ${response.status}`,
      };
      return;
    }

    let usage: unknown;
    for await (const data of readSseData(response.body)) {
      const parsed = JSON.parse(data) as {
        choices?: { delta?: { content?: string } }[];
        usage?: unknown;
      };
      if (parsed.usage) {
        usage = parsed.usage;
      }
      const text = parsed.choices?.[0]?.delta?.content ?? '';
      if (text.length > 0) {
        yield { type: 'chunk', content: text };
      }
    }
    logTokenUsage(
      this.logger,
      this.name,
      request.model,
      usageFromOpenAI(usage),
    );
  }

  async getAvailableModels(): Promise<string[]> {
    return [...SUPPORTED_MODELS[this.name]];
  }

  private toBody(request: AIRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream,
    };
    // Ask the API to include token usage in the final streamed chunk.
    if (stream) {
      body.stream_options = { include_usage: true };
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    return body;
  }

  private requireApiKey(): string {
    const key = this.config.get<string>('GROQ_API_KEY');
    if (!key) {
      throw new Error('Missing required environment variable: GROQ_API_KEY');
    }
    return key;
  }
}
