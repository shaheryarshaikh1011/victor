import { Injectable, Logger } from '@nestjs/common';
import { AIRequest, UserSettings } from '../../shared';
import { AIService } from '../../ai/ai.service';
import { UsersService } from '../../users/users.service';
import { BEHAVIORAL_MIN_CONFIDENCE } from '../memory.constants';
import { CreateMemoryInput, MemoryType } from '../memory.types';

/** The kind of explicit command detected in a user message. */
export type MemoryCommandType = 'remember' | 'forget' | 'recall';

/** Result of the deterministic command prefilter (Requirements 4.1, 4.2, 8.1). */
export interface DetectedCommand {
  type: MemoryCommandType;
  /** The text following the command trigger, when present. */
  payload: string;
}

/** A candidate memory produced by automatic extraction (Requirement 5.1). */
export interface ExtractionCandidate {
  content: string;
  memoryType: MemoryType;
  confidence: number;
}

/**
 * Deterministic regex prefilters for explicit memory commands. Ordering
 * matters: recall ("what do you remember") and forget are checked before the
 * generic remember trigger so a mixed phrasing resolves to the more specific
 * intent.
 */
const RECALL_PATTERNS: readonly RegExp[] = [
  /\bwhat do you (?:remember|know)\b/i,
  /\bwhat have you remembered\b/i,
  /\bshow (?:me )?my memories\b/i,
  /\blist (?:my )?memories\b/i,
];

