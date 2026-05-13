import { useEffect, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import type { Period, User } from '../../types';
import { APP_VERSION } from '../../version';

const API_URL = import.meta.env.VITE_API_URL || '';

interface HeaderProps {
  onAddObjective: () => void;
}

export function Header({ onAddObjective }: HeaderProps) {
  const periods = useOKRStore((state: OKRStore) => state.periods);
  const activePeriodId = useOKRStore((state: OKRStore) => state.activePeriodId);
  const setActivePeriod = useOKRStore((state: OKRStore) => state.setActivePeriod);
  const { user, logout, organization } = useAuth();
  const [storedName, setStoredName] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/api/users`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const me = (data.users as User[] | undefined)?.find(u => u.email === user.email);
        if (!cancelled && me?.name) setStoredName(me.name);
      } catch {
        /* ignore */
      }
    };
    load();
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ email?: string; name?: string }>).detail;
      if (detail?.email && detail.email.toLowerCase() === user.email.toLowerCase() && detail.name) {
        setStoredName(detail.name);
      } else {
        load();
      }
    };
    window.addEventListener('user-name-updated', handler);
    return () => { cancelled = true; window.removeEventListener('user-name-updated', handler); };
  }, [user?.email]);

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">OKR Lite</h1>
            <span className="text-xs text-gray-400">v{APP_VERSION}</span>
          </div>
          {periods.length > 0 && (
            <select
              value={activePeriodId || ''}
              onChange={(e) => setActivePeriod(e.target.value || null)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Periods</option>
              {periods.map((period: Period) => (
                <option key={period.id} value={period.id}>
                  {period.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={onAddObjective}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            + Add Objective
          </button>
          {user && (
            <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
              <div className="text-sm">
                <p className="font-medium text-gray-700">{storedName || user.name}</p>
                {organization && (
                  <p className="text-xs text-gray-500">({organization.name})</p>
                )}
              </div>
              <button
                onClick={logout}
                className="text-gray-500 hover:text-gray-700 p-1.5 rounded hover:bg-gray-100 transition-colors"
                title="Sign out"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
