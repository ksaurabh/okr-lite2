import { useEffect, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { ReportCardBody } from './ReportCardBody';
import { scorecardUrl, scorecardPlanIdFromUrl } from './scorecardLink';
import type { List } from '../../types';

const CLOSED_STATUS = 'Closed';

// Standalone, full-page scorecard rendered directly from /scorecard?plan=<id> —
// no sidebar, no navigation. This is what the "Copy link" button shares.
export function ScorecardPage({ onExit }: { onExit: () => void }) {
  const lists = useOKRStore((s: OKRStore) => s.lists);
  const sharedPlans = useOKRStore((s: OKRStore) => s.sharedPlans);
  const isLoading = useOKRStore((s: OKRStore) => s.isLoading);
  const setListStatus = useOKRStore((s: OKRStore) => s.setListStatus);
  const objectives = useOKRStore((s: OKRStore) => s.objectives);

  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Plans load in a separate fetch from the main data gate, so give them a moment
  // to arrive before declaring the plan missing.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const planId = scorecardPlanIdFromUrl();
  // Own plans (editable) take priority; shared plans are read-only.
  const owned = lists.find(l => l.id === planId) || null;
  const shared = sharedPlans.find(l => l.id === planId) || null;
  const plan: List | null = owned || shared;
  const isReadOnly = !!(plan as (List & { createdByEmail?: string }) | null)?.createdByEmail;
  const isClosed = plan?.status === CLOSED_STATUS;

  const copyLink = async () => {
    if (!plan) return;
    try { await navigator.clipboard.writeText(scorecardUrl(plan.id)); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt('Copy this scorecard link:', scorecardUrl(plan.id)); }
  };

  const submitGrades = async () => {
    if (!plan) return;
    const graded = plan.items.filter(it => objectives.find(o => o.id === it.objectiveId)?.attainment !== undefined).length;
    const ungraded = plan.items.length - graded;
    const msg = ungraded > 0
      ? `${ungraded} of ${plan.items.length} items have no attainment set. Submit grades and mark "${plan.name}" as Closed anyway?`
      : `Submit grades and mark "${plan.name}" as Closed?`;
    if (!window.confirm(msg)) return;
    setSubmitting(true);
    try { await setListStatus(plan.id, CLOSED_STATUS); } finally { setSubmitting(false); }
  };

  if (!plan) {
    const stillLoading = isLoading || !gaveUp;
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <p className="text-gray-600">{stillLoading ? 'Loading scorecard…' : 'That plan could not be found, or you don\'t have access to it.'}</p>
          {!stillLoading && <button onClick={onExit} className="mt-3 text-sm text-blue-600 hover:underline">Go to plans</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-6 px-4">
      <div className="max-w-5xl mx-auto bg-white rounded-xl shadow-md overflow-hidden">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-gray-200">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-900">Report card</h1>
              {isClosed && <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">Closed</span>}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{plan.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={copyLink} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50" title="Copy this scorecard link">
              {copied ? 'Link copied ✓' : 'Copy link'}
            </button>
            {!isReadOnly && (
              <button onClick={submitGrades} disabled={submitting} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50" title="Submit grades and mark this plan as Closed">
                {submitting ? 'Submitting…' : isClosed ? 'Re-submit (keep Closed)' : 'Submit grades & close'}
              </button>
            )}
            <button onClick={onExit} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Open in app</button>
          </div>
        </div>

        <ReportCardBody plan={plan} isReadOnly={isReadOnly} />
      </div>
    </div>
  );
}
