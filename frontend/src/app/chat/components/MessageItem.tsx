'use client';

/**
 * MessageItem — renders a single chat message with a role indicator that
 * distinguishes user messages from assistant messages (Requirement 8.2).
 *
 * For assistant messages it exposes a copy control that writes the message
 * content to the system clipboard (Requirement 8.3) and a regenerate control
 * that requests a fresh reply for the preceding user message (Requirement 8.4).
 *
 * While an assistant reply is streaming it shows a loading state
 * (Requirement 7.3); when the stream reports an error it shows an error state
 * (Requirement 7.4).
 */
import type { MessageRole } from '@/lib/types';

export type MessageStatus = 'complete' | 'streaming' | 'error';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
}

export interface MessageItemProps {
  message: ChatMessage;
  onCopy: (content: string) => void;
  onRegenerate: (messageId: string) => void;
}

const ROLE_LABEL: Record<MessageRole, string> = {
  user: 'You',
  assistant: 'VICTOR',
};

export function MessageItem({ message, onCopy, onRegenerate }: MessageItemProps) {
  const isAssistant = message.role === 'assistant';

  return (
    <article
      data-role={message.role}
      data-status={message.status}
      className={[
        'flex flex-col gap-1 rounded-lg p-3',
        isAssistant ? 'bg-gray-100' : 'bg-blue-50',
      ].join(' ')}
    >
      <span
        data-testid="role-indicator"
        className="text-xs font-semibold uppercase tracking-wide text-gray-500"
      >
        {ROLE_LABEL[message.role]}
      </span>

      <p className="whitespace-pre-wrap text-sm text-gray-900">
        {message.content}
      </p>

      {message.status === 'streaming' && (
        <span role="status" aria-live="polite" className="text-xs text-gray-400">
          VICTOR is typing…
        </span>
      )}

      {message.status === 'error' && (
        <span role="alert" className="text-xs text-red-600">
          Something went wrong generating this reply.
        </span>
      )}

      {isAssistant && message.status === 'complete' && (
        <div className="mt-1 flex gap-3">
          <button
            type="button"
            onClick={() => onCopy(message.content)}
            className="text-xs text-gray-500 hover:text-gray-900"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => onRegenerate(message.id)}
            className="text-xs text-gray-500 hover:text-gray-900"
          >
            Regenerate
          </button>
        </div>
      )}
    </article>
  );
}
