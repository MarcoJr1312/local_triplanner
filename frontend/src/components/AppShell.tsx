import { Link, useNavigate } from 'react-router-dom';
import { Compass, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { mode } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-brand-400 text-white shadow-sm">
              <Compass className="h-5 w-5" />
            </span>
            <span className="text-lg font-bold tracking-tight text-slate-900">Triplanner</span>
          </Link>

          <div className="flex items-center gap-3">
            {mode === 'mock' && (
              <span className="hidden rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200/70 sm:inline-block">
                Modo demo
              </span>
            )}
            {user && (
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-semibold text-white ring-2 ring-white shadow-sm">
                  {user.displayName.slice(0, 1).toUpperCase()}
                </div>
                <span className="hidden text-sm font-medium text-slate-700 sm:inline">{user.displayName}</span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-lg p-1.5 text-slate-400 transition duration-150 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                  aria-label="Cerrar sesión"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-slate-200/70 bg-white/60 py-4">
        <p className="text-center text-xs text-slate-400">
          Triplanner ·{' '}
          {mode === 'local'
            ? 'Entorno local — backend GraphQL + SQLite · sin conexión a AWS'
            : 'Demo local — datos simulados, sin conexión a AWS'}
        </p>
      </footer>
    </div>
  );
}
