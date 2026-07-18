import { useEffect, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { WORKFLOW_STATUS_OPTIONS } from '../../utils/objectiveFilters';
import type { List, Objective, WorkflowStatus } from '../../types';

interface GradePlanModalProps {
  plan: List;
  isReadOnly: boolean;
  onClose: () => void;
}

const CLOSED_STATUS = 'Closed';

const STATUS_LABEL: Record<string, string> = Object.fromEntries(WORKFLOW_STATUS_OPTIONS.map(s => [s.value, s.label]));
// View-mode pill colors per workflow status.
const STATUS_PILL: Record<WorkflowStatus, string> = {
  todo: 'bg-gray-100 text-gray-600',
  backlog: 'bg-slate-100 text-slate-600',
  planning: 'bg-indigo-100 text-indigo-700',
  in_progress: 'bg-blue-100 text-blue-700',
  acceptance: 'bg-amber-100 text-amber-700',
  done: 'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-400',
};

function parseAttainment(raw: string): number | undefined {
  const t = raw.trim();
  if (t === '') return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, n));
}

const round1 = (n: number) => Math.round(n * 10) / 10;
// Color a percentage: green when strong, amber mid, red weak, gray when unset.
const pctColor = (pct: number | null) =>
  pct == null ? 'text-gray-300' : pct >= 80 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500';
