import { AIService } from '../../ai/ai.service';
import { UsersService } from '../../users/users.service';
import { MemoryExtractor } from './memory-extractor.service';

/**
 * Unit tests for deterministic command detection (Requirements 4.1, 4.2, 8.1).
 * detectCommand makes no AI call, so the collaborators are inert stubs.
 */
function buildExtractor(): MemoryExtractor {
  return new MemoryExtractor(
    {} as unknown as AIService,
    {} as unknown as UsersService,
  );
}

describe('MemoryExtractor.detectCommand', () => {
  const extractor = buildExtractor();

  it('detects remember commands (Requirement 4.1)', () => {
    expect(extractor.detectCommand('Remember that I prefer tea')?.type).toBe(
      'remember',
    );
    expect(extractor.detectCommand("Don't forget to water plants")?.type).toBe(
      'remember',
    );
    expect(extractor.detectCommand('Save this: my code is 1234')?.type).toBe(
      'remember',
    );
    expect(extractor.detectCommand('Make a note that I use vim')?.type).toBe(
      'remember',
    );
  });

  it('captures the payload after a remember trigger', () => {
    const cmd = extractor.detectCommand('Remember that I prefer concise answers');
    expect(cmd?.type).toBe('remember');
    expect(cmd?.payload).toBe('I prefer concise answers');
  });

  it('detects forget commands (Requirement 4.2)', () => {
    expect(extractor.detectCommand('Forget that I like tea')?.type).toBe(
      'forget',
    );
    expect(extractor.detectCommand('Remove that memory')?.type).toBe('forget');
    expect(extractor.detectCommand('Delete my memory about tea')?.type).toBe(
      'forget',
    );
  });

  it('detects recall commands (Requirement 8.1)', () => {
    expect(extractor.detectCommand('What do you remember about me?')?.type).toBe(
      'recall',
    );
    expect(extractor.detectCommand('what do you know about me')?.type).toBe(
      'recall',
    );
    expect(extractor.detectCommand('Show my memories')?.type).toBe('recall');
    expect(extractor.detectCommand('list my memories')?.type).toBe('recall');
  });

  it('returns null for ordinary chat messages', () => {
    expect(extractor.detectCommand('How is the weather today?')).toBeNull();
    expect(extractor.detectCommand('Can you help me write a function?')).toBeNull();
    expect(extractor.detectCommand('')).toBeNull();
    expect(extractor.detectCommand('   ')).toBeNull();
    expect(extractor.detectCommand('Thanks for the help')).toBeNull();
  });
});
