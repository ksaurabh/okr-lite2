import { useMemo, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import type { Period, PeriodType } from '../../types';

const PERIOD_TYPE_BADGES: Record<PeriodType, { label: string; color: string }> = {
  quarter: { label: 'Quarter', color: 'bg-purple-100 text-purple-700' },
  month: { label: 'Month', color: 'bg-blue-100 text-blue-700' },
  week: { label: 'Week', color: 'bg-green-100 text-green-700' },
};

function formatDate(dateString: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateString);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type SortKey = 'name' | 'type' | 'parent' | 'startDate' | 'endDate' | 'duration' | 'archived';
type SortDir = 'asc' | 'desc';

function durationDays(p: Period): number {
  return Math.round((new Date(p.endDate).getTime() - new Date(p.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

export function PeriodsPage() {
  const { organization, user, isSuperAdmin, isOrgAdmin } = useAuth();
  const orgId = organization?.id || '';
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;

  const periods = useOKRStore((state: OKRStore) => state.periods);
  const updatePeriod = useOKRStore((state: OKRStore) => state.updatePeriod);
  const addPeriod = useOKRStore((state: OKRStore) => state.addPeriod);

  const [createMonthsForQuarter, setCreateMonthsForQuarter] = useState<Period | null>(null);
  const [isCreatingMonths, setIsCreatingMonths] = useState(false);
  const [createWeeksForMonth, setCreateWeeksForMonth] = useState<Period | null>(null);
  const [isCreatingWeeks, setIsCreatingWeeks] = useState(false);
  const [editing, setEditing] = useState<{ id: string; field: 'name' | 'startDate' | 'endDate' } | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEdit = (period: Period, field: 'name' | 'startDate' | 'endDate') => {
    setEditing({ id: period.id, field });
    setEditValue(field === 'name' ? period.name : period[field]);
  };

  const commitEdit = async () => {
    if (!editing) return;
    const trimmed = editValue.trim();
    const period = periods.find(p => p.id === editing.id);
    if (!period) { setEditing(null); return; }
    if (editing.field === 'name') {
      if (trimmed && trimmed !== period.name) {
        await updatePeriod(editing.id, { name: trimmed });
      }
    } else {
      if (trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed) && trimmed !== period[editing.field]) {
        await updatePeriod(editing.id, { [editing.field]: trimmed });
      }
    }
    setEditing(null);
  };

  const cancelEdit = () => setEditing(null);

  const monthCandidatesForQuarter = useMemo(() => {
    if (!createMonthsForQuarter) return [];
    const q = createMonthsForQuarter;
    const start = new Date(q.startDate + 'T00:00:00');
    const end = new Date(q.endDate + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const candidates: { name: string; startDate: string; endDate: string; exists: boolean }[] = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      if (cursor >= start && cursor <= end && cursor >= today) {
        const year = cursor.getFullYear();
        const month = cursor.getMonth();
        const monthStart = new Date(year, month, 1);
        const monthEnd = new Date(year, month + 1, 0);
        const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const endStr = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`;
        const name = `${monthStart.toLocaleString('en-US', { month: 'short' })} ${year}`;
        const exists = periods.some(p =>
          p.parentId === q.id && p.type === 'month' && p.startDate === startStr
        );
        candidates.push({ name, startDate: startStr, endDate: endStr, exists });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return candidates;
  }, [createMonthsForQuarter, periods]);

  const weekCandidatesForMonth = useMemo(() => {
    if (!createWeeksForMonth) return [];
    const m = createWeeksForMonth;
    const start = new Date(m.startDate + 'T00:00:00');
    const end = new Date(m.endDate + 'T00:00:00');
    const candidates: { name: string; startDate: string; endDate: string; exists: boolean }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cursor = new Date(start);
    const dow = cursor.getDay();
    const offsetToMonday = dow === 0 ? 1 : (dow === 1 ? 0 : 8 - dow);
    cursor.setDate(cursor.getDate() + offsetToMonday);
    while (cursor <= end) {
      if (cursor < today) {
        cursor.setDate(cursor.getDate() + 7);
        continue;
      }
      const monday = new Date(cursor);
      const sunday = new Date(cursor);
      sunday.setDate(sunday.getDate() + 6);
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const startStr = fmt(monday);
      const endStr = fmt(sunday);
      const name = `w-${startStr}`;
      const exists = periods.some(p =>
        p.parentId === m.id && p.type === 'week' && p.startDate === startStr
      );
      candidates.push({ name, startDate: startStr, endDate: endStr, exists });
      cursor.setDate(cursor.getDate() + 7);
    }
    return candidates;
  }, [createWeeksForMonth, periods]);

  const handleCreateWeeks = async () => {
    if (!createWeeksForMonth) return;
    setIsCreatingWeeks(true);
    try {
      const toCreate = weekCandidatesForMonth.filter(c => !c.exists);
      for (const w of toCreate) {
        await addPeriod(
          {
            name: w.name,
            type: 'week',
            parentId: createWeeksForMonth.id,
            startDate: w.startDate,
            endDate: w.endDate,
            isActive: false,
          },
          { orgId, userEmail }
        );
      }
      setCreateWeeksForMonth(null);
    } finally {
      setIsCreatingWeeks(false);
    }
  };

  const handleCreateMonths = async () => {
    if (!createMonthsForQuarter) return;
    setIsCreatingMonths(true);
    try {
      const toCreate = monthCandidatesForQuarter.filter(c => !c.exists);
      for (const m of toCreate) {
        await addPeriod(
          {
            name: m.name,
            type: 'month',
            parentId: createMonthsForQuarter.id,
            startDate: m.startDate,
            endDate: m.endDate,
            isActive: false,
          },
          { orgId, userEmail }
        );
      }
      setCreateMonthsForQuarter(null);
    } finally {
      setIsCreatingMonths(false);
    }
  };

  const [sortKey, setSortKey] = useState<SortKey>('startDate');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filterTypes, setFilterTypes] = useState<PeriodType[]>([]);
  const [filterArchived, setFilterArchived] = useState<'all' | 'active' | 'archived'>('active');

  const toggleTypeFilter = (type: PeriodType) => {
    setFilterTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  };

  const getParentName = (parentId?: string): string => {
    if (!parentId) return '-';
    const parent = periods.find((p: Period) => p.id === parentId);
    return parent?.name || '-';
  };

  const orgPeriods = useMemo(() => {
    const filtered = periods.filter((p: Period) => {
      if (!((!p.orgId || p.orgId === orgId) && (isAdmin || p.shared !== false || p.createdBy === userEmail))) return false;
      if (filterTypes.length > 0 && !filterTypes.includes(p.type)) return false;
      if (filterArchived === 'active' && p.archived) return false;
      if (filterArchived === 'archived' && !p.archived) return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'type': cmp = a.type.localeCompare(b.type); break;
        case 'parent': cmp = getParentName(a.parentId).localeCompare(getParentName(b.parentId)); break;
        case 'startDate': cmp = a.startDate.localeCompare(b.startDate); break;
        case 'endDate': cmp = a.endDate.localeCompare(b.endDate); break;
        case 'duration': cmp = durationDays(a) - durationDays(b); break;
        case 'archived': cmp = Number(!!a.archived) - Number(!!b.archived); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods, orgId, userEmail, isAdmin, sortKey, sortDir, filterTypes, filterArchived]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortHeader = ({ label, columnKey }: { label: string; columnKey: SortKey }) => {
    const active = sortKey === columnKey;
    return (
      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
        <button
          onClick={() => handleSort(columnKey)}
          className="inline-flex items-center gap-1 hover:text-gray-700"
        >
          {label}
          <span className={`text-[10px] ${active ? 'text-gray-700' : 'text-gray-300'}`}>
            {active ? (sortDir === 'asc' ? '▲' : '▼') : '▲'}
          </span>
        </button>
      </th>
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">All Periods</h2>
          <p className="text-sm text-gray-500 mt-1">
            {orgPeriods.length} {orgPeriods.length === 1 ? 'period' : 'periods'} total
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-500">Type</label>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(PERIOD_TYPE_BADGES) as PeriodType[]).map(type => (
                  <button
                    key={type}
                    onClick={() => toggleTypeFilter(type)}
                    className={`px-2 py-1 rounded-full text-xs transition-colors ${
                      filterTypes.includes(type)
                        ? 'bg-gray-800 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {PERIOD_TYPE_BADGES[type].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-500">Archived</label>
              <select
                value={filterArchived}
                onChange={(e) => setFilterArchived(e.target.value as 'all' | 'active' | 'archived')}
                className="px-2 py-1 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="active">Active only</option>
                <option value="archived">Archived only</option>
                <option value="all">All</option>
              </select>
            </div>

            {(filterTypes.length > 0 || filterArchived !== 'active') && (
              <button
                onClick={() => { setFilterTypes([]); setFilterArchived('active'); }}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {orgPeriods.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <svg className="mx-auto h-10 w-10 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-sm">No periods yet. Add a quarter from the sidebar to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <SortHeader label="Name" columnKey="name" />
                  <SortHeader label="Type" columnKey="type" />
                  <SortHeader label="Parent" columnKey="parent" />
                  <SortHeader label="Start Date" columnKey="startDate" />
                  <SortHeader label="End Date" columnKey="endDate" />
                  <SortHeader label="Duration" columnKey="duration" />
                  <SortHeader label="Archived" columnKey="archived" />
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {orgPeriods.map((period: Period) => {
                  const badge = PERIOD_TYPE_BADGES[period.type];

                  return (
                    <tr key={period.id} className={`hover:bg-gray-50 ${period.archived ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {editing?.id === period.id && editing.field === 'name' ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                            className="w-full px-1 py-0.5 text-sm border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <button
                            onClick={() => startEdit(period, 'name')}
                            className="text-left w-full hover:bg-gray-100 px-1 py-0.5 rounded"
                            title="Click to edit"
                          >
                            {period.name}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {getParentName(period.parentId)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {editing?.id === period.id && editing.field === 'startDate' ? (
                          <input
                            type="date"
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                            className="px-1 py-0.5 text-sm border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <button
                            onClick={() => startEdit(period, 'startDate')}
                            className="text-left hover:bg-gray-100 px-1 py-0.5 rounded"
                            title="Click to edit"
                          >
                            {formatDate(period.startDate)}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {editing?.id === period.id && editing.field === 'endDate' ? (
                          <input
                            type="date"
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                            className="px-1 py-0.5 text-sm border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <button
                            onClick={() => startEdit(period, 'endDate')}
                            className="text-left hover:bg-gray-100 px-1 py-0.5 rounded"
                            title="Click to edit"
                          >
                            {formatDate(period.endDate)}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {durationDays(period)} days
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updatePeriod(period.id, { archived: !period.archived })}
                            className={`px-2 py-1 text-xs rounded ${
                              period.archived
                                ? 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                                : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                            }`}
                            title={period.archived ? 'Unarchive this period' : 'Archive this period'}
                          >
                            {period.archived ? 'Unarchive' : 'Archive'}
                          </button>
                          {period.type === 'quarter' && !period.archived && (
                            <button
                              onClick={() => setCreateMonthsForQuarter(period)}
                              className="px-2 py-1 text-xs rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
                              title="Create monthly periods inside this quarter"
                            >
                              Create Months
                            </button>
                          )}
                          {period.type === 'month' && !period.archived && (
                            <button
                              onClick={() => setCreateWeeksForMonth(period)}
                              className="px-2 py-1 text-xs rounded bg-green-100 text-green-700 hover:bg-green-200"
                              title="Create weekly periods inside this month"
                            >
                              Create Weeks
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {createWeeksForMonth && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                Create weeks in {createWeeksForMonth.name}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                The following weekly periods will be created (one per Monday that falls within the month):
              </p>
            </div>
            <div className="p-4 max-h-80 overflow-y-auto">
              {weekCandidatesForMonth.length === 0 ? (
                <p className="text-sm text-gray-500">No Mondays fall within this month's date range.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {weekCandidatesForMonth.map(c => (
                    <li key={c.startDate} className="py-2 flex items-center justify-between text-sm">
                      <div>
                        <span className="font-medium text-gray-900">{c.name}</span>
                        <span className="text-gray-500 ml-2">{formatDate(c.startDate)} – {formatDate(c.endDate)}</span>
                      </div>
                      {c.exists && (
                        <span className="text-xs text-gray-400 italic">already exists</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                onClick={() => setCreateWeeksForMonth(null)}
                disabled={isCreatingWeeks}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateWeeks}
                disabled={isCreatingWeeks || weekCandidatesForMonth.every(c => c.exists)}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {isCreatingWeeks
                  ? 'Creating…'
                  : `Create ${weekCandidatesForMonth.filter(c => !c.exists).length} period${weekCandidatesForMonth.filter(c => !c.exists).length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {createMonthsForQuarter && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                Create months in {createMonthsForQuarter.name}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                The following monthly periods will be created (one per month whose 1st day falls within the quarter):
              </p>
            </div>
            <div className="p-4 max-h-80 overflow-y-auto">
              {monthCandidatesForQuarter.length === 0 ? (
                <p className="text-sm text-gray-500">No months fall within this quarter's date range.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {monthCandidatesForQuarter.map(c => (
                    <li key={c.startDate} className="py-2 flex items-center justify-between text-sm">
                      <div>
                        <span className="font-medium text-gray-900">{c.name}</span>
                        <span className="text-gray-500 ml-2">{formatDate(c.startDate)} – {formatDate(c.endDate)}</span>
                      </div>
                      {c.exists && (
                        <span className="text-xs text-gray-400 italic">already exists</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                onClick={() => setCreateMonthsForQuarter(null)}
                disabled={isCreatingMonths}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateMonths}
                disabled={isCreatingMonths || monthCandidatesForQuarter.every(c => c.exists)}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {isCreatingMonths
                  ? 'Creating…'
                  : `Create ${monthCandidatesForQuarter.filter(c => !c.exists).length} period${monthCandidatesForQuarter.filter(c => !c.exists).length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