const barColor = (pct: number) => (pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500');

// A plan's report card. Renders read-only; clicking a status, attainment or
// comment cell turns just that cell editable (commit on blur). VP attained = VP ×
// attainment / 100; totals roll up the plan. "Submit grades" closes the plan, and
// a direct link (/plans?plan=<id>&scorecard=1) reopens this card.
export function GradePlanModal({ plan, isReadOnly, onClose }: GradePlanModalProps) {
  const objectives = useOKRStore((s: OKRStore) => s.objectives);
  const lists = useOKRStore((s: OKRStore) => s.lists);
  const sharedPlans = useOKRStore((s: OKRStore) => s.sharedPlans);
  const updateObjective = useOKRStore((s: OKRStore) => s.updateObjective);
  const setListStatus = useOKRStore((s: OKRStore) => s.setListStatus);
  const { user } = useAuth();
  const userEmail = user?.email || '';

  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Which cell is being edited, keyed `${objectiveId}:${field}`; null = all view mode.
  const [editing, setEditing] = useState<string | null>(null);
  const editKey = (id: string, field: 'status' | 'att' | 'note') => `${id}:${field}`;

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (editing) setEditing(null); else onClose(); } };
    document.addEventListener('keydown', onEsc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onEsc); document.body.style.overflow = 'unset'; };
  }, [onClose, editing]);

  const livePlan = lists.find(l => l.id === plan.id) || sharedPlans.find(l => l.id === plan.id) || plan;
  const isClosed = livePlan.status === CLOSED_STATUS;

  const byId = new Map(objectives.map((o: Objective) => [o.id, o]));
  const rows = [...plan.items]
    .sort((a, b) => a.order - b.order)
    .map(it => byId.get(it.objectiveId))
    .filter((o): o is Objective => !!o);

  const vpOf = (o: Objective) => o.valuePoints || 0;
  const pctOf = (o: Objective) => (o.attainment ?? null);
  const attainedOf = (o: Objective) => vpOf(o) * (o.attainment ?? 0) / 100;

  const totalVp = rows.reduce((n, o) => n + vpOf(o), 0);
  const totalAttained = rows.reduce((n, o) => n + attainedOf(o), 0);
  const overallPct = totalVp > 0 ? Math.round((totalAttained / totalVp) * 100) : 0;
  const ungraded = rows.filter(o => o.attainment === undefined).length;

  const setStatus = (o: Objective, workflowStatus: WorkflowStatus) => {
    if (o.workflowStatus !== workflowStatus) updateObjective(o.id, { workflowStatus }, userEmail);
  };
  const setAttainment = (o: Objective, next: number | undefined) => {
    if ((o.attainment ?? undefined) !== next) updateObjective(o.id, { attainment: next }, userEmail);
  };
  const setNote = (o: Objective, raw: string) => {
    const next = raw.trim() || undefined;
    if ((o.attainmentNote || undefined) !== next) updateObjective(o.id, { attainmentNote: next }, userEmail);
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/plans?plan=${encodeURIComponent(plan.id)}&scorecard=1`;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt('Copy this scorecard link:', url); }
  };

  const submitGrades = async () => {
    const msg = ungraded > 0
      ? `${ungraded} of ${rows.length} items have no attainment set. Submit grades and mark "${plan.name}" as Closed anyway?`
      : `Submit grades and mark "${plan.name}" as Closed?`;
    if (!window.confirm(msg)) return;
    setSubmitting(true);
    try { await setListStatus(plan.id, CLOSED_STATUS); } finally { setSubmitting(false); }
  };

  // Editable unless it's someone else's shared (read-only) plan. A Closed plan can
  // still be re-graded and re-submitted.
  const canEdit = !isReadOnly;
  // A read-only cell that becomes an editor on click.
  const cellButton = (key: string, node: React.ReactNode, align = 'text-left') =>
    canEdit ? (
      <button onClick={() => setEditing(key)} className={`w-full ${align} rounded px-1.5 py-1 hover:bg-blue-50 transition-colors`}>{node}</button>
    ) : (
      <div className={`px-1.5 py-1 ${align}`}>{node}</div>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-5xl mx-4 max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">Report card</h2>
              {isClosed && <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">Closed</span>}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{plan.name}</p>
          </div>
          <button onClick={onClose} className="p-1 -m-1 text-gray-400 hover:text-gray-700 rounded" title="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Summary */}
        <div className="px-5 py-4 bg-gray-50 border-b border-gray-200">
          <div className="flex items-end justify-between mb-2">
            <div>
              <div className="text-3xl font-bold tabular-nums text-gray-900">{overallPct}<span className="text-lg text-gray-400">%</span></div>
              <div className="text-xs text-gray-500 -mt-0.5">overall attainment</div>
            </div>
            <div className="text-right text-sm text-gray-600">
              <div><span className="font-semibold text-gray-900 tabular-nums">{round1(totalAttained)}</span> / {round1(totalVp)} VP attained</div>
              <div className="text-xs text-gray-400">{rows.length} {rows.length === 1 ? 'item' : 'items'}{ungraded > 0 ? ` · ${ungraded} ungraded` : ''}</div>
            </div>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
            <div className={`h-full rounded-full ${barColor(overallPct)} transition-all`} style={{ width: `${Math.min(100, overallPct)}%` }} />
          </div>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-gray-500 p-5">This plan has no items to grade.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white shadow-[0_1px_0_0_#e5e7eb]">
                <tr className="text-[11px] uppercase tracking-wide text-gray-400 text-left">
                  <th className="py-2 px-5 font-medium">Item</th>
                  <th className="py-2 px-2 font-medium">Status</th>
                  <th className="py-2 px-2 font-medium text-right">VP</th>
                  <th className="py-2 px-2 font-medium text-right">Attain.</th>
                  <th className="py-2 px-2 font-medium text-right">VP att.</th>
                  <th className="py-2 px-5 font-medium w-[34%]">Comment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(o => {
                  const pct = pctOf(o);
                  return (
                    <tr key={o.id} className="border-t border-gray-100 hover:bg-gray-50/60 align-middle">
                      <td className="py-2 px-5 text-gray-800">
                        {o.title}
                        {o.isKeyResult && <span className="ml-1.5 text-[10px] text-purple-600 font-medium align-middle">KR</span>}
                      </td>
                      {/* Status */}
                      <td className="py-1.5 px-2 whitespace-nowrap">
                        {editing === editKey(o.id, 'status') ? (
                          <select
                            autoFocus
                            value={o.workflowStatus || 'todo'}
                            onChange={(e) => { setStatus(o, e.target.value as WorkflowStatus); setEditing(null); }}
                            onBlur={() => setEditing(null)}
                            className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white"
                          >
                            {WORKFLOW_STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                        ) : cellButton(
                          editKey(o.id, 'status'),
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_PILL[o.workflowStatus || 'todo']}`}>
                            {STATUS_LABEL[o.workflowStatus || 'todo']}
                          </span>,
                        )}
                      </td>
                      {/* VP */}
                      <td className="py-1.5 px-2 text-right tabular-nums text-gray-500">{round1(vpOf(o))}</td>
                      {/* Attainment */}
                      <td className="py-1.5 px-2 text-right whitespace-nowrap">
                        {editing === editKey(o.id, 'att') ? (
                          <input
                            type="number" min="0" max="100" step="any" autoFocus
                            defaultValue={o.attainment ?? ''}
                            onBlur={(e) => { setAttainment(o, parseAttainment(e.target.value)); setEditing(null); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            className="w-16 text-xs text-right border border-gray-300 rounded px-1.5 py-1"
                          />
                        ) : cellButton(
                          editKey(o.id, 'att'),
                          <span className={`tabular-nums font-medium ${pctColor(pct)}`}>{pct == null ? '—' : `${round1(pct)}%`}</span>,
                          'text-right',
                        )}
                      </td>
                      {/* VP attained */}
                      <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-gray-800">{round1(attainedOf(o))}</td>
                      {/* Comment */}
                      <td className="py-1.5 px-5">
                        {editing === editKey(o.id, 'note') ? (
                          <textarea
                            autoFocus rows={2}
                            defaultValue={o.attainmentNote ?? ''}
                            onBlur={(e) => { setNote(o, e.target.value); setEditing(null); }}
                            placeholder="Why this grade…"
                            className="w-full text-xs border border-gray-300 rounded px-2 py-1 resize-y"
                          />
                        ) : cellButton(
                          editKey(o.id, 'note'),
                          o.attainmentNote
                            ? <span className="text-gray-600 whitespace-pre-wrap">{o.attainmentNote}</span>
                            : <span className="text-gray-300 italic">{canEdit ? 'Add a comment…' : '—'}</span>,
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50/60 font-semibold text-gray-800">
                  <td className="py-2.5 px-5">Total</td>
                  <td className="py-2.5 px-2" />
                  <td className="py-2.5 px-2 text-right tabular-nums">{round1(totalVp)}</td>
                  <td className={`py-2.5 px-2 text-right tabular-nums ${pctColor(overallPct)}`}>{overallPct}%</td>
                  <td className="py-2.5 px-2 text-right tabular-nums">{round1(totalAttained)}</td>
                  <td className="py-2.5 px-5" />
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-5 py-3 border-t border-gray-200 bg-white">
          <span className="text-xs text-gray-400">{canEdit ? 'Click a status, attainment or comment to edit.' : 'Read-only.'}</span>
          <div className="flex items-center gap-2">
            <button onClick={copyLink} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100" title="Copy a direct link to this scorecard">
              {copied ? 'Link copied ✓' : 'Copy link'}
            </button>
            {!isReadOnly && (
              <button onClick={submitGrades} disabled={submitting} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50" title="Submit grades and mark this plan as Closed">
                {submitting ? 'Submitting…' : isClosed ? 'Re-submit (keep Closed)' : 'Submit grades & close'}
              </button>
            )}
            <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100">Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}
