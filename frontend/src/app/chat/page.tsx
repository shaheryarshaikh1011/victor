'use client';

/**
 * `/chat` — the chat interface. Renders a conversation sidebar, a message list,
 * and a message input (Requirement 8.1), with the sidebar collapsible on mobile
 * (Requirement 8.5).
 *
 * Sending a message persists it and streams the assistant reply incrementally,
 * showing a loading state while streaming (Requirement 7.3) and an error state
 * on failure (Requirement 7.4). Assistant messages expose copy (Requirement
 * 8.3) and regenerate (Requirement 8.4) controls.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiClient, ApiError } from '@/lib/api-client';
import { readChunks } from '@/lib/chat-stream';
import type { Conversation } from '@/lib/types';
import { ConversationSidebar } from './components/ConversationSidebar';
import { MessageInput } from './components/MessageInput';
import { MessageList } from './components/MessageList';
import type { ChatMessage } from './components/MessageItem';

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the conversation list on mount.
  useEffect(() => {
    let active = true;
    apiClient
      .listConversations()
      .then((list) => {
        if (!active) return;
        setConversations(list);
        if (list.length > 0) {
          setActiveId((current) => current ?? list[0].id);
        }
      })
      .catch((err) => {
        if (active) setError(errorMessage(err, 'load conversations'));
      });
    return () => {
      active = false;
    };
  }, []);

  // Load messages whenever the active conversation changes.
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let active = true;
    apiClient
      .listMessages(activeId)
      .then((loaded) => {
        if (!active) return;
        setMessages(
          loaded.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            status: 'complete' as const,
          })),
        );
      })
      .catch((err) => {
        if (active) setError(errorMessage(err, 'load messages'));
      });
    return () => {
      active = false;
    };
  }, [activeId]);

  const handleNewConversation = useCallback(async () => {
    setError(null);
    try {
      const created = await apiClient.createConversation();
      setConversations((prev) => [created, ...prev]);
      setActiveId(created.id);
      setMessages([]);
      setSidebarOpen(false);
    } catch (err) {
      setError(errorMessage(err, 'create a conversation'));
    }
  }, []);

  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      setError(null);
      try {
        await apiClient.deleteConversation(conversationId);
        setConversations((prev) =>
          prev.filter((c) => c.id !== conversationId),
        );
        setActiveId((current) =>
          current === conversationId ? null : current,
        );
      } catch (err) {
        setError(errorMessage(err, 'delete the conversation'));
      }
    },
    [],
  );

  /** Consumes an SSE stream into a placeholder assistant message. */
  const consumeStream = useCallback(
    async (open: () => Promise<Response>) => {
      const placeholderId = `pending-${Date.now()}`;
      setStreaming(true);
      setMessages((prev) => [
        ...prev,
        {
          id: placeholderId,
          role: 'assistant',
          content: '',
          status: 'streaming',
        },
      ]);

      try {
        const response = await open();
        let errored = false;
        for await (const chunk of readChunks(response)) {
          if (chunk.type === 'chunk') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId
                  ? { ...m, content: m.content + chunk.content }
                  : m,
              ),
            );
          } else {
            errored = true;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId ? { ...m, status: 'error' } : m,
              ),
            );
          }
        }
        if (!errored) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === placeholderId ? { ...m, status: 'complete' } : m,
            ),
          );
        }
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderId ? { ...m, status: 'error' } : m,
          ),
        );
        setError(errorMessage(err, 'stream the reply'));
      } finally {
        setStreaming(false);
      }
    },
    [],
  );

  const handleSend = useCallback(
    async (content: string) => {
      if (!activeId) return;
      setError(null);
      setMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: 'user',
          content,
          status: 'complete',
        },
      ]);
      await consumeStream(() => apiClient.streamSend(activeId, content));
    },
    [activeId, consumeStream],
  );

  const handleRegenerate = useCallback(
    async (messageId: string) => {
      if (!activeId) return;
      setError(null);
      await consumeStream(() =>
        apiClient.streamRegenerate(activeId, messageId),
      );
    },
    [activeId, consumeStream],
  );

  const handleCopy = useCallback((content: string) => {
    void navigator.clipboard.writeText(content);
  }, []);

  return (
    <main className="flex h-screen">
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={activeId}
        open={sidebarOpen}
        onSelect={(id) => {
          setActiveId(id);
          setSidebarOpen(false);
        }}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onToggle={() => setSidebarOpen((o) => !o)}
      />

      <section className="flex flex-1 flex-col">
        <header className="flex items-center gap-2 border-b p-3 md:hidden">
          <button
            type="button"
            aria-label="Open sidebar"
            onClick={() => setSidebarOpen(true)}
            className="rounded border px-3 py-2 text-sm"
          >
            ☰
          </button>
          <span className="text-sm font-semibold">VICTOR</span>
        </header>

        {error && (
          <p role="alert" className="border-b bg-red-50 p-2 text-sm text-red-600">
            Unable to {error}
          </p>
        )}

        <MessageList
          messages={messages}
          onCopy={handleCopy}
          onRegenerate={handleRegenerate}
        />

        <MessageInput disabled={streaming || !activeId} onSend={handleSend} />
      </section>
    </main>
  );
}

function errorMessage(err: unknown, action: string): string {
  if (err instanceof ApiError) {
    return `${action}: ${err.message}`;
  }
  return action;
}
