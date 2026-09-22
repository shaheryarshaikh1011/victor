'use client';

/**
 * `/settings` — lets an authenticated user pick their AI provider and model.
 * The form loads persisted settings and saves updates via the Backend_API
 * settings endpoints (Requirement 2.2). Unsupported pairs are rejected by the
 * backend and surfaced as a validation error (Requirement 2.3).
 */
import { useEffect, useState } from 'react';
import { apiClient, ApiError } from '@/lib/api-client';
import { SUPPORTED_MODELS, SUPPORTED_PROVIDERS } from '@/lib/allow-list';
import type { AIProviderName } from '@/lib/types';

export default function SettingsPage() {
  const [provider, setProvider] = useState<AIProviderName>(
    SUPPORTED_PROVIDERS[0],
  );
  const [model, setModel] = useState<string>(
    SUPPORTED_MODELS[SUPPORTED_PROVIDERS[0]][0],
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    apiClient
      .getSettings()
      .then((settings) => {
        if (!active) return;
        setProvider(settings.provider);
        setModel(settings.model);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'Unable to load settings.',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function handleProviderChange(next: AIProviderName) {
    setProvider(next);
    // Keep the model valid for the selected provider.
    setModel(SUPPORTED_MODELS[next][0]);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const updated = await apiClient.updateSettings({ provider, model });
      setProvider(updated.provider);
      setModel(updated.model);
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Unable to save settings.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-md p-6">
        <p>Loading settings…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-lg border p-6"
        aria-label="AI settings"
      >
        <h1 className="text-xl font-semibold">AI settings</h1>

        <label className="block text-sm">
          Provider
          <select
            value={provider}
            onChange={(e) =>
              handleProviderChange(e.target.value as AIProviderName)
            }
            className="mt-1 w-full rounded border px-3 py-2"
          >
            {SUPPORTED_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          Model
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          >
            {SUPPORTED_MODELS[provider].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-green-600">
            Settings saved.
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </form>
    </main>
  );
}
