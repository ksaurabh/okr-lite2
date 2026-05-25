import { useEffect, useMemo, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { CompactObjectiveCard } from '../objectives/CompactObjectiveCard';
import type { Objective, User } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';

type View = 'dashboard' | 'objectives' | 'plans' | 'planbuilder' | 'views' | 'checklist' | 'progress' | 'updates' | 'lists' | 'logwork' | 'teams' | 'periods' | 'tags' | 'settings' | 'admin' | 'logs';

interface PlanBuilderPageProps {
  onViewChange: (view: View) => void;
}

export function PlanBuilderPage({ onViewChange }: PlanBuilderPageProps) {
  const lists = useOKRStore((s: OKRStore) => s.lists);
  const objectives = useOKRStore((s: OKRStore) => s.objectives);
  const planFocusListId = useOKRStore((s: OKRStore) => s.planFocusListId);
  const setPlanFocusListId = useOKRStore((s: OKRStore) => s.setPlanFocusListId);
  const renameList = useOKRStore((s: OKRStore) => s.renameList);
  const setListOwner = useOKRStore((s: OKRStore) => s.setListOwner);

  const plan = useMemo(() => lists.find(l => l.id === planFocusListId) || null, [lists, planFocusListId]);

  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');
  const [hideDoneArchived, setHideDoneArchived] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/api/users`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { users: [] })
      .then(d => setOrgUsers(d.users || []))
      .catch(err => console.error('Failed to fetch users:', err));
  }, []);

  useEffect(() => {
    if (plan?.ownerId) setSelectedOwnerId(plan.ownerId);
  }, [plan?.ownerId]);

  const handleOwnerPick = async (ownerId: string) => {
    setSelectedOwnerId(ownerId);
    if (plan && ownerId) await setListOwner(plan.id, ownerId);
  };

  const isDoneOrArchived = (o: Objective) => o.workflowStatus === 'done' || o.workflowStatus === 'archived';
  const ownedObjectives = useMemo(
    () => {
      if (!selectedOwnerId) return [];
      return objectives.filter(o => o.ownerId === selectedOwnerId && (!hideDoneArchived || !isDoneOrArchived(o)));
    },
    [objectives, selectedOwnerId, hideDoneArchived]
  );
  const assignedObjectives = useMemo(
    () => {
      if (!selectedOwnerId) return [];
      return objectives.filter(o => o.assigneeId === selectedOwnerId && o.ownerId !== selectedOwnerId && (!hideDoneArchived || !isDoneOrArchived(o)));
    },
    [objectives, selectedOwnerId, hideDoneArchived]
  );

  // For each matched objective, also include its direct children so they show in the tree
  const buildIncludedIds = (matched: Objective[]): Set<string> => {
    const ids = new Set<string>();
    for (const o of matched) ids.add(o.id);
    for (const o of matched) {
      objectives.filter(c => c.parentId === o.id && (!hideDoneArchived || !isDoneOrArchived(c))).forEach(c => ids.add(c.id));
    }
    return ids;
  };

  const ownedIncludedIds = useMemo(() => buildIncludedIds(ownedObjectives), [ownedObjectives, objectives]);
  const assignedIncludedIds = useMemo(() => buildIncludedIds(assignedObjectives), [assignedObjectives, objectives]);

  const ownerUser = orgUsers.find(u => u.id === selectedOwnerId);
  const ownerLabel = ownerUser ? (ownerUser.name || ownerUser.email) : '';

  if (!plan) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">
        No plan selected.{' '}
        <button onClick={() => onViewChange('plans')} className="text-blue-600 hover:underline">Back to Plans</button>
      </div>
    );
  }

  const renderTree = (matched: Objective[], includedIds: Set<string>) => {
    const rootObjectives = matched.filter(o => {
      let cur: Objective | undefined = o;
      while (cur?.parentId) {
        const parent: Objective | undefined = objectives.find(p => p.id === cur!.parentId);
        if (parent && matched.some(m => m.id === parent.id)) return false;
        cur = parent;
      }
      return true;
    });
    if (rootObjectives.length === 0) {
      return <div className="p-4 text-xs text-gray-400 italic">No matching objectives.</div>;
    }
    return rootObjectives.map(o => (
      <CompactObjectiveCard
        key={o.id}
        objective={o}
        depth={0}
        filteredObjectiveIds={includedIds}
      />
    ));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 border-b border-gray-200 bg-white">
        <div>
          <button
            onClick={() => { setPlanFocusListId(null); onViewChange('plans'); }}
            className="text-xs text-blue-600 hover:text-blue-700 mb-2"
          >
            ← Back to Plans
          </button>
        </div>
        {editingName ? (
          <input
            type="text"
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={async () => {
              const n = nameDraft.trim();
              if (n && n !== plan.name) await renameList(plan.id, n);
              setEditingName(false);
            }}
            onKeyDown={async (e) => {
              if (e.key === 'Enter') {
                const n = nameDraft.trim();
                if (n && n !== plan.name) await renameList(plan.id, n);
                setEditingName(false);
              } else if (e.key === 'Escape') {
                setEditingName(false);
              }
            }}
            className="text-2xl font-semibold text-gray-900 border border-gray-300 rounded px-2 py-1 w-full max-w-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        ) : (
          <h1
            onClick={() => { setNameDraft(plan.name); setEditingName(true); }}
            className="text-2xl font-semibold text-gray-900 cursor-text hover:bg-gray-50 px-2 py-1 -mx-2 rounded inline-block"
            title="Click to rename"
          >
            {plan.name}
          </h1>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="border-r border-gray-200 bg-white p-4 overflow-y-auto" style={{ width: '30%' }}>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Step 1 — Pick the owner</h2>
          <p className="text-xs text-gray-500 mb-3">Who is this plan for? Their objectives will populate the right panel.</p>
          <select
            value={selectedOwnerId}
            onChange={(e) => handleOwnerPick(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
          >
            <option value="">— Pick an owner —</option>
            {[...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </select>
          {selectedOwnerId && (
            <div className="mt-3 text-xs text-gray-500">
              Owner set to <span className="font-medium text-gray-700">{ownerLabel}</span>.
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-gray-200">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Step 2 — Hide Done / Archived?</h2>
            <div className="inline-flex border border-gray-300 rounded overflow-hidden">
              <button
                onClick={() => setHideDoneArchived(true)}
                className={`px-3 py-1 text-xs ${hideDoneArchived ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Yes
              </button>
              <button
                onClick={() => setHideDoneArchived(false)}
                className={`px-3 py-1 text-xs border-l border-gray-300 ${!hideDoneArchived ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                No
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">{hideDoneArchived ? 'Done and Archived items are hidden from the trees on the right.' : 'All items are shown.'}</p>
          </div>
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto bg-gray-50">
          {!selectedOwnerId ? (
            <div className="p-8 text-center text-sm text-gray-400">Pick an owner on the left to see their objectives.</div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                  <span className="text-xs font-semibold text-gray-700">Objectives owned by {ownerLabel} ({ownedObjectives.length})</span>
                </div>
                <div>{renderTree(ownedObjectives, ownedIncludedIds)}</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                  <span className="text-xs font-semibold text-gray-700">Objectives assigned to {ownerLabel} ({assignedObjectives.length})</span>
                </div>
                <div>{renderTree(assignedObjectives, assignedIncludedIds)}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
