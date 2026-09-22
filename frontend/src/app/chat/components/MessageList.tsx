'use client';

/**
 * MessageList — renders the ordered sequence of messages for the active
 * conversation (Requirement 8.1). Ordering is preserved from the backend,
 * which returns messages by ascending creation time.
 */
import { MessageItem, type ChatMessage } from './MessageItem';

export interface MessageListProps {
  messages: ChatMessage[];
  onCopy: (content: string) => void;
  onRegenerate: (messageId: string) => void;
}

export function MessageList({ messages, onCopy, onRegenerate }: MessageListProps) {
  return (
    <div
      aria-label="Messages"
      className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
    >
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          onCopy={onCopy}
          onRegenerate={onRegenerate}
        />
      ))}
      {messages.length === 0 && (
        <p className="m-auto text-sm text-gray-400">
          Start the conversation by sending a message.
        </p>
      )}
    </div>
  );
}
