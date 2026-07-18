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

// Clamp a typed attainment value to the 0-100 range; empty clears it (undefined).
function parseAttainment(raw: string): number | undefined {
  const t = raw.trim();
  if (t === '') return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, n));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// A plan's report card: for each item, a workflow status, an attainment % and a
// comment; VP attained = valuePoints * attainment / 100. Totals roll up the
// plan's value points and how much was attained. "Submit grades" closes the plan.
// A direct link (/plans?plan=<id>&scorecard=1) reopens this card.
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

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onEsc); document.body.style.overflow = 'unset'; };
  }, [onClose]);

  // Read the plan's status live from the store so it reflects a just-submitted close.
  const livePlan = lists.find(l => l.id === plan.id) || sharedPlans.find(l => l.id === plan.id) || plan;
  const isClosed = livePlan.status === CLOSED_STATUS;

  // Resolve the plan's items to objectives, in item order, dropping any that no
  // longer exist.
  const byId = new Map(objectives.map((o: Objective) => [o.id, o]));
  const rows = [...plan.items]
    .sort((a, b) => a.order - b.order)
    .map(it => byId.get(it.objectiveId))
    .filter((o): o is Objective => !!o);

  const vpOf = (o: Objective) => o.valuePoints || 0;
  const attainedOf = (o: Objective) => vpOf(o) * (o.attainment ?? 0) / 100;

  const totalVp = rows.reduce((n, o) => n + vpOf(o), 0);
  const totalAttained = rows.reduce((n, o) => n + attainedOf(o), 0);
  const overallPct = totalVp > 0 ? Math.round((totalAttained / totalVp) * 100) : 0;
  const ungraded = rows.filter(o => o.attainment === undefined).length;

  const setStatus = (o: Objective, workflowStatus: WorkflowStatus) => {
    if (o.workflowStatus === workflowStatus) return;
    updateObjective(o.id, { workflowStatus }, userEmail);
  };
  const setAttainment = (o: Objective, next: number | undefined) => {
    if ((o.attainment ?? undefined) === next) return;
    updateObjective(o.id, { attainment: next }, userEmail);
  };
  const setNote = (o: Objective, raw: string) => {
    const next = raw.trim() || undefined;
    if ((o.attainmentNote || undefined) === next) return;
    updateObjective(o.id, { attainmentNote: next }, userEmail);
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/plans?plan=${encodeURIComponent(plan.id)}&scorecard=1`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this scorecard link:', url);
    }
  };

  const submitGrades = async () => {
    const msg = ungraded > 0
      ? `${ungraded} of ${rows.length} items have no attainment set. Submit grades and mark "${plan.name}" as Closed anyway?`
      : `Submit grades and mark "${plan.name}" as Closed?`;
    if (!window.confirm(msg)) return;
    setSubmitting(true);
    try {
      await setListStatus(plan.id, CLOSED_STATUS);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-5xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">Report card — {plan.name}</h2>
              {isClosed && <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">Closed</span>}
            </div>
            <p className="text-xs text-gray-500">Set each item's status, attainment and a comment. VP attained = VP × attainment%.</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded" title="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {rows.length === 0 ? (
            <p className="text-sm text-gray-500">This plan has no items to grade.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 text-left border-b border-gray-200">
                  <th className="py-2 pr-4 font-medium">Item</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium text-right">VP</th>
                  <th className="py-2 pr-4 font-medium text-right">Attainment</th>
                  <th className="py-2 pr-4 font-medium text-right">VP attained</th>
                  <th className="py-2 font-medium">Comment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(o => (
                  <tr key={o.id} className="border-b border-gray-100 last:border-0 align-top">
                    <td className="py-2 pr-4 text-gray-800">
                      {o.title}
                      {o.isKeyResult && <span className="ml-1.5 text-[10px] text-purple-600 font-medium">KR</span>}
                    </td>
                    <td className="py-2 pr-4">
                      <select
                        value={o.workflowStatus || 'todo'}
                        disabled={isReadOnly}
                        onChange={(e) => setStatus(o, e.target.value as WorkflowStatus)}
                        className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                      >
                        {WORKFLOW_STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-gray-700">{round1(vpOf(o))}</td>
                    <td className="py-2 pr-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          disabled={isReadOnly}
                          defaultValue={o.attainment ?? ''}
                          key={`att:${o.id}:${o.attainment ?? ''}`}
                          onBlur={(e) => {
                            const next = parseAttainment(e.target.value);
                            e.target.value = next === undefined ? '' : String(next);
                            setAttainment(o, next);
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          placeholder="—"
                          className="w-16 text-xs text-right border border-gray-300 rounded px-1.5 py-1 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                        />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums font-medium text-gray-800">{round1(attainedOf(o))}</td>
                    <td className="py-2">
                      <textarea
                        rows={2}
                        disabled={isReadOnly}
                        defaultValue={o.attainmentNote ?? ''}
                        key={`note:${o.id}:${o.attainmentNote ?? ''}`}
                        onBlur={(e) => setNote(o, e.target.value)}
                        placeholder="Why this grade…"
                        className="w-full min-w-[12rem] text-xs border border-gray-300 rounded px-1.5 py-1 bg-white disabled:bg-gray-50 disabled:text-gray-400 resize-y"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 font-medium">
                  <td className="py-2 pr-4 text-gray-800">Total</td>
                  <td className="py-2 pr-4 text-xs text-gray-400">{rows.length} {rows.length === 1 ? 'item' : 'items'}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{round1(totalVp)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-gray-500">{overallPct}%</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{round1(totalAttained)}</td>
                  <td className="py-2" />
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 p-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <div className="text-sm text-gray-700">
            <span className="font-medium">{round1(totalAttained)}</span> of <span className="font-medium">{round1(totalVp)}</span> VP attained
            <span className="text-gray-400"> ({overallPct}% of the plan)</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyLink}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-100"
              title="Copy a direct link to this scorecard"
            >
              {copied ? 'Link copied ✓' : 'Copy scorecard link'}
            </button>
            {!isReadOnly && (
              <button
                onClick={submitGrades}
                disabled={submitting}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                title="Submit grades and mark this plan as Closed"
              >
                {submitting ? 'Submitting…' : isClosed ? 'Re-submit (keep Closed)' : 'Submit grades & close plan'}
              </button>
            )}
            <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-100">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
