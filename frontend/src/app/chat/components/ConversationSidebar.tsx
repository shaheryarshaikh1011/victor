'use client';

/**
 * ConversationSidebar — lists the caller's conversations and exposes controls
 * to create a new conversation (Requirement 3.1) and delete an existing one
 * (Requirement 3.4). On mobile viewports the sidebar is collapsible
 * (Requirement 8.5); the parent controls its open/closed state.
 */
import type { Conversation } from '@/lib/types';

export interface ConversationSidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  /** Whether the sidebar is visible; used to drive the mobile collapse. */
  open: boolean;
  onSelect: (conversationId: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onToggle: () => void;
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  open,
  onSelect,
  onNewConversation,
  onDeleteConversation,
  onToggle,
}: ConversationSidebarProps) {
  return (
    <aside
      aria-label="Conversations"
      data-open={open}
      className={[
        'flex w-64 shrink-0 flex-col border-r bg-gray-50',
        // Collapsible on mobile: hidden below the md breakpoint when closed.
        open ? 'flex' : 'hidden',
        'md:flex',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2 p-3">
        <button
          type="button"
          onClick={onNewConversation}
          className="flex-1 rounded bg-black px-3 py-2 text-sm text-white"
        >
          New conversation
        </button>
        <button
          type="button"
          aria-label="Collapse sidebar"
          onClick={onToggle}
          className="rounded border px-2 py-2 text-sm md:hidden"
        >
          ✕
        </button>
      </div>

      <ul className="flex-1 overflow-y-auto p-2">
        {conversations.map((conversation) => {
          const isActive = conversation.id === activeConversationId;
          return (
            <li key={conversation.id} className="group flex items-center">
              <button
                type="button"
                onClick={() => onSelect(conversation.id)}
                aria-current={isActive ? 'true' : undefined}
                className={[
                  'flex-1 truncate rounded px-3 py-2 text-left text-sm',
                  isActive ? 'bg-gray-200 font-medium' : 'hover:bg-gray-100',
                ].join(' ')}
              >
                {conversation.title}
              </button>
              <button
                type="button"
                aria-label={`Delete conversation ${conversation.title}`}
                onClick={() => onDeleteConversation(conversation.id)}
                className="ml-1 rounded px-2 py-1 text-sm text-gray-400 hover:text-red-600"
              >
                🗑
              </button>
            </li>
          );
        })}
        {conversations.length === 0 && (
          <li className="px-3 py-2 text-sm text-gray-400">
            No conversations yet.
          </li>
        )}
      </ul>
    </aside>
  );
}
