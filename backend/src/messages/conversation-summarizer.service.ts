import { Injectable, Logger } from '@nestjs/common';
import { AIService } from '../ai/ai.service';
import { estimateTokens } from '../ai/prompt-builder';
import { ConversationsService } from '../conversations/conversations.service';
import { Conversation, Message } from '../shared';

/** Unsummarized history size (estimated tokens) that triggers a summary. */
const SUMMARY_TRIGGER_TOKENS = 6_000;

/** Most recent messages always left verbatim for the prompt. */
const KEEP_RECENT = 6;

/** Cap on the text sent to the summarizer in one pass. */
const MAX_INPUT_CHARS = 60_000;

/**
 * Maintains a rolling summary of older turns per conversation. Once the
 * unsummarized tail grows past {@link SUMMARY_TRIGGER_TOKENS}, everything but
 * the last {@link KEEP_RECENT} messages is folded into the summary on the
 * utility model, keeping chat prompts small without losing earlier context.
 */
@Injectable()
export class ConversationSummarizer {
  private readonly logger = new Logger(ConversationSummarizer.name);
  /** Conversations with a summary pass in flight. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly ai: AIService,
    private readonly conversations: ConversationsService,
  ) {}

  /**
   * Folds older turns into the summary when the unsummarized history is large.
   * `unsummarized` must be the messages after `conversation.summaryUpto`,
   * oldest first. Best-effort: failures leave the previous summary in place.
   */
  async maybeSummarize(
    conversation: Conversation,
    unsummarized: Message[],
  ): Promise<void> {
    const total = unsummarized.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0,
    );
    if (
      total < SUMMARY_TRIGGER_TOKENS ||
      unsummarized.length <= KEEP_RECENT ||
      this.inFlight.has(conversation.id)
    ) {
      return;
    }

    this.inFlight.add(conversation.id);
    try {
      const toFold = unsummarized.slice(0, -KEEP_RECENT);
      const transcript = toFold
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n')
        .slice(-MAX_INPUT_CHARS);
      const input = conversation.summary
        ? `EXISTING SUMMARY:\n${conversation.summary}\n\nNEW MESSAGES:\n${transcript}`
        : transcript;

      const summary = await this.ai.generateUtility(
        conversation.userId,
        'summary',
        'Summarize this conversation for an assistant that will continue ' +
          'it. Merge any existing summary with the new messages. Keep ' +
          'decisions, facts about the user, open questions, code or data ' +
          'that may be referenced later, and what was being worked on. ' +
          'Use terse bullet points, at most 300 words. Output only the summary.',
        input,
      );
      if (!summary) {
        return;
      }
      await this.conversations.saveSummary(
        conversation.id,
        summary,
        toFold[toFold.length - 1].createdAt,
      );
    } catch (err) {
      this.logger.warn(`summarize failed: ${(err as Error).message}`);
    } finally {
      this.inFlight.delete(conversation.id);
    }
  }
}
