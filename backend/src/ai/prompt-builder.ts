import { Injectable } from '@nestjs/common';
import { AIRequest, contextWindowFor, Message } from '../shared';
import { PERSONA } from './persona';

/** Share of the model's context window the prompt may use. */
const CONTEXT_SHARE = 0.6;

/**
 * Hard ceiling on prompt tokens regardless of the model's window, so
 * million-token models don't bill for a whole conversation every turn.
 */
const MAX_PROMPT_TOKENS = 24_000;

/** Most recent turns always kept even if they exceed the budget. */
const MIN_TURNS = 2;

export interface PromptParts {
  model: string;
  /** Formatted memory block, or empty. */
  memoryContext: string;
  /** Rolling summary of turns older than `history`, or null. */
  summary: string | null;
  /** Conversation turns not covered by the summary, oldest first. */
  history: Message[];
}

/** Rough token estimate (~4 characters per token for English text). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Assembles the chat prompt: one system message (persona, date, memories,
 * conversation summary) followed by as many recent turns as fit the model's
 * token budget. Older turns are dropped first; the summary covers them once
 * the summarizer has run.
 */
@Injectable()
export class PromptBuilder {
  build(parts: PromptParts, now: Date = new Date()): AIRequest['messages'] {
    const system = [
      PERSONA,
      `Current date: ${now.toISOString().slice(0, 10)}.`,
      parts.memoryContext,
      parts.summary
        ? `Summary of the earlier part of this conversation:\n${parts.summary}`
        : '',
    ]
      .filter((section) => section.length > 0)
      .join('\n\n');

    const budget =
      Math.min(
        Math.floor(contextWindowFor(parts.model) * CONTEXT_SHARE),
        MAX_PROMPT_TOKENS,
      ) - estimateTokens(system);

    const turns: Message[] = [];
    let used = 0;
    for (let i = parts.history.length - 1; i >= 0; i -= 1) {
      const cost = estimateTokens(parts.history[i].content);
      if (used + cost > budget && turns.length >= MIN_TURNS) {
        break;
      }
      turns.unshift(parts.history[i]);
      used += cost;
    }

    // Providers expect the conversation to start with a user turn.
    while (turns.length > 1 && turns[0].role !== 'user') {
      turns.shift();
    }

    return [
      { role: 'system', content: system },
      ...turns.map((m) => ({ role: m.role, content: m.content })),
    ];
  }
}
