import { useEffect, useMemo, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import type { List, ObjectiveLevel, Period, PeriodType, User } from '../../types';

const LEVELS: ObjectiveLevel[] = ['company', 'team', 'individual'];
const LEVEL_LABEL: Record<ObjectiveLevel, string> = { company: 'Company', team: 'Team', individual: 'Individual' };

type DurationType = 'evergreen' | 'quarter' | 'month' | 'week';
const DURATION_TYPES: DurationType[] = ['evergreen', 'quarter', 'month', 'week'];
const DURATION_TYPE_LABEL: Record<DurationType, string> = { evergreen: 'Evergreen', quarter: 'Quarterly', month: 'Monthly', week: 'Weekly' };
const periodDurationType = (p: Period): DurationType => {
  const t = p.type as PeriodType | undefined;
  return t === 'quarter' || t === 'month' || t === 'week' ? t : 'evergreen';
};

const API_URL = import.meta.env.VITE_API_URL || '';

type View = 'dashboard' | 'objectives' | 'plans' | 'views' | 'checklist' | 'progress' | 'updates' | 'lists' | 'logwork' | 'teams' | 'periods' | 'tags' | 'settings' | 'admin' | 'logs';

interface PlansPageProps {
  onViewChange: (view: View) => void;
}

export function PlansPage({ onViewChange }: PlansPageProps) {
  const lists = useOKRStore((s: OKRStore) => s.lists);
  const periods = useOKRStore((s: OKRStore) => s.periods);
  const createList = useOKRStore((s: OKRStore) => s.createList);
  const deleteList = useOKRStore((s: OKRStore) => s.deleteList);
  const updateListParent = useOKRStore((s: OKRStore) => s.updateListParent);
  const setListShared = useOKRStore((s: OKRStore) => s.setListShared);
  const setListLevel = useOKRStore((s: OKRStore) => s.setListLevel);
  const setListOwner = useOKRStore((s: OKRStore) => s.setListOwner);
  const setListPeriod = useOKRStore((s: OKRStore) => s.setListPeriod);
  const setListViewMode = useOKRStore((s: OKRStore) => s.setListViewMode);
  const setPlanFocusListId = useOKRStore((s: OKRStore) => s.setPlanFocusListId);

  const sharedPlans = useOKRStore((s: OKRStore) => s.sharedPlans);
  const fetchSharedPlans = useOKRStore((s: OKRStore) => s.fetchSharedPlans);
  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newOwnerId, setNewOwnerId] = useState('');
  const [newPeriodId, setNewPeriodId] = useState('');
  const [newLevel, setNewLevel] = useState<ObjectiveLevel | ''>('');
  const [newShared, setNewShared] = useState(false);
  const [filterOwnerId, setFilterOwnerId] = useState('');
  const [filterLevel, setFilterLevel] = useState<ObjectiveLevel | ''>('');
  const [filterPeriodId, setFilterPeriodId] = useState('');
  const [filterDurationType, setFilterDurationType] = useState<DurationType | ''>('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [promoteListId, setPromoteListId] = useState<string | null>(null);
  const [promoteOwnerId, setPromoteOwnerId] = useState('');
  const [promotePeriodId, setPromotePeriodId] = useState('');

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch(`${API_URL}/api/users`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setOrgUsers(data.users || []);
        }
      } catch (err) {
        console.error('Failed to fetch users:', err);
      }
    };
    fetchUsers();
    fetchSharedPlans();
  }, [lists, fetchSharedPlans]);

  const allPlansForCount = useMemo(() => {
    const own = lists.filter(l => l.ownerId && l.periodId);
    const byId = new Map<string, List>();
    for (const l of own) byId.set(l.id, l);
    for (const l of sharedPlans) if (!byId.has(l.id)) byId.set(l.id, l);
    return Array.from(byId.values());
  }, [lists, sharedPlans]);

  const periodDurationTypeById = (periodId?: string): DurationType | null => {
    const p = periods.find((pp: Period) => pp.id === periodId);
    return p ? periodDurationType(p) : null;
  };

  const countPlans = (criteria: { ownerId?: string; level?: ObjectiveLevel | ''; periodId?: string; durationType?: DurationType | '' }) => {
    const c = {
      ownerId: criteria.ownerId ?? filterOwnerId,
      level: criteria.level ?? filterLevel,
      periodId: criteria.periodId ?? filterPeriodId,
      durationType: criteria.durationType ?? filterDurationType,
    };
    return allPlansForCount.filter(l =>
      (c.ownerId ? l.ownerId === c.ownerId : true) &&
      (c.level ? l.level === c.level : true) &&
      (c.periodId ? l.periodId === c.periodId : true) &&
      (c.durationType ? periodDurationTypeById(l.periodId) === c.durationType : true)
    ).length;
  };

  const periodMatchesDurationType = (periodId?: string) => {
    if (!filterDurationType) return true;
    const p = periods.find((pp: Period) => pp.id === periodId);
    if (!p) return false;
    return periodDurationType(p) === filterDurationType;
  };
  const matchesFilters = (l: List) =>
    (filterOwnerId ? l.ownerId === filterOwnerId : true) &&
    (filterLevel ? l.level === filterLevel : true) &&
    (filterPeriodId ? l.periodId === filterPeriodId : true) &&
    periodMatchesDurationType(l.periodId);

  const planLists = useMemo(
    () => lists
      .filter(l => l.ownerId && l.periodId)
      .filter(matchesFilters)
      .sort((a, b) => a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lists, filterOwnerId, filterLevel, filterPeriodId, filterDurationType, periods]
  );
  const filteredSharedPlans = useMemo(
    () => sharedPlans.filter(matchesFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sharedPlans, filterOwnerId, filterLevel, filterPeriodId, filterDurationType, periods]
  );
  const nonPlanLists = useMemo(
    () => lists.filter(l => !(l.ownerId && l.periodId)).sort((a, b) => a.name.localeCompare(b.name)),
    [lists]
  );

  const ownerName = (id?: string) => id ? (orgUsers.find(u => u.id === id)?.name || orgUsers.find(u => u.id === id)?.email || id) : '—';
  const periodName = (id?: string) => id ? (periods.find((p: Period) => p.id === id)?.name || id) : '—';

  const openPlan = (list: List) => {
    // Fire-and-forget so navigation isn't blocked on the preference PUT.
    setListViewMode(list.id, 'plan');
    setPlanFocusListId(list.id);
    try { window.localStorage.setItem('okr-lists-pending-selection', list.id); } catch { /* ignore */ }
    onViewChange('lists');
  };

  const handleCreate = async () => {
    setCreateError(null);
    const name = newName.trim();
    if (!name || !newOwnerId || !newPeriodId) {
      setCreateError('Name, Owner, and Period are required.');
      return;
    }
    setCreating(true);
    try {
      const result = await createList(name, undefined, undefined, { ownerId: newOwnerId, periodId: newPeriodId, level: newLevel || undefined, shared: newShared });
      if (result && typeof result === 'object' && 'error' in result) {
        setCreateError(result.error);
        return;
      }
      setShowCreate(false);
      setNewName('');
      setNewOwnerId('');
      setNewPeriodId('');
      setNewLevel('');
      setNewShared(false);
    } finally {
      setCreating(false);
    }
  };

  const handlePromote = async () => {
    const list = lists.find(l => l.id === promoteListId);
    if (!list || !promoteOwnerId || !promotePeriodId) return;
    // Apply ownerId then periodId via the parent-update endpoint (which now handles any field).
    await updateListParent(list.id, list.parentId || null); // no-op for parent
    // We don't have a dedicated setter; use a direct fetch via createList? Instead, use updateList?
    // Simpler: send a PUT with both fields.
    try {
      await fetch(`${API_URL}/api/users/me/lists/${list.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: promoteOwnerId, periodId: promotePeriodId }),
      });
      // Optimistic local update
      useOKRStore.setState({
        lists: useOKRStore.getState().lists.map(l =>
          l.id === list.id ? { ...l, ownerId: promoteOwnerId, periodId: promotePeriodId } : l
        ),
      });
    } catch (err) {
      console.error('Failed to promote list:', err);
    }
    setPromoteListId(null);
    setPromoteOwnerId('');
    setPromotePeriodId('');
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Plans</h2>
            <p className="text-sm text-gray-500 mt-1">
              {planLists.length} {planLists.length === 1 ? 'plan' : 'plans'} (a plan is a list with an owner and a period)
            </p>
          </div>
          <button
            onClick={() => { setNewName(''); setNewOwnerId(''); setNewPeriodId(''); setNewLevel(''); setCreateError(null); setShowCreate(true); }}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + Create plan
          </button>
        </div>

        <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-3 bg-gray-50 flex-wrap">
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500">Duration Type</label>
            <select
              value={filterDurationType}
              onChange={(e) => {
                const next = e.target.value as DurationType | '';
                setFilterDurationType(next);
                if (next && filterPeriodId) {
                  const p = periods.find((pp: Period) => pp.id === filterPeriodId);
                  if (!p || periodDurationType(p) !== next) setFilterPeriodId('');
                }
              }}
              className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
            >
              <option value="">Any type ({countPlans({ durationType: '' })})</option>
              {DURATION_TYPES.map(dt => <option key={dt} value={dt}>{DURATION_TYPE_LABEL[dt]} ({countPlans({ durationType: dt })})</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500">Duration</label>
            <select
              value={filterPeriodId}
              onChange={(e) => setFilterPeriodId(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
            >
              <option value="">Any duration ({countPlans({ periodId: '' })})</option>
              {[...periods]
                .filter((p: Period) => !filterDurationType || periodDurationType(p) === filterDurationType)
                .sort((a, b) => a.startDate.localeCompare(b.startDate))
                .map((p: Period) => (
                  <option key={p.id} value={p.id}>{p.name} ({countPlans({ periodId: p.id })})</option>
                ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500">Level</label>
            <select
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value as ObjectiveLevel | '')}
              className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
            >
              <option value="">Any level ({countPlans({ level: '' })})</option>
              {LEVELS.map(lv => <option key={lv} value={lv}>{LEVEL_LABEL[lv]} ({countPlans({ level: lv })})</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500">Owner</label>
            <select
              value={filterOwnerId}
              onChange={(e) => setFilterOwnerId(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
            >
              <option value="">Any owner ({countPlans({ ownerId: '' })})</option>
              {[...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
                <option key={u.id} value={u.id}>{u.name || u.email} ({countPlans({ ownerId: u.id })})</option>
              ))}
            </select>
          </div>
          {(filterOwnerId || filterLevel || filterPeriodId || filterDurationType) && (
            <button
              onClick={() => { setFilterOwnerId(''); setFilterLevel(''); setFilterPeriodId(''); setFilterDurationType(''); }}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Clear
            </button>
          )}
        </div>

        {planLists.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            {lists.some(l => l.ownerId && l.periodId)
              ? 'No plans match the current filter.'
              : 'No plans yet. Click "Create plan" to make one.'}
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Owner</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Level</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sharing</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {planLists.map(list => (
                <tr key={list.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">
                    <button
                      onClick={() => openPlan(list)}
                      className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-left flex items-center gap-2"
                    >
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: list.color || '#6b7280' }} />
                      {list.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    <select
                      value={list.ownerId || ''}
                      onChange={(e) => setListOwner(list.id, e.target.value)}
                      className="border border-gray-300 rounded px-1.5 py-0.5 text-xs bg-white max-w-[160px]"
                    >
                      <option value="">— None —</option>
                      {[...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
                        <option key={u.id} value={u.id}>{u.name || u.email}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    <select
                      value={list.periodId || ''}
                      onChange={(e) => setListPeriod(list.id, e.target.value)}
                      className="border border-gray-300 rounded px-1.5 py-0.5 text-xs bg-white max-w-[160px]"
                    >
                      <option value="">— None —</option>
                      {[...periods].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((p: Period) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    <select
                      value={list.level || ''}
                      onChange={(e) => setListLevel(list.id, e.target.value as ObjectiveLevel | '')}
                      className="border border-gray-300 rounded px-1.5 py-0.5 text-xs bg-white"
                    >
                      <option value="">—</option>
                      {LEVELS.map(lv => <option key={lv} value={lv}>{LEVEL_LABEL[lv]}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{list.items.length}</td>
                  <td className="px-4 py-3 text-sm">
                    <button
                      onClick={() => setListShared(list.id, !list.shared)}
                      className={`px-2 py-0.5 text-xs rounded border ${list.shared ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100' : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'}`}
                      title={list.shared ? 'Click to make private' : 'Click to share with org'}
                    >
                      {list.shared ? 'Shared' : 'Private'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { if (window.confirm(`Delete plan "${list.name}"? This removes the list and its items.`)) deleteList(list.id); }}
                      className="p-1 text-gray-400 hover:text-red-600 rounded"
                      title="Delete plan"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {filteredSharedPlans.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-base font-semibold text-gray-900">Shared plans from others</h3>
            <p className="text-xs text-gray-500 mt-1">Plans your teammates have shared with the org. View-only here.</p>
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Owner</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Level</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Shared by</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {filteredSharedPlans.map(list => (
                <tr key={list.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">
                    <button
                      onClick={() => { setPlanFocusListId(list.id); window.localStorage.setItem('okr-lists-pending-selection', list.id); onViewChange('lists'); }}
                      className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-left flex items-center gap-2"
                    >
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: list.color || '#6b7280' }} />
                      {list.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{ownerName(list.ownerId)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{periodName(list.periodId)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{list.level ? LEVEL_LABEL[list.level] : '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{list.items.length}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{list.createdByEmail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nonPlanLists.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-base font-semibold text-gray-900">Lists without an owner & period</h3>
            <p className="text-xs text-gray-500 mt-1">Promote any of these to a plan by adding both.</p>
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {nonPlanLists.map(list => (
                <tr key={list.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: list.color || '#6b7280' }} />
                    {list.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{list.items.length}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { setPromoteListId(list.id); setPromoteOwnerId(''); setPromotePeriodId(''); }}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      Convert to plan →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Create plan</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Owner</label>
                <select
                  value={newOwnerId}
                  onChange={(e) => setNewOwnerId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">— Pick an owner —</option>
                  {[...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Period</label>
                <select
                  value={newPeriodId}
                  onChange={(e) => setNewPeriodId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">— Pick a period —</option>
                  {[...periods].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((p: Period) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Level</label>
                <select
                  value={newLevel}
                  onChange={(e) => setNewLevel(e.target.value as ObjectiveLevel | '')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">— Optional —</option>
                  {LEVELS.map(lv => <option key={lv} value={lv}>{LEVEL_LABEL[lv]}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newShared}
                  onChange={(e) => setNewShared(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Shared with the org <span className="text-xs text-gray-400">(default: private)</span></span>
              </label>
              {createError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{createError}</div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                disabled={creating}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim() || !newOwnerId || !newPeriodId}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {promoteListId && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Convert to plan</h3>
            <p className="text-xs text-gray-600 mb-3">
              Pick an owner and a period to convert "{lists.find(l => l.id === promoteListId)?.name}" into a plan.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Owner</label>
                <select
                  value={promoteOwnerId}
                  onChange={(e) => setPromoteOwnerId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">— Pick an owner —</option>
                  {[...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Period</label>
                <select
                  value={promotePeriodId}
                  onChange={(e) => setPromotePeriodId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">— Pick a period —</option>
                  {[...periods].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((p: Period) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPromoteListId(null)}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handlePromote}
                disabled={!promoteOwnerId || !promotePeriodId}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Convert
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
