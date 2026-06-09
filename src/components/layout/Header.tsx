import { useEffect, useRef, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../common/Modal';
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
  const { user, logout, organization, isSuperAdmin, impersonating, impersonate, stopImpersonating } = useAuth();
  const [storedName, setStoredName] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Close the user dropdown on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <>
      {impersonating && (
        <div className="bg-amber-500 text-white px-6 py-2 flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span>
              Viewing as <span className="font-semibold">{impersonating.name}</span>
              <span className="opacity-90"> ({impersonating.email})</span>
            </span>
          </span>
          <button
            onClick={() => { stopImpersonating(); }}
            className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded font-medium transition-colors"
          >
            Stop impersonating
          </button>
        </div>
      )}
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
                {isSuperAdmin && !impersonating ? (
                  <div className="relative" ref={menuRef}>
                    <button
                      onClick={() => setMenuOpen(o => !o)}
                      className="flex items-center gap-1.5 text-sm text-left rounded hover:bg-gray-100 px-2 py-1 transition-colors"
                    >
                      <div>
                        <p className="font-medium text-gray-700">{storedName || user.name}</p>
                        {organization && (
                          <p className="text-xs text-gray-500">({organization.name})</p>
                        )}
                      </div>
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {menuOpen && (
                      <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1">
                        <button
                          onClick={() => { setMenuOpen(false); setPickerOpen(true); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 text-left"
                        >
                          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          Impersonate user
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm">
                    <p className="font-medium text-gray-700">{storedName || user.name}</p>
                    {organization && (
                      <p className="text-xs text-gray-500">({organization.name})</p>
                    )}
                  </div>
                )}
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
      {pickerOpen && (
        <ImpersonatePicker
          currentEmail={user?.email}
          onClose={() => setPickerOpen(false)}
          onPick={(email) => impersonate(email)}
        />
      )}
    </>
  );
}

interface PickerUser extends User {
  organizationName?: string;
}

function ImpersonatePicker({
  currentEmail,
  onClose,
  onPick,
}: {
  currentEmail?: string;
  onClose: () => void;
  onPick: (email: string) => Promise<void>;
}) {
  const [users, setUsers] = useState<PickerUser[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/users`, { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load users');
        const data = await res.json();
        if (!cancelled) setUsers((data.users as PickerUser[]) || []);
      } catch {
        if (!cancelled) setError('Could not load users');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = users
    .filter(u => u.email?.toLowerCase() !== currentEmail?.toLowerCase())
    .filter(u =>
      !q ||
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.organizationName?.toLowerCase().includes(q)
    )
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const handlePick = async (email: string) => {
    setPending(email);
    setError(null);
    try {
      await onPick(email);
      // onPick triggers a full reload on success; keep spinner until then.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to impersonate');
      setPending(null);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Impersonate user">
      <div className="space-y-3">
        <p className="text-sm text-gray-500">
          Pick a user to view the app exactly as they see it. You can stop anytime from the banner at the top.
        </p>
        <input
          type="text"
          autoFocus
          placeholder="Search by name, email, or organization…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="max-h-80 overflow-y-auto border border-gray-100 rounded-md divide-y divide-gray-100">
          {loading ? (
            <p className="text-sm text-gray-400 px-3 py-4 text-center">Loading users…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 px-3 py-4 text-center">No matching users.</p>
          ) : (
            filtered.map((u) => (
              <button
                key={u.email}
                onClick={() => handlePick(u.email)}
                disabled={pending !== null}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-60"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{u.name || u.email}</p>
                  <p className="text-xs text-gray-500 truncate">{u.email}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {u.organizationName && (
                    <span className="text-xs text-gray-400">{u.organizationName}</span>
                  )}
                  {pending === u.email && (
                    <svg className="w-4 h-4 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
