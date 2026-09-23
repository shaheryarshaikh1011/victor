'use client';

/**
 * `/memory` — lets an authenticated user view, search, filter, edit, and delete
 * their stored memories (Requirement 9.1). Each item shows its type, created
 * date, last accessed date, and importance (Requirement 9.2). Embeddings and
 * other internal fields are never rendered — the page only consumes the
 * API-safe `MemoryView`.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiClient, ApiError } from '@/lib/api-client';
import type { MemoryType, MemoryView } from '@/lib/types';

const MEMORY_TYPES: MemoryType[] = [
  'explicit',
  'preference',
  'personal_fact',
  'episodic',
  'behavioral',
];

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

export default function MemoryPage() {
  const [memories, setMemories] = useState<MemoryView[]>([]);
  const [typeFilter, setTypeFilter] = useState<MemoryType | ''>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemoryView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.listMemories({
        memoryType: typeFilter || undefined,
        search: search.trim() || undefined,
      });
      setMemories(result);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Unable to load memories.',
      );
    } finally {
      setLoading(false);
    }
  }, [typeFilter, search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(id: string) {
    try {
      await apiClient.deleteMemory(id);
      setMemories((prev) => prev.filter((memory) => memory.id !== id));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Unable to delete memory.',
      );
    }
  }

  async function handleDeleteAll() {
    try {
      await apiClient.deleteAllMemories();
      setMemories([]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Unable to delete memories.',
      );
    }
  }

  async function handleSaveEdit(id: string, content: string) {
    try {
      const updated = await apiClient.updateMemory(id, { content });
      setMemories((prev) =>
        prev.map((memory) => (memory.id === id ? updated : memory)),
      );
      setEditing(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Unable to update memory.',
      );
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/chat" className="text-sm underline">
            ← Chat
          </a>
          <h1 className="text-xl font-semibold">Memories</h1>
        </div>
        <button
          type="button"
          onClick={handleDeleteAll}
          className="rounded border px-3 py-2 text-sm text-red-600 hover:bg-red-50"
        >
          Delete all
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memories"
          aria-label="Search memories"
          className="flex-1 rounded border px-3 py-2 text-sm"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as MemoryType | '')}
          aria-label="Filter by type"
          className="rounded border px-3 py-2 text-sm"
        >
          <option value="">All types</option>
          {MEMORY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}

      {loading ? (
        <p>Loading memories…</p>
      ) : memories.length === 0 ? (
        <p className="text-sm text-gray-400">No memories found.</p>
      ) : (
        <ul className="space-y-3">
          {memories.map((memory) => (
            <li key={memory.id} className="rounded-lg border p-4">
              <p className="mb-2 text-sm">{memory.content}</p>
              <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <div>
                  <dt className="inline font-medium">Type: </dt>
                  <dd className="inline">{memory.memoryType}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Importance: </dt>
                  <dd className="inline">{memory.importance}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Created: </dt>
                  <dd className="inline">{formatDate(memory.createdAt)}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Last accessed: </dt>
                  <dd className="inline">{formatDate(memory.lastAccessedAt)}</dd>
                </div>
              </dl>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(memory)}
                  className="rounded border px-3 py-1 text-xs hover:bg-gray-100"
                >
                  Edit
                </button>
                <button
                  type="button"
                  aria-label={`Delete memory ${memory.content}`}
                  onClick={() => handleDelete(memory.id)}
                  className="rounded border px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <EditMemoryModal
          memory={editing}
          onCancel={() => setEditing(null)}
          onSave={handleSaveEdit}
        />
      )}
    </main>
  );
}

interface EditMemoryModalProps {
  memory: MemoryView;
  onCancel: () => void;
  onSave: (id: string, content: string) => void;
}

function EditMemoryModal({ memory, onCancel, onSave }: EditMemoryModalProps) {
  const [content, setContent] = useState(memory.content);

  return (
    <div
      role="dialog"
      aria-label="Edit memory"
      aria-modal="true"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6">
        <h2 className="mb-3 text-lg font-semibold">Edit memory</h2>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          aria-label="Memory content"
          rows={4}
          className="w-full rounded border px-3 py-2 text-sm"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border px-3 py-2 text-sm hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(memory.id, content)}
            className="rounded bg-black px-3 py-2 text-sm text-white"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
