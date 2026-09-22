'use client';

/**
 * `/signup` — creates a User_Profile through the Backend_API (Requirement 1.1),
 * then establishes a session by logging in so the new user lands authenticated.
 * A duplicate email surfaces as a conflict message (Requirement 1.2).
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiClient, ApiError } from '@/lib/api-client';
import { setAccessToken } from '@/lib/session';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.signup({
        email,
        password,
        displayName: displayName.trim() ? displayName.trim() : undefined,
      });
      const session = await apiClient.login({ email, password });
      setAccessToken(session.accessToken);
      router.push('/chat');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Unable to sign up. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border p-6"
        aria-label="Sign up"
      >
        <h1 className="text-xl font-semibold">Create your VICTOR account</h1>

        <label className="block text-sm">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
            autoComplete="email"
          />
        </label>

        <label className="block text-sm">
          Display name (optional)
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
            autoComplete="name"
          />
        </label>

        <label className="block text-sm">
          Password
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
            autoComplete="new-password"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {submitting ? 'Creating account…' : 'Sign up'}
        </button>

        <p className="text-center text-sm">
          Already have an account?{' '}
          <a href="/login" className="underline">
            Log in
          </a>
        </p>
      </form>
    </main>
  );
}
