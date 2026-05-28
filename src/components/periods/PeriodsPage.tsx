import { useMemo, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import type { Period, PeriodType } from '../../types';

const PERIOD_TYPE_BADGES: Record<PeriodType, { label: string; color: string }> = {
  quarter: { label: 'Quarter', color: 'bg-purple-100 text-purple-700' },
  month: { label: 'Month', color: 'bg-blue-100 text-blue-700' },
  week: { label: 'Week', color: 'bg-green-100 text-green-700' },
  oneoff: { label: 'One-off', color: 'bg-amber-100 text-amber-700' },
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
  const deletePeriod = useOKRStore((state: OKRStore) => state.deletePeriod);

  const [createMonthsForQuarter, setCreateMonthsForQuarter] = useState<Period | null>(null);
  const [isCreatingMonths, setIsCreatingMonths] = useState(false);
  const [createWeeksForMonth, setCreateWeeksForMonth] = useState<Period | null>(null);
  const [isCreatingWeeks, setIsCreatingWeeks] = useState(false);
  const [editTarget, setEditTarget] = useState<Period | null>(null);
  const [autoUpdatePlan, setAutoUpdatePlan] = useState<{ creates: Array<{ name: string; type: PeriodType; startDate: string; endDate: string }>; archives: Period[] } | null>(null);
  const [autoUpdateRunning, setAutoUpdateRunning] = useState(false);
  const [fiscalEnabled, setFiscalEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('okr-fiscal-quarters-enabled') === 'true'; } catch { return false; }
  });
  const [fiscalStartMonth, setFiscalStartMonth] = useState<number>(() => {
    try { const v = localStorage.getItem('okr-fiscal-start-month'); const n = v ? parseInt(v, 10) : NaN; return Number.isFinite(n) && n >= 1 && n <= 12 ? n : 1; } catch { return 1; }
  });
  const setFiscalEnabledPersist = (v: boolean) => { setFiscalEnabled(v); try { localStorage.setItem('okr-fiscal-quarters-enabled', String(v)); } catch { /* ignore */ } };
  const setFiscalStartMonthPersist = (m: number) => { setFiscalStartMonth(m); try { localStorage.setItem('okr-fiscal-start-month', String(m)); } catch { /* ignore */ } };
  const [editForm, setEditForm] = useState<{ name: string; type: PeriodType; parentId: string; startDate: string; endDate: string }>({ name: '', type: 'quarter', parentId: '', startDate: '', endDate: '' });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const openEdit = (period: Period) => {
    setEditTarget(period);
    setEditForm({
      name: period.name,
      type: period.type,
      parentId: period.parentId || '',
      startDate: period.startDate,
      endDate: period.endDate,
    });
    setEditError(null);
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    const name = editForm.name.trim();
    if (!name) { setEditError('Name is required.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editForm.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(editForm.endDate)) {
      setEditError('Start and end dates must be valid.');
      return;
    }
    if (editForm.startDate > editForm.endDate) {
      setEditError('Start date must be before end date.');
      return;
    }
    setEditSaving(true);
    try {
      const updates: Partial<Period> = {};
      if (name !== editTarget.name) updates.name = name;
      if (editForm.type !== editTarget.type) updates.type = editForm.type;
      const nextParent = editForm.parentId || undefined;
      if (nextParent !== editTarget.parentId) updates.parentId = nextParent;
      if (editForm.startDate !== editTarget.startDate) updates.startDate = editForm.startDate;
      if (editForm.endDate !== editTarget.endDate) updates.endDate = editForm.endDate;
      if (Object.keys(updates).length > 0) await updatePeriod(editTarget.id, updates);
      setEditTarget(null);
    } finally {
      setEditSaving(false);
    }
  };

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
      // Always include the month whose 1st is the quarter's start date, even if past;
      // otherwise enforce the past-date cutoff.
      const matchesQuarterStart = cursor.getTime() === start.getTime();
      if (cursor >= start && cursor <= end && (cursor >= today || matchesQuarterStart)) {
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

  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const computeQuarterRange = (year: number, qIdx: number) => {
    const startMonth = qIdx * 3;
    const start = new Date(year, startMonth, 1);
    const end = new Date(year, startMonth + 3, 0);
    return { name: `Q${qIdx + 1} ${year}`, startDate: ymd(start), endDate: ymd(end) };
  };
  // Fiscal quarter: fiscalStartMonth is 1..12. Q1 starts at that month.
  // Fiscal year label = calendar year of the FY end date (year that contains the last day of FY).
  // Returns { name: 'FYxxQn', startDate, endDate, fyYear, qIdx (0..3) }
  const computeFiscalQuarterForDate = (d: Date) => {
    const startMonthIdx = fiscalStartMonth - 1; // 0..11
    const m = d.getMonth();
    const y = d.getFullYear();
    // offset months from FY start (0..11)
    const monthsFromStart = ((m - startMonthIdx) + 12) % 12;
    const fyStartYear = m >= startMonthIdx ? y : y - 1;
    const qIdx = Math.floor(monthsFromStart / 3); // 0..3
    return { fyStartYear, qIdx };
  };
  const fiscalQuarterRange = (fyStartYear: number, qIdx: number) => {
    const startMonthIdx = fiscalStartMonth - 1;
    const absMonth = startMonthIdx + qIdx * 3;
    const startYear = fyStartYear + Math.floor(absMonth / 12);
    const startMonth = absMonth % 12;
    const endAbs = absMonth + 3;
    const endYear = fyStartYear + Math.floor(endAbs / 12);
    const endMonth = endAbs % 12;
    const start = new Date(startYear, startMonth, 1);
    const end = new Date(endYear, endMonth, 0);
    // FY label = year containing the last day of the fiscal year = fyStartYear + 1 when fiscalStartMonth>1, else fyStartYear
    const fyEndYear = fiscalStartMonth === 1 ? fyStartYear : fyStartYear + 1;
    const yy = String(fyEndYear).slice(-2);
    return { name: `FY${yy}Q${qIdx + 1}`, startDate: ymd(start), endDate: ymd(end) };
  };
  const advanceFiscalQuarter = (fyStartYear: number, qIdx: number, delta: number) => {
    const total = fyStartYear * 4 + qIdx + delta;
    return { fyStartYear: Math.floor(total / 4), qIdx: ((total % 4) + 4) % 4 };
  };
  const computeMonthRange = (year: number, monthIdx: number) => {
    const start = new Date(year, monthIdx, 1);
    const end = new Date(year, monthIdx + 1, 0);
    return { name: `${monthNames[monthIdx]} ${year}`, startDate: ymd(start), endDate: ymd(end) };
  };
  const computeWeekRange = (anchor: Date) => {
    const d = new Date(anchor);
    const day = d.getDay(); // 0=Sun..6=Sat
    const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
    d.setDate(d.getDate() + diff);
    const start = new Date(d);
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    const startStr = ymd(start);
    return { name: `w-${startStr}`, startDate: startStr, endDate: ymd(end) };
  };

  const computeAutoUpdatePlan = () => {
    const now = new Date();
    const year = now.getFullYear();
    const qIdx = Math.floor(now.getMonth() / 3);
    const monthIdx = now.getMonth();
    const quarterTargets = fiscalEnabled ? (() => {
      const cur = computeFiscalQuarterForDate(now);
      const prev = advanceFiscalQuarter(cur.fyStartYear, cur.qIdx, -1);
      const next = advanceFiscalQuarter(cur.fyStartYear, cur.qIdx, 1);
      return [
        fiscalQuarterRange(prev.fyStartYear, prev.qIdx),
        fiscalQuarterRange(cur.fyStartYear, cur.qIdx),
        fiscalQuarterRange(next.fyStartYear, next.qIdx),
      ];
    })() : [
      computeQuarterRange(qIdx === 0 ? year - 1 : year, qIdx === 0 ? 3 : qIdx - 1),
      computeQuarterRange(year, qIdx),
      computeQuarterRange(qIdx === 3 ? year + 1 : year, qIdx === 3 ? 0 : qIdx + 1),
    ];
    const targets: Record<'quarter' | 'month' | 'week', { name: string; startDate: string; endDate: string }[]> = {
      quarter: quarterTargets,
      month: [
        computeMonthRange(monthIdx === 0 ? year - 1 : year, monthIdx === 0 ? 11 : monthIdx - 1),
        computeMonthRange(year, monthIdx),
        computeMonthRange(monthIdx === 11 ? year + 1 : year, monthIdx === 11 ? 0 : monthIdx + 1),
      ],
      week: [
        (() => { const d = new Date(now); d.setDate(d.getDate() - 7); return computeWeekRange(d); })(),
        computeWeekRange(now),
        (() => { const d = new Date(now); d.setDate(d.getDate() + 7); return computeWeekRange(d); })(),
      ],
    };
    const creates: Array<{ name: string; type: PeriodType; startDate: string; endDate: string }> = [];
    const keepKeys = new Set<string>(); // type|startDate
    (['quarter', 'month', 'week'] as const).forEach(t => {
      targets[t].forEach(tgt => {
        keepKeys.add(`${t}|${tgt.startDate}`);
        const exists = periods.find(p => p.type === t && (!p.orgId || p.orgId === orgId) && p.startDate === tgt.startDate);
        if (!exists) creates.push({ name: tgt.name, type: t, startDate: tgt.startDate, endDate: tgt.endDate });
      });
    });
    const archives: Period[] = periods.filter(p =>
      (!p.orgId || p.orgId === orgId)
      && (p.type === 'quarter' || p.type === 'month' || p.type === 'week')
      && !p.archived
      && !keepKeys.has(`${p.type}|${p.startDate}`)
    );
    return { creates, archives };
  };

  const runAutoUpdate = async () => {
    if (!autoUpdatePlan) return;
    setAutoUpdateRunning(true);
    try {
      for (const c of autoUpdatePlan.creates) {
        await addPeriod({ name: c.name, type: c.type, startDate: c.startDate, endDate: c.endDate, isActive: true }, { orgId, userEmail, shared: true });
      }
      for (const p of autoUpdatePlan.archives) {
        await updatePeriod(p.id, { archived: true });
      }
      setAutoUpdatePlan(null);
    } finally {
      setAutoUpdateRunning(false);
    }
  };

  const toggleTypeFilter = (type: PeriodType) => {
    setFilterTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  };

  const getParentName = (parentId?: string): string => {
    if (!parentId) return '-';
    const parent = periods.find((p: Period) => p.id === parentId);
    return parent?.name || '-';
  };

  const latestWeekId = useMemo(() => {
    const weeks = periods.filter(p => p.type === 'week' && (!p.orgId || p.orgId === orgId) && !p.archived);
    if (weeks.length === 0) return null;
    return weeks.reduce((a, b) => (a.startDate || '') >= (b.startDate || '') ? a : b).id;
  }, [periods, orgId]);

  const latestQuarterId = useMemo(() => {
    const qs = periods.filter(p => p.type === 'quarter' && (!p.orgId || p.orgId === orgId) && !p.archived);
    if (qs.length === 0) return null;
    return qs.reduce((a, b) => (a.startDate || '') >= (b.startDate || '') ? a : b).id;
  }, [periods, orgId]);

  const latestMonthId = useMemo(() => {
    const ms = periods.filter(p => p.type === 'month' && (!p.orgId || p.orgId === orgId) && !p.archived);
    if (ms.length === 0) return null;
    return ms.reduce((a, b) => (a.startDate || '') >= (b.startDate || '') ? a : b).id;
  }, [periods, orgId]);

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
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">All Periods</h2>
              <p className="text-sm text-gray-500 mt-1">
                {orgPeriods.length} {orgPeriods.length === 1 ? 'period' : 'periods'} total
              </p>
            </div>
            {isAdmin && (
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fiscalEnabled}
                    onChange={(e) => setFiscalEnabledPersist(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Enable fiscal quarters
                </label>
                {fiscalEnabled && (
                  <div className="flex items-center gap-1 text-xs text-gray-600">
                    <span>FY starts</span>
                    <select
                      value={fiscalStartMonth}
                      onChange={(e) => setFiscalStartMonthPersist(parseInt(e.target.value, 10))}
                      className="border border-gray-300 rounded px-1 py-0.5 text-xs bg-white"
                    >
                      {monthNames.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                    </select>
                  </div>
                )}
                <button
                  onClick={() => setAutoUpdatePlan(computeAutoUpdatePlan())}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  title="Create missing periods and archive old ones"
                >
                  Auto Update Periods
                </button>
              </div>
            )}
          </div>

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
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{period.name}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{getParentName(period.parentId) || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{formatDate(period.startDate)}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{formatDate(period.endDate)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {durationDays(period)} days
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEdit(period)}
                            className="p-1 text-gray-400 hover:text-blue-600 rounded"
                            title="Edit period"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
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
                          {period.type === 'quarter' && !period.archived && period.id === latestQuarterId && (
                            <button
                              onClick={async () => {
                                const start = new Date(`${period.endDate}T00:00:00`);
                                start.setDate(start.getDate() + 1);
                                const year = start.getFullYear();
                                const month = start.getMonth();
                                const startStr = ymd(new Date(year, month, 1));
                                const endStr = ymd(new Date(year, month + 3, 0));
                                const exists = periods.find(p => p.type === 'quarter' && p.startDate === startStr);
                                if (exists) {
                                  alert(`Next quarter already exists: "${exists.name}".`);
                                  return;
                                }
                                const q = Math.floor(month / 3) + 1;
                                await addPeriod({
                                  name: `Q${q} ${year}`,
                                  type: 'quarter',
                                  startDate: startStr,
                                  endDate: endStr,
                                  isActive: true,
                                  parentId: period.parentId,
                                }, { orgId, userEmail, shared: true });
                              }}
                              className="px-2 py-1 text-xs rounded bg-purple-100 text-purple-700 hover:bg-purple-200"
                              title="Create the quarter that follows this one"
                            >
                              Create Next Quarter
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
                          {period.type === 'month' && !period.archived && period.id === latestMonthId && (
                            <button
                              onClick={async () => {
                                const start = new Date(`${period.endDate}T00:00:00`);
                                start.setDate(start.getDate() + 1);
                                const year = start.getFullYear();
                                const month = start.getMonth();
                                const startStr = ymd(new Date(year, month, 1));
                                const endStr = ymd(new Date(year, month + 1, 0));
                                const exists = periods.find(p => p.type === 'month' && p.startDate === startStr);
                                if (exists) {
                                  alert(`Next month already exists: "${exists.name}".`);
                                  return;
                                }
                                await addPeriod({
                                  name: `${monthNames[month]} ${year}`,
                                  type: 'month',
                                  startDate: startStr,
                                  endDate: endStr,
                                  isActive: true,
                                  parentId: period.parentId,
                                }, { orgId, userEmail, shared: true });
                              }}
                              className="px-2 py-1 text-xs rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
                              title="Create the month that follows this one"
                            >
                              Create Next Month
                            </button>
                          )}
                          {period.type === 'week' && !period.archived && period.id === latestWeekId && (
                            <button
                              onClick={async () => {
                                const start = new Date(`${period.endDate}T00:00:00`);
                                start.setDate(start.getDate() + 1);
                                const end = new Date(start);
                                end.setDate(end.getDate() + 6);
                                const startStr = ymd(start);
                                const endStr = ymd(end);
                                const exists = periods.find(p => p.type === 'week' && p.startDate === startStr);
                                if (exists) {
                                  alert(`Next week already exists: "${exists.name}".`);
                                  return;
                                }
                                await addPeriod({
                                  name: `w-${startStr}`,
                                  type: 'week',
                                  startDate: startStr,
                                  endDate: endStr,
                                  isActive: true,
                                  parentId: period.parentId,
                                }, { orgId, userEmail, shared: true });
                              }}
                              className="px-2 py-1 text-xs rounded bg-green-100 text-green-700 hover:bg-green-200"
                              title="Create the week that follows this one"
                            >
                              Create Next Week
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (window.confirm(`Delete period "${period.name}"? This cannot be undone.`)) {
                                deletePeriod(period.id);
                              }
                            }}
                            className="p-1 text-gray-400 hover:text-red-600 rounded"
                            title="Delete period"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
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

      {autoUpdatePlan && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Auto Update Periods</h3>
            <p className="text-xs text-gray-500 mb-3">For each type, keep only previous / current / next; create missing ones; archive everything else.</p>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              <div>
                <div className="text-xs font-semibold text-green-700 uppercase tracking-wider mb-1">Will create ({autoUpdatePlan.creates.length})</div>
                {autoUpdatePlan.creates.length === 0 ? (
                  <div className="text-xs text-gray-400 italic">Nothing to create.</div>
                ) : (
                  <ul className="text-xs text-gray-700 space-y-0.5">
                    {autoUpdatePlan.creates.map((c, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${PERIOD_TYPE_BADGES[c.type].color}`}>{PERIOD_TYPE_BADGES[c.type].label}</span>
                        <span>{c.name}</span>
                        <span className="text-gray-400">({c.startDate} → {c.endDate})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1">Will archive ({autoUpdatePlan.archives.length})</div>
                {autoUpdatePlan.archives.length === 0 ? (
                  <div className="text-xs text-gray-400 italic">Nothing to archive.</div>
                ) : (
                  <ul className="text-xs text-gray-700 space-y-0.5">
                    {autoUpdatePlan.archives.map(p => (
                      <li key={p.id} className="flex items-center gap-2">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${PERIOD_TYPE_BADGES[p.type].color}`}>{PERIOD_TYPE_BADGES[p.type].label}</span>
                        <span>{p.name}</span>
                        <span className="text-gray-400">({p.startDate} → {p.endDate})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setAutoUpdatePlan(null)}
                disabled={autoUpdateRunning}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={runAutoUpdate}
                disabled={autoUpdateRunning || (autoUpdatePlan.creates.length === 0 && autoUpdatePlan.archives.length === 0)}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {autoUpdateRunning ? 'Updating…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Edit period</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                <input
                  type="text"
                  autoFocus
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                <select
                  value={editForm.type}
                  onChange={(e) => setEditForm({ ...editForm, type: e.target.value as PeriodType })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="quarter">Quarterly</option>
                  <option value="month">Monthly</option>
                  <option value="week">Weekly</option>
                  <option value="oneoff">One-off</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Parent</label>
                <select
                  value={editForm.parentId}
                  onChange={(e) => setEditForm({ ...editForm, parentId: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">— None (top-level) —</option>
                  {orgPeriods
                    .filter(p => p.id !== editTarget.id)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Start date</label>
                  <input
                    type="date"
                    value={editForm.startDate}
                    onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">End date</label>
                  <input
                    type="date"
                    value={editForm.endDate}
                    onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {editError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{editError}</div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setEditTarget(null)}
                disabled={editSaving}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={editSaving || !editForm.name.trim()}
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
