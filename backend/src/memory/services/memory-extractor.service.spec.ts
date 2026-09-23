import * as fc from 'fast-check';
import { AIResult, UserSettings } from '../../shared';
import { AIService } from '../../ai/ai.service';
import { UsersService } from '../../users/users.service';
import { BEHAVIORAL_MIN_CONFIDENCE } from '../memory.constants';
import { MemoryExtractor } from './memory-extractor.service';

/**
 * Feature: victor-v2-memory, Property 7.3: For any message classified as
 * trivial/ephemeral, automatic extraction stores no memory; behavioral
 * candidates below BEHAVIORAL_MIN_CONFIDENCE are not stored.
 * Validates: Requirements 5.2, 5.3
 */

const SETTINGS: UserSettings = {
  userId: 'user-1',
  provider: 'gemini',
  model: 'test-model',
  updatedAt: new Date().toISOString(),
};

/**
 * UsersService stub returning fixed settings. The extractor only reads settings
 * to select a provider/model, which is irrelevant to the gating under test.
 */
function stubUsers(): UsersService {
  return { getSettings: async () => SETTINGS } as unknown as UsersService;
}

/**
 * AIService stub that returns a scripted verdict. This lets the test drive the
 * real threshold-gating logic in the extractor without a network call. The
 * verdict content is what the extractor must then accept or reject.
 */
function stubAI(verdict: object): AIService {
  return {
    async generate(): Promise<AIResult> {
      return {
        content: JSON.stringify(verdict),
        provider: 'gemini',
        model: 'test-model',
      };
    },
  } as unknown as AIService;
}

// Trivial/ephemeral phrasings the deterministic gate must reject.
const trivialArb = fc.constantFrom(
  "I'm hungry",
  "I'm tired",
  "What's the weather?",
  'Tell me a joke',
  'What time is it?',
  'hello',
  'hi',
  'thanks',
  'ok',
);

// Behavioral confidence strictly below the storage threshold.
const lowBehavioralConfidenceArb = fc
  .float({ min: 0, max: Math.fround(BEHAVIORAL_MIN_CONFIDENCE), noNaN: true })
  .filter((c) => c < BEHAVIORAL_MIN_CONFIDENCE);

describe('MemoryExtractor (Property: trivial/behavioral gating)', () => {
  it('stores no memory for trivial/ephemeral messages', async () => {
    await fc.assert(
      fc.asyncProperty(trivialArb, async (userText) => {
        // Even if the AI were to suggest storing, the deterministic trivial
        // gate runs first and short-circuits to "store nothing".
        const extractor = new MemoryExtractor(
          stubAI({ store: true, content: userText, confidence: 0.99 }),
          stubUsers(),
        );

        const result = await extractor.extractFromExchange(
          'user-1',
          'conv-1',
          userText,
          'some assistant reply',
        );

        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('does not store behavioral candidates below the confidence threshold', async () => {
    await fc.assert(
      fc.asyncProperty(
        lowBehavioralConfidenceArb,
        async (confidence) => {
          const extractor = new MemoryExtractor(
            stubAI({
              store: true,
              content: 'user tends to reply late in the evening',
              memoryType: 'behavioral',
              confidence,
            }),
            stubUsers(),
          );

          const result = await extractor.extractFromExchange(
            'user-1',
            'conv-1',
            'I usually get to my messages around midnight',
            'Noted.',
          );

          expect(result).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
