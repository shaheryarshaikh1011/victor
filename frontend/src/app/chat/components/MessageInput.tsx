'use client';

/**
 * MessageInput — the message composition control (Requirement 8.1). Submitting a
 * non-empty message forwards its content to the parent, which sends it to the
 * Backend_API and streams the assistant reply.
 */
import { useState } from 'react';

export interface MessageInputProps {
  disabled: boolean;
  onSend: (content: string) => void;
}

export function MessageInput({ disabled, onSend }: MessageInputProps) {
  const [value, setValue] = useState('');

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length === 0 || disabled) {
      return;
    }
    onSend(trimmed);
    setValue('');
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Send a message"
      className="flex items-end gap-2 border-t p-3"
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={1}
        placeholder="Message VICTOR…"
        aria-label="Message"
        className="flex-1 resize-none rounded border px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={disabled || value.trim().length === 0}
        className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        Send
      </button>
    </form>
  );
}
