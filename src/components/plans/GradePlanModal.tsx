import { useEffect, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { ReportCardBody } from './ReportCardBody';
import { scorecardUrl } from './scorecardLink';
import type { List } from '../../types';

interface GradePlanModalProps {
  plan: List;
  isReadOnly: boolean;
  onClose: () => void;
}

const CLOSED_STATUS = 'Closed';

// Modal wrapper around the report card, opened from a plan's kebab menu.
export function GradePlanModal({ plan, isReadOnly, onClose }: GradePlanModalProps) {
  const lists = useOKRStore((s: OKRStore) => s.lists);
  const sharedPlans = useOKRStore((s: OKRStore) => s.sharedPlans);
  const setListStatus = useOKRStore((s: OKRStore) => s.setListStatus);
  const objectives = useOKRStore((s: OKRStore) => s.objectives);

  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onEsc); document.body.style.overflow = 'unset'; };
  }, [onClose]);

  const livePlan = lists.find(l => l.id === plan.id) || sharedPlans.find(l => l.id === plan.id) || plan;
  const isClosed = livePlan.status === CLOSED_STATUS;

  const copyLink = async () => {
    const url = scorecardUrl(plan.id);
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt('Copy this scorecard link:', url); }
  };

  const submitGrades = async () => {
    const graded = plan.items.filter(it => objectives.find(o => o.id === it.objectiveId)?.attainment !== undefined).length;
    const ungraded = plan.items.length - graded;
    const msg = ungraded > 0
      ? `${ungraded} of ${plan.items.length} items have no attainment set. Submit grades and mark "${plan.name}" as Closed anyway?`
      : `Submit grades and mark "${plan.name}" as Closed?`;
    if (!window.confirm(msg)) return;
    setSubmitting(true);
    try { await setListStatus(plan.id, CLOSED_STATUS); } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-5xl mx-4 max-h-[90vh] flex flex-col overflow-hidden">
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

        <div className="flex-1 overflow-auto">
          <ReportCardBody plan={plan} isReadOnly={isReadOnly} />
        </div>

        <div className="flex items-center justify-between gap-4 px-5 py-3 border-t border-gray-200 bg-white">
          <span className="text-xs text-gray-400">{isReadOnly ? 'Read-only.' : 'Click a status, attainment or comment to edit.'}</span>
          <div className="flex items-center gap-2">
            <button onClick={copyLink} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100" title="Copy a direct link to the standalone scorecard page">
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
