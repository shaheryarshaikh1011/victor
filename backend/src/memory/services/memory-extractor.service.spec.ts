import * as fc from 'fast-check';
import { AIService } from '../../ai/ai.service';
import { BEHAVIORAL_MIN_CONFIDENCE } from '../memory.constants';
import { MemoryExtractor } from './memory-extractor.service';

/**
 * Feature: victor-v2-memory, Property 7.3: For any message classified as
 * trivial/ephemeral, automatic extraction stores no memory; behavioral
 * candidates below BEHAVIORAL_MIN_CONFIDENCE are not stored.
 * Validates: Requirements 5.2, 5.3
 */

/**
 * AIService stub that returns a scripted verdict. This lets the test drive the
 * real threshold-gating logic in the extractor without a network call. The
 * verdict content is what the extractor must then accept or reject.
 */
function stubAI(verdict: object): AIService {
  return {
    async generateUtility(): Promise<string> {
      return JSON.stringify(verdict);
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

  it('still extracts facts from messages that merely contain a pleasantry', async () => {
    const extractor = new MemoryExtractor(
      stubAI({
        store: true,
        content: 'User is vegetarian',
        memoryType: 'personal_fact',
        confidence: 0.9,
      }),
    );

    const result = await extractor.extractFromExchange(
      'user-1',
      'conv-1',
      "I'm vegetarian, thanks",
      'Good to know!',
    );

    expect(result?.content).toBe('User is vegetarian');
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