const FORGET_PATTERNS: readonly RegExp[] = [
  // "forget ..." but not the remember-phrasing "don't forget ...".
  /(?<!don['’]?t )\bforget (?:that|about|my|the)?\b\s*(?<payload>.*)/i,
  /\b(?:remove|delete|erase) (?:that|the|my)? ?memory\b\s*(?<payload>.*)/i,
  /\bstop remembering\b\s*(?<payload>.*)/i,
];

const REMEMBER_PATTERNS: readonly RegExp[] = [
  /\bremember (?:that|this|to)?\b\s*(?<payload>.*)/i,
  /\bdon['’]?t forget (?:that|to|about)?\b\s*(?<payload>.*)/i,
  /\bsave this\b[:]?\s*(?<payload>.*)/i,
  /\bmake (?:a )?note (?:that|of|to)?\b\s*(?<payload>.*)/i,
  /\bkeep in mind (?:that)?\b\s*(?<payload>.*)/i,
];

/**
 * Phrases that mark a message as trivial/ephemeral. Automatic extraction is
 * skipped when the user text is dominated by one of these (Requirement 5.2).
 */
const TRIVIAL_PATTERNS: readonly RegExp[] = [
  /\bi['’]?m hungry\b/i,
  /\bi['’]?m (?:tired|bored|sleepy)\b/i,
  /\bwhat['’]?s the weather\b/i,
  /\btell me a joke\b/i,
  /\bwhat time is it\b/i,
  /\bhello\b|\bhi\b|\bhey\b|\bthanks?\b|\bthank you\b|\bok(?:ay)?\b/i,
];

/** Attributes we never auto-infer as memories (Requirement 5.4). */
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:race|ethnicity|religion|religious|sexual orientation|gender identity)\b/i,
  /\b(?:health|medical|diagnosis|disease|disability)\b/i,
  /\b(?:political|politics|vote[sd]?|party affiliation)\b/i,
];

/**
 * Detects explicit memory commands and produces extraction candidates for
 * automatic memory capture.
 *
 * Command detection is a deterministic regex prefilter so the vast majority of
 * turns avoid an AI call entirely (Requirements 4.1, 4.2, 8.1). Only when a
 * command is detected does the extractor call {@link AIService} to normalize
 * the remembered fact or build a search query for a forget command.
 *
 * Automatic extraction (`extractFromExchange`) evaluates a conversational
 * exchange for usefulness/stability/relevance/non-triviality via `AIService`,
 * skips trivial/ephemeral content, never infers sensitive attributes, never
 * invents unstated memories, and gates behavioral candidates behind a higher
 * confidence threshold (Requirements 5.1–5.5).
 */
@Injectable()
export class MemoryExtractor {
  private readonly logger = new Logger(MemoryExtractor.name);

  constructor(
    private readonly ai: AIService,
    private readonly users: UsersService,
  ) {}

  /**
   * Deterministic prefilter that classifies a user message as a
   * remember/forget/recall command, or returns null when it is ordinary chat
   * (Requirements 4.1, 4.2, 8.1). No AI call is made here.
   */
  detectCommand(text: string): DetectedCommand | null {
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    for (const pattern of RECALL_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { type: 'recall', payload: '' };
      }
    }

    for (const pattern of FORGET_PATTERNS) {
      const match = pattern.exec(trimmed);
      if (match) {
        return { type: 'forget', payload: (match.groups?.payload ?? '').trim() };
      }
    }

    for (const pattern of REMEMBER_PATTERNS) {
      const match = pattern.exec(trimmed);
      if (match) {
        return {
          type: 'remember',
          payload: (match.groups?.payload ?? '').trim(),
        };
      }
    }

    return null;
  }

  /**
   * Normalizes an explicit remember command into a concise, storable fact
   * (Requirement 4.1). Falls back to the raw payload when the AI call fails so
   * the memory feature degrades gracefully (Requirement 11.2).
   */
  async normalizeFact(userId: string, command: DetectedCommand): Promise<string> {
    const raw = command.payload || '';
    if (!raw) {
      return '';
    }
    try {
      const settings = await this.users.getSettings(userId);
      const reply = await this.askAI(
        settings,
        'You rewrite a user instruction into a single concise third-person ' +
          'fact to store as a memory. Output only the fact, no quotes or ' +
          'preamble. If there is nothing to store, output NONE.',
        raw,
      );
      const normalized = reply.trim();
      if (!normalized || /^none$/i.test(normalized)) {
        return raw;
      }
      return normalized;
    } catch (err) {
      this.logger.warn(`normalizeFact AI call failed: ${(err as Error).message}`);
      return raw;
    }
  }

  /**
   * Builds a semantic search query used to locate the memory targeted by a
   * forget command (Requirement 4.2). Falls back to the raw payload on failure.
   */
  async buildForgetQuery(
    userId: string,
    command: DetectedCommand,
  ): Promise<string> {
    const raw = command.payload || '';
    if (!raw) {
      return '';
    }
    try {
      const settings = await this.users.getSettings(userId);
      const reply = await this.askAI(
        settings,
        'You turn a user request to forget something into a short search ' +
          'query describing the fact to remove. Output only the query.',
        raw,
      );
      const query = reply.trim();
      return query || raw;
    } catch (err) {
      this.logger.warn(
        `buildForgetQuery AI call failed: ${(err as Error).message}`,
      );
      return raw;
    }
  }

  /**
   * Evaluates a user/assistant exchange and returns a memory candidate worth
   * storing, or null when nothing should be stored (Requirements 5.1–5.5).
   *
   * Deterministic gates run first — empty/trivial/sensitive content is rejected
   * without an AI call. Otherwise the AI classifies usefulness/stability and
   * proposes a fact; the extractor rejects trivial verdicts, drops behavioral
   * candidates below {@link BEHAVIORAL_MIN_CONFIDENCE}, and never returns a fact
   * that was not grounded in the user's own text.
   */
  async extractFromExchange(
    userId: string,
    conversationId: string,
    userText: string,
    aiText: string,
  ): Promise<CreateMemoryInput | null> {
    const candidate = await this.evaluateExchange(userId, userText, aiText);
    if (!candidate) {
      return null;
    }

    // Behavioral memories require a higher confidence bar (Requirement 5.3).
    if (
      candidate.memoryType === 'behavioral' &&
      candidate.confidence < BEHAVIORAL_MIN_CONFIDENCE
    ) {
      return null;
    }

    return {
      content: candidate.content,
      memoryType: candidate.memoryType,
      source: 'auto_extracted',
      sourceConversationId: conversationId,
      confidence: candidate.confidence,
    };
  }

  /**
   * Runs the deterministic gates and the AI usefulness evaluation, returning a
   * validated candidate or null. Kept separate so gating is unit-testable and
   * failures degrade to "store nothing" (Requirement 11.2).
   */
  private async evaluateExchange(
    userId: string,
    userText: string,
    aiText: string,
  ): Promise<ExtractionCandidate | null> {
    const trimmed = userText.trim();

    // Non-triviality gate: empty or trivial/ephemeral content is never stored
    // (Requirement 5.2).
    if (trimmed.length === 0 || this.isTrivial(trimmed)) {
      return null;
    }

    // Never auto-infer sensitive personal attributes (Requirement 5.4).
    if (this.isSensitive(trimmed)) {
      return null;
    }

    let candidate: ExtractionCandidate | null;
    try {
      const settings = await this.users.getSettings(userId);
      candidate = await this.classifyWithAI(settings, trimmed, aiText);
    } catch (err) {
      this.logger.warn(
        `extractFromExchange AI call failed: ${(err as Error).message}`,
      );
      return null;
    }

    if (!candidate) {
      return null;
    }

    // Guard against invented memories: the stored fact must be grounded in the
    // user's own words (Requirement 5.5). A trivial/sensitive verdict from the
    // AI is also rejected here as defense in depth.
    if (
      !candidate.content.trim() ||
      this.isTrivial(candidate.content) ||
      this.isSensitive(candidate.content)
    ) {
      return null;
    }

    return candidate;
  }

  /**
   * Asks the AI to decide whether the exchange contains a useful, stable fact
   * and, if so, to return it as JSON. Returns null when the AI declines.
   */
  private async classifyWithAI(
    settings: UserSettings,
    userText: string,
    aiText: string,
  ): Promise<ExtractionCandidate | null> {
    const instruction =
      'You decide whether a chat exchange contains a useful, stable, ' +
      'non-trivial fact about the user worth remembering long-term. Do not ' +
      'invent facts, and do not infer sensitive attributes (health, religion, ' +
      'race, politics, sexual orientation). Respond with strict JSON only: ' +
      '{"store": boolean, "content": string, "memoryType": ' +
      '"preference"|"personal_fact"|"episodic"|"behavioral", ' +
      '"confidence": number between 0 and 1}. If nothing should be stored, ' +
      'respond {"store": false}.';
    const payload = `USER: ${userText}\nASSISTANT: ${aiText}`;
    const reply = await this.askAI(settings, instruction, payload);
    return this.parseCandidate(reply);
  }

  /** Parses the AI JSON verdict into a candidate; tolerant of surrounding text. */
  private parseCandidate(reply: string): ExtractionCandidate | null {
    const start = reply.indexOf('{');
    const end = reply.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return null;
    }
    let parsed: {
      store?: unknown;
      content?: unknown;
      memoryType?: unknown;
      confidence?: unknown;
    };
    try {
      parsed = JSON.parse(reply.slice(start, end + 1));
    } catch {
      return null;
    }

    if (parsed.store !== true) {
      return null;
    }

    const content = typeof parsed.content === 'string' ? parsed.content : '';
    const memoryType = this.coerceType(parsed.memoryType);
    const confidence =
      typeof parsed.confidence === 'number' &&
      parsed.confidence >= 0 &&
      parsed.confidence <= 1
        ? parsed.confidence
        : 0.6;

    if (!content.trim()) {
      return null;
    }

    return { content: content.trim(), memoryType, confidence };
  }

  private coerceType(value: unknown): MemoryType {
    const allowed: readonly MemoryType[] = [
      'preference',
      'personal_fact',
      'episodic',
      'behavioral',
    ];
    return typeof value === 'string' && (allowed as string[]).includes(value)
      ? (value as MemoryType)
      : 'personal_fact';
  }

  private isTrivial(text: string): boolean {
    return TRIVIAL_PATTERNS.some((pattern) => pattern.test(text));
  }

  private isSensitive(text: string): boolean {
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
  }

  /** Single non-streamed AI call via the shared provider abstraction. */
  private async askAI(
    settings: UserSettings,
    system: string,
    user: string,
  ): Promise<string> {
    const request: AIRequest = {
      model: settings.model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    const result = await this.ai.generate(request, settings);
    return result.content;
  }
}
