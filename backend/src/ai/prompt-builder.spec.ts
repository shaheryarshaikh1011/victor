import { Message } from '../shared';
import { PERSONA } from './persona';
import { PromptBuilder } from './prompt-builder';

function turn(i: number, role: Message['role'], content: string): Message {
  return {
    id: `m-${i}`,
    conversationId: 'c',
    role,
    content,
    createdAt: new Date(i).toISOString(),
  };
}

describe('PromptBuilder', () => {
  const builder = new PromptBuilder();

  it('puts persona, memories and summary in one leading system message', () => {
    const messages = builder.build({
      model: 'openai/gpt-oss-20b',
      memoryContext: 'Relevant memories about the user:\n- likes tea',
      summary: '- discussed Rust',
      history: [turn(1, 'user', 'hi there')],
    });

    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain(PERSONA);
    expect(messages[0].content).toContain('likes tea');
    expect(messages[0].content).toContain('discussed Rust');
    expect(messages.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(messages[1]).toEqual({ role: 'user', content: 'hi there' });
  });

  it('drops the oldest turns once the token budget is exceeded', () => {
    // ~10k tokens each; the 24k budget fits two of them.
    const big = (c: string) => c.repeat(40_000);
    const history = [
      turn(1, 'user', big('a')),
      turn(2, 'assistant', big('b')),
      turn(3, 'user', big('c')),
      turn(4, 'assistant', 'short'),
      turn(5, 'user', 'latest'),
    ];

    const messages = builder.build({
      model: 'openai/gpt-oss-20b',
      memoryContext: '',
      summary: null,
      history,
    });

    // Turn 1 is over budget; turn 2 fits but would open the window with an
    // assistant turn, so it is dropped too.
    expect(messages.slice(1).map((m) => m.content)).toEqual([
      history[2].content,
      'short',
      'latest',
    ]);
  });

  it('always keeps the latest turns even if they alone exceed the budget', () => {
    const huge = 'y'.repeat(400_000);
    const messages = builder.build({
      model: 'openai/gpt-oss-20b',
      memoryContext: '',
      summary: null,
      history: [turn(1, 'user', huge)],
    });
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toBe(huge);
  });
});
