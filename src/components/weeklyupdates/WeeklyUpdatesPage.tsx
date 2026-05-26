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
  const { user } = useAuth();
  const userEmail = user?.email || '';
  const periods = useOKRStore((s: OKRStore) => s.periods);

  const [updates, setUpdates] = useState<WeeklyUpdate[]>(() => loadUpdates());
  const [showAdd, setShowAdd] = useState(false);
  const [newWeekPeriodId, setNewWeekPeriodId] = useState('');
  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBullet, setEditingBullet] = useState<{ uid: string; bid: string; field: 'text' | 'sp' } | null>(null);
  const [importTarget, setImportTarget] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState<'replace' | 'append'>('append');
  const csvEscape = (s: string) => {
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const bulletsToCsv = (bs: UpdateBullet[]) => ['text,sp', ...bs.map(b => `${csvEscape(b.text)},${b.sp}`)].join('\n');
  const parseCsv = (text: string): Array<{ text: string; sp: number }> => {
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
    const result: Array<{ text: string; sp: number }> = [];
    for (const row of rows) {
      if (row.length === 0 || row.every(x => x.trim() === '')) continue;
      if (row.length === 1 && /^\s*(text\s*,?\s*sp?)\s*$/i.test(row[0])) continue;
      const t = (row[0] || '').trim();
      const spStr = (row[1] || '').trim();
      if (/^text$/i.test(t) && /^sp$/i.test(spStr)) continue;
      const sp = Number(spStr);
      result.push({ text: t, sp: Number.isFinite(sp) ? sp : 0 });
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

  const openImport = (uid: string) => { setImportTarget(uid); setImportText(''); setImportMode('append'); };
  const handleImportFile = async (file: File | null | undefined) => {
    if (!file) return;
    const text = await file.text();
    setImportText(text);
  };
  const runImport = () => {
    if (!importTarget) return;
    const rows = parseCsv(importText);
    if (rows.length === 0) { setImportTarget(null); return; }
    const newBullets: UpdateBullet[] = rows.map(r => ({ id: crypto.randomUUID(), text: r.text, sp: r.sp }));
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

  const periodsForType = (dt: DurationType): Period[] => {
    const t = dt === 'quarterly' ? 'quarter' : dt === 'monthly' ? 'month' : 'week';
    return periods.filter(p => p.type === t);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Weekly Updates</h2>
          <p className="text-sm text-gray-500 mt-1">{updates.length} {updates.length === 1 ? 'update' : 'updates'}</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          + Add an update
        </button>
      </div>

      {updates.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-sm text-gray-500">
          No updates yet. Click "Add an update" to create one.
        </div>
      ) : (
        updates.map(u => (
          <div key={u.id} className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">
                Weekly Update - w-{u.weekDate} (Reporter: {userName(u.reporterEmail)})
              </h3>
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
          </div>
        ))
      )}

      {importTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Import bullets from CSV</h3>
            <p className="text-xs text-gray-500 mb-3">Upload a <code>.csv</code> file or paste rows below. Format: <code>text,sp</code> (header row optional).</p>
            <div className="mb-2">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => handleImportFile(e.target.files?.[0])}
                className="text-xs"
              />
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              placeholder={'text,sp\nShipped login page,3\n"Wrote PRD for X feature",5'}
              className="w-full text-sm border border-gray-300 rounded px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
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
                disabled={!importText.trim()}
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
