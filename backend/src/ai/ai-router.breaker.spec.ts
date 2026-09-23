import { AIChunk, AIProvider, AIProviderName, UserSettings } from '../shared';
import { AIRouter } from './ai-router';
import { GeminiProvider } from './gemini.provider';
import { GroqProvider } from './groq.provider';
import { OpenRouterProvider } from './openrouter.provider';

function provider(
  name: AIProviderName,
  behaviour: 'fail' | 'ok',
  calls: AIProviderName[],
): AIProvider {
  return {
    name,
    async generate() {
      calls.push(name);
      if (behaviour === 'fail') {
        throw new Error(`${name} down`);
      }
      return { content: 'ok', provider: name, model: 'm' };
    },
    async *stream(): AsyncIterable<AIChunk> {
      calls.push(name);
      if (behaviour === 'fail') {
        yield { type: 'error', message: `${name} down` };
        return;
      }
      yield { type: 'chunk', content: 'ok' };
    },
    async getAvailableModels() {
      return ['m'];
    },
  };
}

const SETTINGS: UserSettings = {
  userId: 'u',
  provider: 'gemini',
  model: 'm',
  updatedAt: new Date(0).toISOString(),
};

describe('AIRouter circuit breaker', () => {
  it('skips a provider after repeated failures', async () => {
    const calls: AIProviderName[] = [];
    const router = new AIRouter(
      provider('gemini', 'fail', calls) as unknown as GeminiProvider,
      provider('groq', 'ok', calls) as unknown as GroqProvider,
      provider('openrouter', 'ok', calls) as unknown as OpenRouterProvider,
    );
    const request = { model: 'm', messages: [] };

    for (let i = 0; i < 3; i += 1) {
      await router.generate(request, SETTINGS);
    }
    expect(calls.filter((c) => c === 'gemini')).toHaveLength(3);

    calls.length = 0;
    const result = await router.generate(request, SETTINGS);
    expect(result.provider).toBe('groq');
    expect(calls).toEqual(['groq']);
  });

  it('still tries tripped providers when every provider is tripped', async () => {
    const calls: AIProviderName[] = [];
    const router = new AIRouter(
      provider('gemini', 'fail', calls) as unknown as GeminiProvider,
      provider('groq', 'fail', calls) as unknown as GroqProvider,
      provider('openrouter', 'fail', calls) as unknown as OpenRouterProvider,
    );
    const request = { model: 'm', messages: [] };

    for (let i = 0; i < 3; i += 1) {
      await expect(router.generate(request, SETTINGS)).rejects.toThrow();
    }
    calls.length = 0;
    await expect(router.generate(request, SETTINGS)).rejects.toThrow();
    expect(calls).toEqual(['gemini', 'groq', 'openrouter']);
  });
});
