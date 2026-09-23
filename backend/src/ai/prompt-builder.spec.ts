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
    const big = 'x'.repeat(40_000); // ~10k tokens each
    const history = [
      turn(1, 'user', big),
      turn(2, 'assistant', big),
      turn(3, 'user', big),
      turn(4, 'assistant', 'short'),
      turn(5, 'user', 'latest'),
    ];

    const messages = builder.build({
      model: 'openai/gpt-oss-20b',
      memoryContext: '',
      summary: null,
      history,
    });

    const contents = messages.slice(1).map((m) => m.content);
    expect(contents[contents.length - 1]).toBe('latest');
    expect(contents).not.toContain(history[0].content);
    // The kept window still starts with a user turn.
    expect(messages[1].role).toBe('user');
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
