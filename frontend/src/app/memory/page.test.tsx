/**
 * Tests for the `/memory` page (Requirements 9.1, 9.2).
 *
 * Verifies that memories render with their type, created date, last accessed
 * date, and importance; that the type filter and search box narrow the list by
 * re-querying the Backend_API; and that no embedding or internal field is
 * exposed in the rendered output.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MemoryView } from '@/lib/types';
import { apiClient } from '@/lib/api-client';
import MemoryPage from './page';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    listMemories: jest.fn(),
    deleteMemory: jest.fn(),
    deleteAllMemories: jest.fn(),
    updateMemory: jest.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const mockedList = apiClient.listMemories as jest.Mock;

function makeMemory(overrides: Partial<MemoryView> = {}): MemoryView {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    content: 'Prefers concise answers',
    memoryType: 'preference',
    source: 'user_explicit',
    sourceConversationId: null,
    importance: 'high',
    confidence: 0.95,
    status: 'active',
    metadata: {},
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    lastAccessedAt: '2026-01-03T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('renders memories with type, importance, created and last-accessed dates', async () => {
  mockedList.mockResolvedValueOnce([makeMemory()]);

  render(<MemoryPage />);

  expect(await screen.findByText('Prefers concise answers')).toBeInTheDocument();
  expect(screen.getByText('preference')).toBeInTheDocument();
  expect(screen.getByText('high')).toBeInTheDocument();
  expect(screen.getByText(/Created:/)).toBeInTheDocument();
  expect(screen.getByText(/Last accessed:/)).toBeInTheDocument();
});

it('does not expose embeddings or internal fields', async () => {
  mockedList.mockResolvedValueOnce([makeMemory()]);

  const { container } = render(<MemoryPage />);
  await screen.findByText('Prefers concise answers');

  expect(container.textContent).not.toMatch(/embedding/i);
  expect(container.textContent).not.toMatch(/user_id|userId/i);
});

it('narrows results by type filter and search query', async () => {
  mockedList
    .mockResolvedValueOnce([makeMemory(), makeMemory({ id: 'b', content: 'Other' })])
    .mockResolvedValue([makeMemory()]);

  render(<MemoryPage />);
  await screen.findByText('Prefers concise answers');

  fireEvent.change(screen.getByLabelText('Filter by type'), {
    target: { value: 'preference' },
  });
  fireEvent.change(screen.getByLabelText('Search memories'), {
    target: { value: 'concise' },
  });

  await waitFor(() => {
    expect(mockedList).toHaveBeenLastCalledWith({
      memoryType: 'preference',
      search: 'concise',
    });
  });
});
