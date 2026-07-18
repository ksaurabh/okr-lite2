import { useEffect } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { WORKFLOW_STATUS_OPTIONS } from '../../utils/objectiveFilters';
import type { List, Objective, WorkflowStatus } from '../../types';

interface GradePlanModalProps {
  plan: List;
  isReadOnly: boolean;
  onClose: () => void;
}

// Clamp a typed attainment value to the 0-100 range; empty clears it (undefined).
function parseAttainment(raw: string): number | undefined {
  const t = raw.trim();
  if (t === '') return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, n));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// Grade a plan: for each objective in it, set a workflow status and an attainment
// percentage; VP attained = valuePoints * attainment / 100. Totals roll up the
// plan's value points and how much of it was attained. Status and attainment are
// stored on the objective (see Objective.attainment), so grading is intrinsic to
// the objective, not scoped to one plan.
export function GradePlanModal({ plan, isReadOnly, onClose }: GradePlanModalProps) {
  const objectives = useOKRStore((s: OKRStore) => s.objectives);
  const updateObjective = useOKRStore((s: OKRStore) => s.updateObjective);
  const { user } = useAuth();
  const userEmail = user?.email || '';

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onEsc); document.body.style.overflow = 'unset'; };
  }, [onClose]);

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

  const setStatus = (o: Objective, workflowStatus: WorkflowStatus) => {
    if (o.workflowStatus === workflowStatus) return;
    updateObjective(o.id, { workflowStatus }, userEmail);
  };
  const setAttainment = (o: Objective, next: number | undefined) => {
    if ((o.attainment ?? undefined) === next) return;
    updateObjective(o.id, { attainment: next }, userEmail);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Grade plan — {plan.name}</h2>
            <p className="text-xs text-gray-500">Set each item's status and attainment. VP attained = VP × attainment%.</p>
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
                  <th className="py-2 font-medium text-right">VP attained</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(o => (
                  <tr key={o.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-1.5 pr-4 text-gray-800">
                      {o.title}
                      {o.isKeyResult && <span className="ml-1.5 text-[10px] text-purple-600 font-medium">KR</span>}
                    </td>
                    <td className="py-1.5 pr-4">
                      <select
                        value={o.workflowStatus || 'todo'}
                        disabled={isReadOnly}
                        onChange={(e) => setStatus(o, e.target.value as WorkflowStatus)}
                        className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                      >
                        {WORKFLOW_STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-gray-700">{round1(vpOf(o))}</td>
                    <td className="py-1.5 pr-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          disabled={isReadOnly}
                          defaultValue={o.attainment ?? ''}
                          key={`${o.id}:${o.attainment ?? ''}`}
                          onBlur={(e) => {
                            const next = parseAttainment(e.target.value);
                            // Reflect the clamped value back into the field.
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
                    <td className="py-1.5 text-right tabular-nums font-medium text-gray-800">{round1(attainedOf(o))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 font-medium">
                  <td className="py-2 pr-4 text-gray-800">Total</td>
                  <td className="py-2 pr-4 text-xs text-gray-400">{rows.length} {rows.length === 1 ? 'item' : 'items'}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{round1(totalVp)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-gray-500">{overallPct}%</td>
                  <td className="py-2 text-right tabular-nums">{round1(totalAttained)}</td>
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
          <button onClick={onClose} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Done</button>
        </div>
      </div>
    </div>
  );
}
