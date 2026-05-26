import { useEffect, useMemo, useRef, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import type { ObjectiveLevel, Period, User } from '../../types';
import { renderGroupedPeriodOptions } from '../../utils/periodOptions';

const API_URL = import.meta.env.VITE_API_URL || '';

const LEVELS: ObjectiveLevel[] = ['company', 'team', 'individual'];
const LEVEL_LABEL: Record<ObjectiveLevel, string> = { company: 'Company', team: 'Team', individual: 'Individual' };

interface AddToPlanBookmarkProps {
  objectiveId: string;
  size?: 'sm' | 'md';
}

export function AddToPlanBookmark({ objectiveId, size = 'md' }: AddToPlanBookmarkProps) {
  const lists = useOKRStore((s: OKRStore) => s.lists);
  const periods = useOKRStore((s: OKRStore) => s.periods);
  const addItemToList = useOKRStore((s: OKRStore) => s.addItemToList);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filterOwnerId, setFilterOwnerId] = useState('');
  const [filterLevel, setFilterLevel] = useState<ObjectiveLevel | ''>('');
  const [filterPeriodId, setFilterPeriodId] = useState('');
  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (orgUsers.length === 0) {
      fetch(`${API_URL}/api/users`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : { users: [] })
        .then(d => setOrgUsers(d.users || []))
        .catch(err => console.error('Failed to fetch users:', err));
    }
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, orgUsers.length]);

  const plans = useMemo(() => lists.filter(l => l.ownerId && l.periodId), [lists]);
  const filteredPlans = useMemo(() => plans.filter(p => {
    if (filterOwnerId && p.ownerId !== filterOwnerId) return false;
    if (filterLevel && p.level !== filterLevel) return false;
    if (filterPeriodId && p.periodId !== filterPeriodId) return false;
    if (search.trim()) {
      if (!p.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    }
    return true;
  }), [plans, filterOwnerId, filterLevel, filterPeriodId, search]);

  const ownerOptions = useMemo(() => {
    const ids = new Set<string>();
    plans.forEach(p => { if (p.ownerId) ids.add(p.ownerId); });
    return Array.from(ids)
      .map(id => ({ id, name: orgUsers.find(u => u.id === id)?.name || orgUsers.find(u => u.id === id)?.email || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [plans, orgUsers]);

  const periodOptions = useMemo(() => {
    const ids = new Set<string>();
    plans.forEach(p => { if (p.periodId) ids.add(p.periodId); });
    return Array.from(ids)
      .map(id => ({ id, p: periods.find(pp => pp.id === id) }))
      .filter(x => !!x.p)
      .sort((a, b) => (a.p!.startDate || '').localeCompare(b.p!.startDate || ''));
  }, [plans, periods]);

  const iconClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const hasAnyFilter = filterOwnerId || filterLevel || filterPeriodId;

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={(e) => { e.stopPropagation(); setSearch(''); setOpen(!open); }}
        className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50"
        title="Add to Plan"
      >
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-md shadow-lg flex" style={{ width: 480 }}>
          <div className="border-r border-gray-200 bg-gray-50 p-2 space-y-2 flex-shrink-0" style={{ width: 160 }}>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Filters</div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Owner</label>
              <select
                value={filterOwnerId}
                onChange={(e) => setFilterOwnerId(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full text-xs border border-gray-300 rounded px-1 py-0.5 bg-white"
              >
                <option value="">Any</option>
                {ownerOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Level</label>
              <select
                value={filterLevel}
                onChange={(e) => setFilterLevel(e.target.value as ObjectiveLevel | '')}
                onClick={(e) => e.stopPropagation()}
                className="w-full text-xs border border-gray-300 rounded px-1 py-0.5 bg-white"
              >
                <option value="">Any</option>
                {LEVELS.map(lv => <option key={lv} value={lv}>{LEVEL_LABEL[lv]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Period</label>
              <select
                value={filterPeriodId}
                onChange={(e) => setFilterPeriodId(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full text-xs border border-gray-300 rounded px-1 py-0.5 bg-white"
              >
                <option value="">Any</option>
                {renderGroupedPeriodOptions(periodOptions.map(o => o.p as Period))}
              </select>
            </div>
            {hasAnyFilter && (
              <button
                onClick={(e) => { e.stopPropagation(); setFilterOwnerId(''); setFilterLevel(''); setFilterPeriodId(''); }}
                className="text-[11px] text-blue-600 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
          <div className="flex-1 min-w-0 max-h-72 overflow-y-auto">
            <div className="px-2 py-1 border-b border-gray-100 sticky top-0 bg-white">
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Search plans…"
                className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            {plans.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">No plans available.</div>
            ) : filteredPlans.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">No matches.</div>
            ) : (
              filteredPlans.map(p => {
                const already = p.items.some(it => it.objectiveId === objectiveId);
                return (
                  <button
                    key={p.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!already) addItemToList(p.id, objectiveId);
                      setOpen(false);
                    }}
                    disabled={already}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${already ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: p.color || '#6b7280' }} />
                    <span className="flex-1 truncate">{p.name}</span>
                    {already && <span className="text-[10px] text-gray-400">added</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
