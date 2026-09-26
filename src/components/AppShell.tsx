import type { ReactNode } from 'react';

export interface AppShellProps {
  children: ReactNode;
  onHome?: () => void;
  onHistory?: () => void;
  /** Hidden while a session is running so nothing competes with the exercise. */
  showNav?: boolean;
}

export default function AppShell({ children, onHome, onHistory, showNav = true }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <button
            type="button"
            onClick={onHome}
            className="flex items-center gap-3 text-2xl font-bold tracking-tight"
          >
            <span aria-hidden className="inline-block h-7 w-1.5 rounded-full bg-brand" />
            Midline
          </button>
          {showNav && onHistory && (
            <button type="button" className="btn-quiet" onClick={onHistory}>
              History
            </button>
          )}
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line bg-surface">
        <p className="mx-auto w-full max-w-4xl px-5 py-4 text-base text-ink-soft sm:px-8">
          Midline is a practice and progress-tracking tool, not a medical device. Everything runs on
          this computer - no video ever leaves it.
        </p>
      </footer>
    </div>
  );
}
