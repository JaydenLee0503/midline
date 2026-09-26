import type { ReactNode } from 'react';

export interface AppShellProps {
  children: ReactNode;
  onHome?: () => void;
  onHistory?: () => void;
  onGame?: () => void;
  /** Hidden while a session is running so nothing competes with the exercise. */
  showNav?: boolean;
  /** The landing page carries its own artwork, header treatment and footer. */
  variant?: 'default' | 'landing';
}

export default function AppShell({
  children,
  onHome,
  onHistory,
  onGame,
  showNav = true,
  variant = 'default',
}: AppShellProps) {
  const landing = variant === 'landing';
  const navClass = 'btn-quiet';

  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className={
          landing
            ? 'absolute inset-x-0 top-0 z-20'
            : 'border-b border-line bg-surface'
        }
      >
        <div
          className={`mx-auto flex w-full items-center justify-between gap-4 px-5 py-4 sm:px-8 ${
            landing ? 'max-w-6xl sm:px-10 sm:py-6' : 'max-w-4xl'
          }`}
        >
          <button
            type="button"
            onClick={onHome}
            className="flex items-center gap-3 text-2xl font-extrabold tracking-tight text-ink"
          >
            <span aria-hidden className="inline-block h-7 w-2 bg-brand" />
            Midline
          </button>
          {showNav && (
            <nav className="flex items-center gap-2 sm:gap-4">
              {onGame && (
                <button type="button" className={navClass} onClick={onGame}>
                  Game
                </button>
              )}
              {onHistory && (
                <button type="button" className={navClass} onClick={onHistory}>
                  History
                </button>
              )}
            </nav>
          )}
        </div>
      </header>

      <main className="flex-1">{children}</main>

      {!landing && (
        <footer className="border-t border-line bg-surface">
          <p className="mx-auto w-full max-w-4xl px-5 py-4 text-base text-ink-soft sm:px-8">
            Midline is a practice and progress-tracking tool, not a medical device. Everything runs
            on this computer - no video ever leaves it.
          </p>
        </footer>
      )}
    </div>
  );
}
