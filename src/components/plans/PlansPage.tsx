import { useEffect, useMemo, useRef, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import type { List, ObjectiveLevel, Period, PeriodType, User } from '../../types';
import { renderGroupedPeriodOptions } from '../../utils/periodOptions';

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
  const renameList = useOKRStore((s: OKRStore) => s.renameList);
  const addItemToList = useOKRStore((s: OKRStore) => s.addItemToList);
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
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>(() => {
    try { const v = localStorage.getItem('okr-plans-view-mode'); return v === 'grouped' ? 'grouped' : 'list'; } catch { return 'list'; }
  });
  const [groupedOwnerId, setGroupedOwnerId] = useState<string>(() => {
    try { return localStorage.getItem('okr-plans-grouped-owner') || ''; } catch { return ''; }
  });
  const [groupedPeriodId, setGroupedPeriodId] = useState<string>(() => {
    try { return localStorage.getItem('okr-plans-grouped-period') || ''; } catch { return ''; }
  });
  const [groupedLevel, setGroupedLevel] = useState<ObjectiveLevel | '' | '__none__'>(() => {
    try {
      const v = localStorage.getItem('okr-plans-grouped-level') || '';
      if (v === 'company' || v === 'team' || v === 'individual' || v === '__none__') return v;
      return '';
    } catch { return ''; }
  });
  useEffect(() => { try { localStorage.setItem('okr-plans-view-mode', viewMode); } catch { /* ignore */ } }, [viewMode]);
  useEffect(() => { try { localStorage.setItem('okr-plans-grouped-owner', groupedOwnerId); } catch { /* ignore */ } }, [groupedOwnerId]);
  useEffect(() => { try { localStorage.setItem('okr-plans-grouped-period', groupedPeriodId); } catch { /* ignore */ } }, [groupedPeriodId]);
  useEffect(() => { try { localStorage.setItem('okr-plans-grouped-level', groupedLevel); } catch { /* ignore */ } }, [groupedLevel]);
  const loadWidth = (key: string, fallback: number) => {
    try { const v = localStorage.getItem(key); const n = v ? parseFloat(v) : NaN; return Number.isFinite(n) && n >= 5 && n <= 80 ? n : fallback; } catch { return fallback; }
  };
  const [groupedCol1Width, setGroupedCol1Width] = useState<number>(() => loadWidth('okr-plans-grouped-col1', 15));
  const [groupedCol2Width, setGroupedCol2Width] = useState<number>(() => loadWidth('okr-plans-grouped-col2', 15));
  const [groupedCol3Width, setGroupedCol3Width] = useState<number>(() => loadWidth('okr-plans-grouped-col3', 15));
  const groupedSplitRef = useRef<HTMLDivElement>(null);
  const groupedDragRef = useRef<1 | 2 | 3 | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!groupedDragRef.current || !groupedSplitRef.current) return;
      const rect = groupedSplitRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      if (groupedDragRef.current === 1) {
        const max = 100 - groupedCol2Width - groupedCol3Width - 10;
        setGroupedCol1Width(Math.max(5, Math.min(max, pct)));
      } else if (groupedDragRef.current === 2) {
        const w = pct - groupedCol1Width;
        const max = 100 - groupedCol1Width - groupedCol3Width - 10;
        setGroupedCol2Width(Math.max(5, Math.min(max, w)));
      } else {
        const w = pct - groupedCol1Width - groupedCol2Width;
        const max = 100 - groupedCol1Width - groupedCol2Width - 10;
        setGroupedCol3Width(Math.max(5, Math.min(max, w)));
      }
    };
    const onUp = () => {
      if (!groupedDragRef.current) return;
      groupedDragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem('okr-plans-grouped-col1', String(Math.round(groupedCol1Width * 10) / 10));
        localStorage.setItem('okr-plans-grouped-col2', String(Math.round(groupedCol2Width * 10) / 10));
        localStorage.setItem('okr-plans-grouped-col3', String(Math.round(groupedCol3Width * 10) / 10));
      } catch { /* ignore */ }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [groupedCol1Width, groupedCol2Width, groupedCol3Width]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [promoteListId, setPromoteListId] = useState<string | null>(null);
  const [promoteOwnerId, setPromoteOwnerId] = useState('');
  const [promotePeriodId, setPromotePeriodId] = useState('');
  const [editListId, setEditListId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [cloningListId, setCloningListId] = useState<string | null>(null);

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

  const ownerSortKey = (id?: string) => {
    if (!id) return '~';
    const u = orgUsers.find(uu => uu.id === id);
    return (u?.name || u?.email || id).toLowerCase();
  };
  const levelRank = (lv?: ObjectiveLevel) => {
    if (lv === 'company') return 0;
    if (lv === 'team') return 1;
    if (lv === 'individual') return 2;
    return 3;
  };
  const periodSortKey = (id?: string): [string, string] => {
    if (!id) return ['~', '~'];
    const p = periods.find(pp => pp.id === id);
    return [p?.startDate || '~', p?.endDate || '~'];
  };
  const planLists = useMemo(
    () => lists
      .filter(l => l.ownerId && l.periodId)
      .filter(matchesFilters)
      .sort((a, b) => {
        const ao = ownerSortKey(a.ownerId), bo = ownerSortKey(b.ownerId);
        if (ao !== bo) return ao.localeCompare(bo);
        const al = levelRank(a.level), bl = levelRank(b.level);
        if (al !== bl) return al - bl;
        const [as, ae] = periodSortKey(a.periodId);
        const [bs, be] = periodSortKey(b.periodId);
        if (as !== bs) return as.localeCompare(bs);
        if (ae !== be) return ae.localeCompare(be);
        return a.name.localeCompare(b.name);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lists, filterOwnerId, filterLevel, filterPeriodId, filterDurationType, periods, orgUsers]
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

  const handleClone = async (list: List) => {
    if (cloningListId) return;
    setCloningListId(list.id);
    try {
      const existingNames = new Set(lists.map(l => l.name));
      let candidate = `${list.name} (cloned)`;
      let i = 2;
      while (existingNames.has(candidate)) {
        candidate = `${list.name} (cloned ${i++})`;
      }
      const result = await createList(candidate, list.color, list.parentId, {
        ownerId: list.ownerId,
        periodId: list.periodId,
        level: list.level,
        shared: list.shared,
      });
      if (result && typeof result === 'object' && 'id' in result) {
        for (const item of list.items) {
          await addItemToList(result.id, item.objectiveId);
        }
      }
    } finally {
      setCloningListId(null);
    }
  };

  const handleSaveEdit = async () => {
    if (!editListId) return;
    const name = editName.trim();
    if (!name) { setEditError('Name is required.'); return; }
    const list = lists.find(l => l.id === editListId);
    if (!list) { setEditError('Plan not found.'); return; }
    if (name !== list.name && lists.some(l => l.id !== editListId && l.name === name)) {
      setEditError(`A list named "${name}" already exists.`);
      return;
    }
    setEditSaving(true);
    try {
      if (name !== list.name) await renameList(editListId, name);
      setEditListId(null);
    } finally {
      setEditSaving(false);
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
          <div className="flex items-center gap-2">
            <div className="inline-flex border border-gray-300 rounded overflow-hidden">
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 text-sm ${viewMode === 'list' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                List
              </button>
              <button
                onClick={() => setViewMode('grouped')}
                className={`px-3 py-1.5 text-sm border-l border-gray-300 ${viewMode === 'grouped' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Grouped
              </button>
            </div>
            <button
              onClick={() => { setNewName(''); setNewOwnerId(''); setNewPeriodId(''); setNewLevel(''); setCreateError(null); setShowCreate(true); }}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              + Create plan
            </button>
            <button
              onClick={async () => {
                const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
                const baseName = `Untitled-${ts}`;
                let name = baseName;
                let i = 2;
                const existing = new Set(lists.map(l => l.name));
                while (existing.has(name)) { name = `${baseName} (${i++})`; }
                const result = await createList(name);
                if (result && typeof result === 'object' && 'id' in result) {
                  setPlanFocusListId(result.id);
                  onViewChange('planbuilder');
                }
              }}
              className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              Plan Builder
            </button>
          </div>
        </div>

        {viewMode === 'list' && (
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
              {renderGroupedPeriodOptions(
                periods.filter((p: Period) => !filterDurationType || periodDurationType(p) === filterDurationType),
                { optionLabel: (p) => `${p.name} (${countPlans({ periodId: p.id })})` }
              )}
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
        )}

        {viewMode === 'list' && (planLists.length === 0 ? (
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
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Level</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
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
                      value={list.level || ''}
                      onChange={(e) => setListLevel(list.id, e.target.value as ObjectiveLevel | '')}
                      className="border border-gray-300 rounded px-1.5 py-0.5 text-xs bg-white"
                    >
                      <option value="">—</option>
                      {LEVELS.map(lv => <option key={lv} value={lv}>{LEVEL_LABEL[lv]}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    <select
                      value={list.periodId || ''}
                      onChange={(e) => setListPeriod(list.id, e.target.value)}
                      className="border border-gray-300 rounded px-1.5 py-0.5 text-xs bg-white max-w-[160px]"
                    >
                      <option value="">— None —</option>
                      {renderGroupedPeriodOptions(periods)}
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
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => { setPlanFocusListId(list.id); onViewChange('planbuilder'); }}
                        className="p-1 text-gray-400 hover:text-purple-600 rounded"
                        title="Open in Plan Builder"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => { setEditListId(list.id); setEditName(list.name); setEditError(null); }}
                        className="p-1 text-gray-400 hover:text-blue-600 rounded"
                        title="Edit plan"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleClone(list)}
                        disabled={cloningListId === list.id}
                        className="p-1 text-gray-400 hover:text-blue-600 rounded disabled:opacity-50"
                        title="Clone plan"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => { if (window.confirm(`Delete plan "${list.name}"? This removes the list and its items.`)) deleteList(list.id); }}
                        className="p-1 text-gray-400 hover:text-red-600 rounded"
                        title="Delete plan"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

        {viewMode === 'grouped' && (() => {
          const pool = lists.filter(l => l.ownerId && l.periodId);
          const ownerPool = pool;
          const levelPool = pool.filter(l => !groupedOwnerId || l.ownerId === groupedOwnerId);
          const periodPool = levelPool.filter(l => {
            if (!groupedLevel) return true;
            if (groupedLevel === '__none__') return !l.level;
            return l.level === groupedLevel;
          });
          const finalPool = periodPool.filter(l => !groupedPeriodId || l.periodId === groupedPeriodId);

          const ownerCounts = new Map<string, number>();
          ownerPool.forEach(l => { if (l.ownerId) ownerCounts.set(l.ownerId, (ownerCounts.get(l.ownerId) || 0) + 1); });
          const ownerList = Array.from(ownerCounts.keys())
            .map(id => ({ id, name: orgUsers.find(u => u.id === id)?.name || orgUsers.find(u => u.id === id)?.email || id, count: ownerCounts.get(id) || 0 }))
            .sort((a, b) => a.name.localeCompare(b.name));

          const levelCounts = new Map<string, number>();
          levelPool.forEach(l => { const k = l.level || '__none__'; levelCounts.set(k, (levelCounts.get(k) || 0) + 1); });
          const levelKeys: (ObjectiveLevel | '__none__')[] = ['company', 'team', 'individual', '__none__'];
          const levelList = levelKeys
            .filter(k => (levelCounts.get(k) || 0) > 0)
            .map(k => ({ key: k, label: k === '__none__' ? '— No level —' : LEVEL_LABEL[k as ObjectiveLevel], count: levelCounts.get(k) || 0 }));

          const periodCounts = new Map<string, number>();
          periodPool.forEach(l => { if (l.periodId) periodCounts.set(l.periodId, (periodCounts.get(l.periodId) || 0) + 1); });
          const periodList = Array.from(periodCounts.keys())
            .map(id => ({ id, p: periods.find(pp => pp.id === id), count: periodCounts.get(id) || 0 }))
            .filter(x => !!x.p)
            .sort((a, b) => (a.p!.startDate || '').localeCompare(b.p!.startDate || ''));

          const colClass = (sel: boolean) => `w-full text-left px-3 py-2 text-sm border-b border-gray-100 flex items-center justify-between ${sel ? 'bg-blue-50 text-blue-800 font-medium' : 'text-gray-700 hover:bg-gray-50'}`;

          const splitter = (which: 1 | 2 | 3) => (
            <div
              onMouseDown={() => {
                groupedDragRef.current = which;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
              }}
              className="w-1 cursor-col-resize bg-gray-200 hover:bg-blue-400 active:bg-blue-500 flex-shrink-0"
              title="Drag to resize"
            />
          );
          const col4Width = Math.max(10, 100 - groupedCol1Width - groupedCol2Width - groupedCol3Width);
          return (
            <div ref={groupedSplitRef} className="flex" style={{ minHeight: 360 }}>
              <div className="overflow-y-auto" style={{ width: `${groupedCol1Width}%` }}>
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-500 uppercase tracking-wider flex items-center justify-between">
                  <span>Owner ({ownerList.length})</span>
                  {groupedOwnerId && (
                    <button onClick={() => setGroupedOwnerId('')} className="text-blue-600 hover:underline normal-case font-normal">Clear</button>
                  )}
                </div>
                {ownerList.length === 0 ? (
                  <div className="p-4 text-xs text-gray-400 italic">No owners.</div>
                ) : ownerList.map(o => (
                  <button key={o.id} onClick={() => setGroupedOwnerId(groupedOwnerId === o.id ? '' : o.id)} className={colClass(groupedOwnerId === o.id)}>
                    <span className="truncate">{o.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{o.count}</span>
                  </button>
                ))}
              </div>
              {splitter(1)}
              <div className="overflow-y-auto" style={{ width: `${groupedCol2Width}%` }}>
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-500 uppercase tracking-wider flex items-center justify-between">
                  <span>Level ({levelList.length})</span>
                  {groupedLevel && (
                    <button onClick={() => setGroupedLevel('')} className="text-blue-600 hover:underline normal-case font-normal">Clear</button>
                  )}
                </div>
                {levelList.length === 0 ? (
                  <div className="p-4 text-xs text-gray-400 italic">No levels.</div>
                ) : levelList.map(({ key, label, count }) => (
                  <button
                    key={key}
                    onClick={() => setGroupedLevel(groupedLevel === key ? '' : key)}
                    className={colClass(groupedLevel === key)}
                  >
                    <span className="truncate">{label}</span>
                    <span className="text-xs text-gray-400 ml-2">{count}</span>
                  </button>
                ))}
              </div>
              {splitter(2)}
              <div className="overflow-y-auto" style={{ width: `${groupedCol3Width}%` }}>
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-500 uppercase tracking-wider flex items-center justify-between">
                  <span>Period ({periodList.length})</span>
                  {groupedPeriodId && (
                    <button onClick={() => setGroupedPeriodId('')} className="text-blue-600 hover:underline normal-case font-normal">Clear</button>
                  )}
                </div>
                {periodList.length === 0 ? (
                  <div className="p-4 text-xs text-gray-400 italic">No periods.</div>
                ) : periodList.map(({ id, p, count }) => (
                  <button key={id} onClick={() => setGroupedPeriodId(groupedPeriodId === id ? '' : id)} className={colClass(groupedPeriodId === id)}>
                    <span className="truncate">{p!.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{count}</span>
                  </button>
                ))}
              </div>
              {splitter(3)}
              <div className="overflow-y-auto" style={{ width: `${col4Width}%` }}>
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                  Plans ({finalPool.length})
                </div>
                {finalPool.length === 0 ? (
                  <div className="p-4 text-xs text-gray-400 italic">No plans match.</div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 uppercase">Name</th>
                        <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 uppercase">Items</th>
                        <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 uppercase">Sharing</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {finalPool.sort((a, b) => a.name.localeCompare(b.name)).map(list => (
                        <tr key={list.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-sm">
                            <button
                              onClick={() => openPlan(list)}
                              className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-left flex items-center gap-2"
                            >
                              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: list.color || '#6b7280' }} />
                              {list.name}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-600">{list.items.length}</td>
                          <td className="px-3 py-2 text-sm">
                            <button
                              onClick={() => setListShared(list.id, !list.shared)}
                              className={`px-2 py-0.5 text-xs rounded border ${list.shared ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100' : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'}`}
                              title={list.shared ? 'Click to make private' : 'Click to share with org'}
                            >
                              {list.shared ? 'Shared' : 'Private'}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                onClick={() => { setPlanFocusListId(list.id); onViewChange('planbuilder'); }}
                                className="p-1 text-gray-400 hover:text-purple-600 rounded"
                                title="Open in Plan Builder"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => { setEditListId(list.id); setEditName(list.name); setEditError(null); }}
                                className="p-1 text-gray-400 hover:text-blue-600 rounded"
                                title="Edit plan"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleClone(list)}
                                disabled={cloningListId === list.id}
                                className="p-1 text-gray-400 hover:text-blue-600 rounded disabled:opacity-50"
                                title="Clone plan"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => { if (window.confirm(`Delete plan "${list.name}"? This removes the list and its items.`)) deleteList(list.id); }}
                                className="p-1 text-gray-400 hover:text-red-600 rounded"
                                title="Delete plan"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {viewMode === 'list' && filteredSharedPlans.length > 0 && (
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
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Level</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
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
                  <td className="px-4 py-3 text-sm text-gray-600">{list.level ? LEVEL_LABEL[list.level] : '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{periodName(list.periodId)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{list.items.length}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{list.createdByEmail || '—'}</td>
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
                  {renderGroupedPeriodOptions(periods)}
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
                  {renderGroupedPeriodOptions(periods)}
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

      {editListId && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Edit plan</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); }}
                />
              </div>
              <p className="text-xs text-gray-500">Owner, Period, Level, and Sharing can be changed inline on the Plans list.</p>
              {editError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{editError}</div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setEditListId(null)}
                disabled={editSaving}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={editSaving || !editName.trim()}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
