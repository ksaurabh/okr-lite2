import { useEffect, useMemo, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import type { List } from '../../types';

interface Props {
  sourcePlan: List;
  onClose: () => void;
}

// Copy every item of one plan into another plan, picked from a searchable list —
// or created inline when no matching plan exists. Items already in the target are
// skipped; the source plan is left unchanged.
export function AddAllItemsToPlanModal({ sourcePlan, onClose }: Props) {
  const lists = useOKRStore((s: OKRStore) => s.lists);
  const periods = useOKRStore((s: OKRStore) => s.periods);
  const createList = useOKRStore((s: OKRStore) => s.createList);
  const addItemToList = useOKRStore((s: OKRStore) => s.addItemToList);
  const setPlanFocusListId = useOKRStore((s: OKRStore) => s.setPlanFocusListId);

  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onEsc); document.body.style.overflow = 'unset'; };
  }, [onClose]);

  const itemCount = sourcePlan.items.length;
  const plans = useMemo(
    () => lists.filter(l => l.ownerId && l.periodId && l.id !== sourcePlan.id),
    [lists, sourcePlan.id],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plans.filter(p => !q || p.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  }, [plans, search]);

  // Add every source item not already present in the target, then focus it.
  const addAllTo = async (target: List, confirm: boolean) => {
    const existing = new Set(target.items.map(it => it.objectiveId));
    const toAdd = sourcePlan.items.filter(it => !existing.has(it.objectiveId));
    if (toAdd.length === 0) {
      window.alert(`All ${itemCount} item${itemCount === 1 ? '' : 's'} are already in "${target.name}".`);
      return;
    }
    if (confirm && !window.confirm(`Add ${toAdd.length} item${toAdd.length === 1 ? '' : 's'} to "${target.name}"?`)) return;
    setBusy(true);
    try {
      for (const it of toAdd) await addItemToList(target.id, it.objectiveId);
      setPlanFocusListId(target.id);
      const skipped = itemCount - toAdd.length;
      onClose();
      if (skipped > 0) window.alert(`Added ${toAdd.length} item${toAdd.length === 1 ? '' : 's'}; ${skipped} already in the plan.`);
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Inherit the source plan's owner/period/level/parent/color so the new plan
      // is a valid plan (needs owner + period) in the same context.
      const res = await createList(name, sourcePlan.color, sourcePlan.parentId, {
        ownerId: sourcePlan.ownerId,
        periodId: sourcePlan.periodId,
        level: sourcePlan.level,
        shared: sourcePlan.shared,
      });
      if (!res || typeof res !== 'object' || !('id' in res)) {
        setError(res && typeof res === 'object' && 'error' in res ? res.error : 'Could not create the plan.');
        setBusy(false);
        return;
      }
      await addAllTo(res, false);
    } finally {
      setBusy(false);
    }
  };

  const periodName = (id?: string) => periods.find(p => p.id === id)?.name;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between p-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Add all items to a plan</h2>
            <p className="text-xs text-gray-500 mt-0.5">Copy all {itemCount} item{itemCount === 1 ? '' : 's'} from “{sourcePlan.name}” into another plan.</p>
          </div>
          <button onClick={onClose} className="p-1 -m-1 text-gray-400 hover:text-gray-700 rounded" title="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {itemCount === 0 ? (
          <div className="p-4 text-sm text-gray-500">This plan has no items to add.</div>
        ) : (
          <>
            <div className="p-3 border-b border-gray-100">
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search plans…"
                className="w-full text-sm px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-4 py-3 text-xs text-gray-400">No matching plan. Create one below.</div>
              ) : filtered.map(p => (
                <button
                  key={p.id}
                  onClick={() => addAllTo(p, true)}
                  disabled={busy}
                  className="w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 disabled:opacity-50"
                >
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: p.color || '#6b7280' }} />
                  <span className="flex-1 truncate text-gray-800">{p.name}</span>
                  <span className="text-[11px] text-gray-400 whitespace-nowrap">{p.level || 'no level'}{periodName(p.periodId) ? ` · ${periodName(p.periodId)}` : ''}</span>
                </button>
              ))}
            </div>

            <div className="p-3 border-t border-gray-200 bg-gray-50">
              <div className="text-xs font-medium text-gray-600 mb-1">Can’t find it? Create a new plan</div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') createAndAdd(); }}
                  placeholder={`New plan name${periodName(sourcePlan.periodId) ? ` (${sourcePlan.level || 'no level'} · ${periodName(sourcePlan.periodId)})` : ''}`}
                  className="flex-1 text-sm px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={createAndAdd}
                  disabled={busy || !newName.trim()}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {busy ? 'Working…' : 'Create & add'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Inherits this plan’s owner, period and level.</p>
              {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
