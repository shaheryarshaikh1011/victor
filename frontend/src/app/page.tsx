export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">VICTOR</h1>
      <nav className="flex gap-4 text-sm">
        <a href="/chat" className="underline">
          Chat
        </a>
        <a href="/memory" className="underline">
          Memories
        </a>
        <a href="/settings" className="underline">
          Settings
        </a>
      </nav>
    </main>
  );
}
