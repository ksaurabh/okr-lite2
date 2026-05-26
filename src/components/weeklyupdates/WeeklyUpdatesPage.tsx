import { useEffect, useMemo, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import type { Period, User } from '../../types';
import { renderGroupedPeriodOptions } from '../../utils/periodOptions';

const API_URL = import.meta.env.VITE_API_URL || '';

type DurationType = 'quarterly' | 'monthly' | 'weekly';

interface UpdateBullet {
  id: string;
  text: string;
  sp: number;
  why?: { id: string; title: string };
}

interface WeeklyUpdate {
  id: string;
  weekDate: string; // yyyy-mm-dd (Monday)
  reporterEmail: string;
  durationType: DurationType;
  periodId: string;
  bullets?: UpdateBullet[];
  createdAt: string;
}

const STORAGE_KEY = 'okr-weekly-updates';

function loadUpdates(): WeeklyUpdate[] {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? JSON.parse(v) : [];
  } catch { return []; }
}
function saveUpdates(updates: WeeklyUpdate[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updates)); } catch { /* ignore */ }
}

export function WeeklyUpdatesPage() {
  const { user, organization } = useAuth();
  const userEmail = user?.email || '';
  const periods = useOKRStore((s: OKRStore) => s.periods);
  const objectives = useOKRStore((s: OKRStore) => s.objectives);

  const [updates, setUpdates] = useState<WeeklyUpdate[]>(() => loadUpdates());
  const [showAdd, setShowAdd] = useState(false);
  const [newWeekPeriodId, setNewWeekPeriodId] = useState('');
  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [filterWeekDate, setFilterWeekDate] = useState<string>('');
  const [filterReporterEmail, setFilterReporterEmail] = useState<string>('');
  const [whyPicker, setWhyPicker] = useState<{ uid: string; bid: string } | null>(null);
  const [whySearch, setWhySearch] = useState('');
  const [whyMode, setWhyMode] = useState<'list' | 'tree'>('list');
  const [addChildFor, setAddChildFor] = useState<string | 'root' | null>(null);
  const [addChildTitle, setAddChildTitle] = useState('');
  const [whyCollapsed, setWhyCollapsed] = useState<Set<string>>(new Set());
  const toggleWhyCollapsed = (id: string) => setWhyCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const addObjective = useOKRStore((s: OKRStore) => s.addObjective);
  const activePeriodId = useOKRStore((s: OKRStore) => s.activePeriodId);
  const orgIdForCreate = organization?.id || '';
  const toggleCollapsed = (id: string) => setCollapsedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [editingBullet, setEditingBullet] = useState<{ uid: string; bid: string; field: 'text' | 'sp' } | null>(null);
  const [importTarget, setImportTarget] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState<string>('');
  const [importRows, setImportRows] = useState<Array<{ text: string; sp: number }> | null>(null);
  const [importMode, setImportMode] = useState<'replace' | 'append'>('append');
  const csvEscape = (s: string) => {
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const bulletsToCsv = (bs: UpdateBullet[]) => ['Work item,Why,Story points', ...bs.map(b => `${csvEscape(b.text)},${csvEscape(b.why?.title || '')},${b.sp}`)].join('\n');
  const parseCsv = (text: string): Array<{ text: string; sp: number; whyTitle?: string }> => {
    const rows: string[][] = [];
    let cur: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { cur.push(field); field = ''; }
        else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
        else if (c === '\r') { /* skip */ }
        else field += c;
      }
    }
    if (field !== '' || cur.length > 0) { cur.push(field); rows.push(cur); }
    const result: Array<{ text: string; sp: number; whyTitle?: string }> = [];
    for (const row of rows) {
      if (row.length === 0 || row.every(x => x.trim() === '')) continue;
      const c0 = (row[0] || '').trim();
      const c1 = (row[1] || '').trim();
      const c2 = (row[2] || '').trim();
      // header rows
      if (/^work\s*item$/i.test(c0) && /^why$/i.test(c1)) continue;
      if (/^text$/i.test(c0) && (/^sp$/i.test(c1) || /^story\s*points?$/i.test(c1))) continue;
      // 3-column: text, why, sp
      if (row.length >= 3) {
        const sp = Number(c2);
        result.push({ text: c0, sp: Number.isFinite(sp) ? sp : 0, whyTitle: c1 || undefined });
      } else {
        // 2-column legacy: text, sp
        const sp = Number(c1);
        result.push({ text: c0, sp: Number.isFinite(sp) ? sp : 0 });
      }
    }
    return result;
  };

  const downloadUpdateCsv = (u: WeeklyUpdate) => {
    const csv = bulletsToCsv(u.bullets || []);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weekly-update-w-${u.weekDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const openImport = (uid: string) => { setImportTarget(uid); setImportFileName(''); setImportRows(null); setImportMode('append'); };
  const handleImportFile = async (file: File | null | undefined) => {
    if (!file) return;
    const text = await file.text();
    setImportFileName(file.name);
    setImportRows(parseCsv(text));
  };
  const runImport = () => {
    if (!importTarget || !importRows || importRows.length === 0) { setImportTarget(null); return; }
    const newBullets: UpdateBullet[] = importRows.map(r => {
      const match = r.whyTitle ? objectives.find(o => o.title === r.whyTitle) : undefined;
      const why = r.whyTitle ? (match ? { id: match.id, title: match.title } : { id: '', title: r.whyTitle }) : undefined;
      return { id: crypto.randomUUID(), text: r.text, sp: r.sp, why };
    });
    updateBullets(importTarget, bs => importMode === 'replace' ? newBullets : [...bs, ...newBullets]);
    setImportTarget(null);
  };

  useEffect(() => {
    fetch(`${API_URL}/api/users`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { users: [] })
      .then(d => setOrgUsers(d.users || []))
      .catch(err => console.error('Failed to fetch users:', err));
  }, []);

  useEffect(() => { saveUpdates(updates); }, [updates]);

  const weekPeriods = useMemo(
    () => periods.filter(p => p.type === 'week' && !p.archived).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')),
    [periods]
  );

  const userName = (email: string) => orgUsers.find(u => u.email === email)?.name || email;

  const addUpdate = () => {
    if (!newWeekPeriodId || !userEmail) return;
    const wp = periods.find(p => p.id === newWeekPeriodId);
    if (!wp) return;
    const u: WeeklyUpdate = {
      id: crypto.randomUUID(),
      weekDate: wp.startDate,
      reporterEmail: userEmail,
      durationType: 'weekly',
      periodId: wp.id,
      createdAt: new Date().toISOString(),
    };
    setUpdates(prev => [u, ...prev]);
    setShowAdd(false);
    setNewWeekPeriodId('');
  };

  const updateField = (id: string, patch: Partial<WeeklyUpdate>) => {
    setUpdates(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u));
  };
  const removeUpdate = (id: string) => {
    if (window.confirm('Remove this weekly update?')) {
      setUpdates(prev => prev.filter(u => u.id !== id));
    }
  };

  const updateBullets = (uid: string, mapper: (bullets: UpdateBullet[]) => UpdateBullet[]) => {
    setUpdates(prev => prev.map(u => u.id === uid ? { ...u, bullets: mapper(u.bullets || []) } : u));
  };
  const removeBullet = (uid: string, bid: string) => updateBullets(uid, bs => bs.filter(b => b.id !== bid));
  const editBullet = (uid: string, bid: string, patch: Partial<UpdateBullet>) =>
    updateBullets(uid, bs => bs.map(b => b.id === bid ? { ...b, ...patch } : b));
  const reorderBullet = (uid: string, draggedId: string, targetId: string) => updateBullets(uid, bs => {
    if (draggedId === targetId) return bs;
    const draggedIdx = bs.findIndex(b => b.id === draggedId);
    const targetIdx = bs.findIndex(b => b.id === targetId);
    if (draggedIdx < 0 || targetIdx < 0) return bs;
    const copy = [...bs];
    const [moved] = copy.splice(draggedIdx, 1);
    copy.splice(targetIdx, 0, moved);
    return copy;
  });

  const filteredUpdates = useMemo(() => updates.filter(u => {
    if (filterWeekDate && u.weekDate !== filterWeekDate) return false;
    if (filterReporterEmail && u.reporterEmail !== filterReporterEmail) return false;
    return true;
  }), [updates, filterWeekDate, filterReporterEmail]);

  const uniqueWeekDates = useMemo(() => {
    const set = new Set(updates.map(u => u.weekDate));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [updates]);
  const uniqueReporters = useMemo(() => {
    const set = new Set(updates.map(u => u.reporterEmail));
    return Array.from(set).sort((a, b) => userName(a).localeCompare(userName(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updates, orgUsers]);

  const periodsForType = (dt: DurationType): Period[] => {
    const t = dt === 'quarterly' ? 'quarter' : dt === 'monthly' ? 'month' : 'week';
    return periods.filter(p => p.type === t);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Weekly Updates</h2>
            <p className="text-sm text-gray-500 mt-1">
              {filteredUpdates.length} of {updates.length} {updates.length === 1 ? 'update' : 'updates'}
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + Add an update
          </button>
        </div>
        {updates.length > 0 && (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              <label className="text-xs text-gray-500">Week</label>
              <select
                value={filterWeekDate}
                onChange={(e) => setFilterWeekDate(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
              >
                <option value="">Any week</option>
                {uniqueWeekDates.map(d => <option key={d} value={d}>w-{d}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <label className="text-xs text-gray-500">Reporter</label>
              <select
                value={filterReporterEmail}
                onChange={(e) => setFilterReporterEmail(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
              >
                <option value="">Any reporter</option>
                {uniqueReporters.map(e => <option key={e} value={e}>{userName(e)}</option>)}
              </select>
            </div>
            {(filterWeekDate || filterReporterEmail) && (
              <button
                onClick={() => { setFilterWeekDate(''); setFilterReporterEmail(''); }}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {updates.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-sm text-gray-500">
          No updates yet. Click "Add an update" to create one.
        </div>
      ) : filteredUpdates.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-sm text-gray-500">
          No updates match the current filter.
        </div>
      ) : (
        filteredUpdates.map(u => (
          <div key={u.id} className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className={`px-4 py-3 flex items-center justify-between ${collapsedIds.has(u.id) ? '' : 'border-b border-gray-200'}`}>
              <button
                onClick={() => toggleCollapsed(u.id)}
                className="flex items-center gap-2 text-left flex-1 min-w-0 hover:bg-gray-50 -mx-1 px-1 py-0.5 rounded"
                title={collapsedIds.has(u.id) ? 'Expand' : 'Collapse'}
              >
                <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${collapsedIds.has(u.id) ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <h3 className="text-base font-semibold text-gray-900 truncate">
                  Weekly Update - w-{u.weekDate} (Reporter: {userName(u.reporterEmail)})
                </h3>
              </button>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => downloadUpdateCsv(u)}
                  className="px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
                  title="Download bullets as CSV (text,sp)"
                >
                  Download CSV
                </button>
                <button
                  onClick={() => openImport(u.id)}
                  className="px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
                  title="Paste CSV to import"
                >
                  Import CSV
                </button>
                <button
                  onClick={() => setEditingId(editingId === u.id ? null : u.id)}
                  className={`p-1 rounded ${editingId === u.id ? 'text-blue-600 bg-blue-50 hover:bg-blue-100' : 'text-gray-400 hover:text-blue-600'}`}
                  title={editingId === u.id ? 'Done editing' : 'Edit update'}
                >
                  {editingId === u.id ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => removeUpdate(u.id)}
                  className="p-1 text-gray-400 hover:text-red-600 rounded"
                  title="Remove update"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
            {!collapsedIds.has(u.id) && (<>
            <div className="p-4 grid grid-cols-3 gap-4">
              {(() => {
                const isEditing = editingId === u.id;
                const periodName = u.periodId ? (periods.find(p => p.id === u.periodId)?.name || '—') : '—';
                const dtLabel = u.durationType.charAt(0).toUpperCase() + u.durationType.slice(1);
                return (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Duration type</label>
                      {isEditing ? (
                        <select
                          value={u.durationType}
                          onChange={(e) => {
                            const dt = e.target.value as DurationType;
                            const stillValid = u.periodId && periodsForType(dt).some(p => p.id === u.periodId);
                            updateField(u.id, { durationType: dt, periodId: stillValid ? u.periodId : '' });
                          }}
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                        >
                          <option value="quarterly">Quarterly</option>
                          <option value="monthly">Monthly</option>
                          <option value="weekly">Weekly</option>
                        </select>
                      ) : (
                        <div className="text-sm text-gray-800 px-3 py-2 bg-gray-50 rounded border border-gray-200">{dtLabel}</div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Reporter</label>
                      {isEditing ? (
                        <select
                          value={u.reporterEmail}
                          onChange={(e) => updateField(u.id, { reporterEmail: e.target.value })}
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                        >
                          {[...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(usr => (
                            <option key={usr.email} value={usr.email}>{usr.name || usr.email}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="text-sm text-gray-800 px-3 py-2 bg-gray-50 rounded border border-gray-200">{userName(u.reporterEmail)}</div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Period</label>
                      {isEditing ? (
                        <select
                          value={u.periodId}
                          onChange={(e) => updateField(u.id, { periodId: e.target.value })}
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                        >
                          <option value="">— Pick a period —</option>
                          {renderGroupedPeriodOptions(periodsForType(u.durationType))}
                        </select>
                      ) : (
                        <div className="text-sm text-gray-800 px-3 py-2 bg-gray-50 rounded border border-gray-200">{periodName}</div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
            {(() => {
              const bullets = u.bullets || [];
              const totalSp = bullets.reduce((sum, b) => sum + (Number.isFinite(b.sp) ? b.sp : 0), 0);
              return (
                <div className="px-4 pb-4">
                  {bullets.length > 0 && (
                    <div className="space-y-1">
                      {bullets.map((b) => (
                        <div
                          key={b.id}
                          className="group flex items-center gap-1"
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const draggedId = e.dataTransfer.getData('text/plain');
                            if (draggedId) reorderBullet(u.id, draggedId, b.id);
                          }}
                        >
                          <span
                            draggable
                            onDragStart={(e) => { e.dataTransfer.setData('text/plain', b.id); e.dataTransfer.effectAllowed = 'move'; }}
                            className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-700 p-1 flex-shrink-0"
                            title="Drag to reorder"
                          >
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                              <circle cx="12" cy="6" r="1.5" />
                              <circle cx="12" cy="12" r="1.5" />
                              <circle cx="12" cy="18" r="1.5" />
                            </svg>
                          </span>
                          {editingBullet && editingBullet.uid === u.id && editingBullet.bid === b.id && editingBullet.field === 'text' ? (
                            <input
                              type="text"
                              autoFocus
                              value={b.text}
                              onChange={(e) => editBullet(u.id, b.id, { text: e.target.value })}
                              onBlur={() => setEditingBullet(null)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingBullet(null); }}
                              placeholder="What got done…"
                              className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          ) : (
                            <button
                              onClick={() => setEditingBullet({ uid: u.id, bid: b.id, field: 'text' })}
                              className="flex-1 text-left text-sm text-gray-800 px-2 py-1 rounded hover:bg-gray-50"
                              title="Click to edit"
                            >
                              {b.text || <span className="text-gray-400 italic">What got done…</span>}
                            </button>
                          )}
                          <button
                            onClick={() => { setWhySearch(''); setWhyPicker({ uid: u.id, bid: b.id }); }}
                            className={`max-w-[180px] truncate text-xs px-2 py-1 rounded border ${b.why ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}
                            title={b.why ? `Why: ${b.why.title}` : 'Add reason (objective)'}
                          >
                            {b.why ? b.why.title : 'Why?'}
                          </button>
                          {b.why && (
                            <button
                              onClick={() => editBullet(u.id, b.id, { why: undefined })}
                              className="p-0.5 text-gray-300 hover:text-red-600"
                              title="Clear why"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          )}
                          {editingBullet && editingBullet.uid === u.id && editingBullet.bid === b.id && editingBullet.field === 'sp' ? (() => {
                            const raw = (b as UpdateBullet & { spText?: string }).spText ?? String(b.sp);
                            const invalid = raw.trim() !== '' && Number.isNaN(Number(raw));
                            return (
                              <input
                                type="text"
                                autoFocus
                                inputMode="decimal"
                                value={raw}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const n = v.trim() === '' ? 0 : Number(v);
                                  editBullet(u.id, b.id, { sp: Number.isFinite(n) ? n : b.sp, spText: v } as Partial<UpdateBullet> & { spText: string });
                                }}
                                onBlur={() => setEditingBullet(null)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingBullet(null); }}
                                className={`w-20 text-sm border rounded px-2 py-1 focus:outline-none focus:ring-1 ${invalid ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'}`}
                                title={invalid ? 'Must be a number' : 'Story points'}
                              />
                            );
                          })() : (
                            <button
                              onClick={() => setEditingBullet({ uid: u.id, bid: b.id, field: 'sp' })}
                              className="w-20 text-sm text-gray-800 px-2 py-1 rounded hover:bg-gray-50 text-right"
                              title="Click to edit"
                            >
                              {b.sp}
                            </button>
                          )}
                          <span className="text-xs text-gray-400">SP</span>
                          <button
                            onClick={() => removeBullet(u.id, b.id)}
                            className="p-1 text-gray-400 hover:text-red-600 rounded"
                            title="Remove item"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-1 group/entry">
                    <span className="text-gray-300 p-1 flex-shrink-0">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="6" r="1.5" />
                        <circle cx="12" cy="12" r="1.5" />
                        <circle cx="12" cy="18" r="1.5" />
                      </svg>
                    </span>
                    <button
                      onClick={() => {
                        const id = crypto.randomUUID();
                        updateBullets(u.id, bs => [...bs, { id, text: '', sp: 0 }]);
                        setEditingBullet({ uid: u.id, bid: id, field: 'text' });
                      }}
                      className="flex-1 text-left text-sm text-gray-400 italic px-2 py-1 rounded hover:bg-gray-50"
                      title="Click to add a new item"
                    >
                      What got done…
                    </button>
                    <span className="w-20 text-sm text-gray-400 px-2 py-1 text-right">0</span>
                    <span className="text-xs text-gray-400">SP</span>
                    <span className="w-7 flex-shrink-0" />
                  </div>
                  {bullets.length > 0 && (
                    <div className="mt-1 text-[10px] text-gray-400 uppercase tracking-wider text-right">
                      {bullets.length} {bullets.length === 1 ? 'item' : 'items'}, {totalSp} SP
                    </div>
                  )}
                </div>
              );
            })()}
            </>)}
          </div>
        ))
      )}

      {whyPicker && (() => {
        const targetBullet = updates.find(uu => uu.id === whyPicker.uid)?.bullets?.find(bb => bb.id === whyPicker.bid);
        const bulletText = targetBullet?.text || '';
        const q = whySearch.trim().toLowerCase();
        const matches = q ? objectives.filter(o => o.title.toLowerCase().includes(q)) : objectives;
        const visible = matches.slice(0, 50);
        const pathFor = (objId: string): string => {
          const parts: string[] = [];
          let cur = objectives.find(o => o.id === objId);
          let safety = 10;
          while (cur && safety-- > 0) {
            parts.unshift(cur.title);
            cur = cur.parentId ? objectives.find(o => o.id === cur!.parentId) : undefined;
          }
          return parts.join(' › ');
        };
        const pickObjective = (id: string, title: string) => {
          editBullet(whyPicker.uid, whyPicker.bid, { why: { id, title } });
          setWhyPicker(null);
          setAddChildFor(null);
          setAddChildTitle('');
        };
        const createUnder = async (parentId: string | undefined) => {
          const title = addChildTitle.trim();
          if (!title) return;
          const parent = parentId ? objectives.find(o => o.id === parentId) : undefined;
          await addObjective({
            title,
            parentId,
            level: parent?.level || 'company',
            periodId: parent?.periodId || activePeriodId || (periods[0]?.id ?? ''),
            workflowStatus: 'todo',
          }, { orgId: orgIdForCreate, userEmail, shared: true });
          setAddChildFor(null);
          setAddChildTitle('');
        };
        const renderTreeNode = (o: typeof objectives[number], depth: number): React.ReactNode => {
          const children = objectives.filter(c => c.parentId === o.id);
          const hasChildren = children.length > 0;
          const collapsed = whyCollapsed.has(o.id);
          return (
            <div key={o.id}>
              <div className="group flex items-center gap-1 px-2 py-1 hover:bg-gray-50 border-b border-gray-100" style={{ paddingLeft: depth * 16 + 8 }}>
                {hasChildren ? (
                  <button
                    onClick={() => toggleWhyCollapsed(o.id)}
                    className="text-gray-400 hover:text-gray-700 flex-shrink-0"
                    title={collapsed ? 'Expand' : 'Collapse'}
                  >
                    <svg className={`w-3 h-3 transition-transform ${collapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ) : (
                  <span className="w-3 flex-shrink-0" />
                )}
                <button
                  onClick={() => pickObjective(o.id, o.title)}
                  className="flex-1 text-left text-sm text-gray-800 truncate"
                >
                  {o.title}
                </button>
                <button
                  onClick={() => { setAddChildFor(o.id); setAddChildTitle(''); }}
                  className="p-0.5 text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100"
                  title="Add child"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                </button>
              </div>
              {addChildFor === o.id && (
                <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 border-b border-gray-100" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>
                  <input
                    type="text"
                    autoFocus
                    value={addChildTitle}
                    onChange={(e) => setAddChildTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createUnder(o.id);
                      if (e.key === 'Escape') { setAddChildFor(null); setAddChildTitle(''); }
                    }}
                    placeholder="New child objective title…"
                    className="flex-1 text-sm border border-blue-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button onClick={() => createUnder(o.id)} className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Add</button>
                  <button onClick={() => { setAddChildFor(null); setAddChildTitle(''); }} className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                </div>
              )}
              {hasChildren && !collapsed && children.map(c => renderTreeNode(c, depth + 1))}
            </div>
          );
        };
        const roots = objectives.filter(o => !o.parentId);
        return (
          <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-semibold text-gray-900">Pick an objective (why)</h3>
                <div className="inline-flex border border-gray-300 rounded overflow-hidden">
                  <button
                    onClick={() => setWhyMode('list')}
                    className={`px-2 py-0.5 text-xs ${whyMode === 'list' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  >List</button>
                  <button
                    onClick={() => setWhyMode('tree')}
                    className={`px-2 py-0.5 text-xs border-l border-gray-300 ${whyMode === 'tree' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  >Tree</button>
                </div>
              </div>
              <div className="text-xs text-gray-500 mb-3">
                Work item: <span className="font-medium text-gray-800">{bulletText || <span className="italic text-gray-400">(empty)</span>}</span>
              </div>
              {whyMode === 'list' ? (
                <>
                  <input
                    type="text"
                    autoFocus
                    value={whySearch}
                    onChange={(e) => setWhySearch(e.target.value)}
                    placeholder="Search objectives…"
                    className="w-full text-sm border border-gray-300 rounded px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="border border-gray-200 rounded max-h-72 overflow-y-auto">
                    {objectives.length === 0 ? (
                      <div className="p-3 text-xs text-gray-400">No objectives yet.</div>
                    ) : visible.length === 0 ? (
                      <div className="p-3 text-xs text-gray-400">No matches.</div>
                    ) : (
                      visible.map(o => (
                        <button
                          key={o.id}
                          onClick={() => pickObjective(o.id, o.title)}
                          className="w-full text-left px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                        >
                          <div className="truncate">{o.title}</div>
                          {o.parentId && (
                            <div className="text-[10px] text-gray-400 truncate">{pathFor(o.id)}</div>
                          )}
                        </button>
                      ))
                    )}
                    {matches.length > visible.length && (
                      <div className="px-3 py-1 text-[10px] text-gray-400 border-t border-gray-100">Showing 50 of {matches.length} — type to narrow</div>
                    )}
                  </div>
                </>
              ) : (
                <div>
                  <div className="flex items-center justify-end mb-2">
                    <button
                      onClick={() => { setAddChildFor('root'); setAddChildTitle(''); }}
                      className="px-2 py-0.5 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
                    >
                      + Add top-level objective
                    </button>
                  </div>
                  {addChildFor === 'root' && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 border border-blue-100 rounded mb-2">
                      <input
                        type="text"
                        autoFocus
                        value={addChildTitle}
                        onChange={(e) => setAddChildTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') createUnder(undefined);
                          if (e.key === 'Escape') { setAddChildFor(null); setAddChildTitle(''); }
                        }}
                        placeholder="New top-level objective title…"
                        className="flex-1 text-sm border border-blue-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button onClick={() => createUnder(undefined)} className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Add</button>
                      <button onClick={() => { setAddChildFor(null); setAddChildTitle(''); }} className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                    </div>
                  )}
                  <div className="border border-gray-200 rounded max-h-72 overflow-y-auto">
                    {roots.length === 0 ? (
                      <div className="p-3 text-xs text-gray-400">No objectives yet.</div>
                    ) : (
                      roots.map(r => renderTreeNode(r, 0))
                    )}
                  </div>
                </div>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => { setWhyPicker(null); setAddChildFor(null); setAddChildTitle(''); }}
                  className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {importTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Import bullets from CSV</h3>
            <p className="text-xs text-gray-500 mb-3">Choose a <code>.csv</code> file. Expected format: <code>text,sp</code> (header row optional).</p>
            <label className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 cursor-pointer">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {importFileName ? 'Choose a different file' : 'Choose CSV file'}
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => handleImportFile(e.target.files?.[0])}
                className="hidden"
              />
            </label>
            {importRows && (
              <div className="mt-3 text-xs text-gray-600">
                <div className="mb-1"><span className="font-medium text-gray-800">{importFileName}</span> · {importRows.length} {importRows.length === 1 ? 'item' : 'items'} detected</div>
                {importRows.length > 0 && (
                  <ul className="border border-gray-200 rounded p-2 max-h-40 overflow-y-auto bg-gray-50 space-y-0.5">
                    {importRows.slice(0, 10).map((r, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="truncate flex-1">{r.text || <span className="italic text-gray-400">(empty)</span>}</span>
                        {r.whyTitle && <span className="text-blue-700 truncate max-w-[150px]" title={r.whyTitle}>{r.whyTitle}</span>}
                        <span className="text-gray-500 flex-shrink-0">{r.sp} SP</span>
                      </li>
                    ))}
                    {importRows.length > 10 && <li className="text-gray-400">…and {importRows.length - 10} more</li>}
                  </ul>
                )}
              </div>
            )}
            <div className="mt-2 flex items-center gap-3 text-xs">
              <label className="inline-flex items-center gap-1">
                <input type="radio" checked={importMode === 'append'} onChange={() => setImportMode('append')} /> Append
              </label>
              <label className="inline-flex items-center gap-1">
                <input type="radio" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} /> Replace existing
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setImportTarget(null)}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={runImport}
                disabled={!importRows || importRows.length === 0}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Add a weekly update</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Pick a week</label>
                <select
                  value={newWeekPeriodId}
                  onChange={(e) => setNewWeekPeriodId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                  autoFocus
                >
                  <option value="">— Pick a week —</option>
                  {weekPeriods.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {weekPeriods.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">No weekly periods exist yet. Create some on the Periods page.</p>
                )}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setShowAdd(false); setNewWeekPeriodId(''); }}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={addUpdate}
                disabled={!newWeekPeriodId}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Add update
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
