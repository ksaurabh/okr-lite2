import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOKRStore, type OKRStore, type ColumnKey, COLUMN_LABELS } from '../../store/okrStore';
import { CompactObjectiveCard } from '../objectives/CompactObjectiveCard';
import type { Objective, ObjectiveLevel, Period, User } from '../../types';

const LEVELS: ObjectiveLevel[] = ['company', 'team', 'individual'];
const LEVEL_LABEL: Record<ObjectiveLevel, string> = { company: 'Company', team: 'Team', individual: 'Individual' };

const API_URL = import.meta.env.VITE_API_URL || '';

type View = 'dashboard' | 'objectives' | 'plans' | 'planbuilder' | 'views' | 'checklist' | 'progress' | 'updates' | 'lists' | 'logwork' | 'teams' | 'periods' | 'tags' | 'settings' | 'admin' | 'logs';

interface PlanBuilderPageProps {
  onViewChange: (view: View) => void;
}

export function PlanBuilderPage({ onViewChange }: PlanBuilderPageProps) {
  const lists = useOKRStore((s: OKRStore) => s.lists);
  const objectives = useOKRStore((s: OKRStore) => s.objectives);
  const periods = useOKRStore((s: OKRStore) => s.periods);
  const planFocusListId = useOKRStore((s: OKRStore) => s.planFocusListId);
  const setPlanFocusListId = useOKRStore((s: OKRStore) => s.setPlanFocusListId);
  const renameList = useOKRStore((s: OKRStore) => s.renameList);
  const setListOwner = useOKRStore((s: OKRStore) => s.setListOwner);
  const setListPeriod = useOKRStore((s: OKRStore) => s.setListPeriod);
  const setListLevel = useOKRStore((s: OKRStore) => s.setListLevel);
  const removeItemFromList = useOKRStore((s: OKRStore) => s.removeItemFromList);
  const visibleColumns = useOKRStore((s: OKRStore) => s.visibleColumns);
  const columnWidths = useOKRStore((s: OKRStore) => s.columnWidths);
  const setColumnWidths = useOKRStore((s: OKRStore) => s.setColumnWidths);
  const [resizingCol, setResizingCol] = useState<ColumnKey | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const handleColResizeStart = useCallback((col: ColumnKey, e: React.MouseEvent) => {
    e.preventDefault();
    setResizingCol(col);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = columnWidths[col];
  }, [columnWidths]);
  useEffect(() => {
    if (!resizingCol) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      const newWidth = Math.max(48, resizeStartWidth.current + delta);
      setColumnWidths({ [resizingCol]: newWidth });
    };
    const onUp = () => setResizingCol(null);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [resizingCol, setColumnWidths]);
  const renderColumnHeader = () => (
    <div className="flex items-center bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
      <div className="relative flex items-center px-2 py-2 flex-shrink-0" style={{ width: columnWidths.title, minWidth: 150 }}>
        <div className="flex-1">{COLUMN_LABELS.title}</div>
        <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleColResizeStart('title', e)} />
      </div>
      {(Object.keys(COLUMN_LABELS) as ColumnKey[])
        .filter(col => col !== 'title' && visibleColumns.includes(col))
        .map(col => (
          <div key={col} className="relative flex items-center" style={{ width: columnWidths[col] }}>
            <div className="px-1 py-2 flex-1">{COLUMN_LABELS[col]}</div>
            <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleColResizeStart(col, e)} />
          </div>
        ))}
    </div>
  );

  const plan = useMemo(() => lists.find(l => l.id === planFocusListId) || null, [lists, planFocusListId]);

  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<ObjectiveLevel | ''>('');
  const [hideDoneArchived, setHideDoneArchived] = useState(true);
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    try {
      const v = localStorage.getItem('okr-plan-builder-left-width');
      const n = v ? parseFloat(v) : NaN;
      return Number.isFinite(n) && n >= 10 && n <= 60 ? n : 20;
    } catch { return 20; }
  });
  const [rightWidth, setRightWidth] = useState<number>(() => {
    try {
      const v = localStorage.getItem('okr-plan-builder-right-width');
      const n = v ? parseFloat(v) : NaN;
      return Number.isFinite(n) && n >= 15 && n <= 60 ? n : 30;
    } catch { return 30; }
  });
  const splitRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<'left' | 'right' | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      if (draggingRef.current === 'left') {
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        const clamped = Math.max(10, Math.min(100 - rightWidth - 10, pct));
        setLeftWidth(clamped);
      } else {
        const pct = ((rect.right - e.clientX) / rect.width) * 100;
        const clamped = Math.max(15, Math.min(100 - leftWidth - 10, pct));
        setRightWidth(clamped);
      }
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem('okr-plan-builder-left-width', String(Math.round(leftWidth * 10) / 10));
        localStorage.setItem('okr-plan-builder-right-width', String(Math.round(rightWidth * 10) / 10));
      } catch { /* ignore */ }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [leftWidth, rightWidth]);

  useEffect(() => {
    fetch(`${API_URL}/api/users`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { users: [] })
      .then(d => setOrgUsers(d.users || []))
      .catch(err => console.error('Failed to fetch users:', err));
  }, []);

  useEffect(() => {
    if (plan?.ownerId) setSelectedOwnerId(plan.ownerId);
    if (plan?.periodId) setSelectedPeriodId(plan.periodId);
    if (plan?.level) setSelectedLevel(plan.level);
  }, [plan?.ownerId, plan?.periodId, plan?.level]);

  const handleOwnerPick = async (ownerId: string) => {
    setSelectedOwnerId(ownerId);
    if (plan && ownerId) await setListOwner(plan.id, ownerId);
  };
  const handlePeriodPick = async (periodId: string) => {
    setSelectedPeriodId(periodId);
    if (plan) await setListPeriod(plan.id, periodId);
  };
  const handleLevelPick = async (level: ObjectiveLevel | '') => {
    setSelectedLevel(level);
    if (plan) await setListLevel(plan.id, level);
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
        quickAddToListId={plan.id}
        alwaysShowQuickAdd
        quickAddTooltip="Add to Plan"
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

      <div ref={splitRef} className="flex flex-1 min-h-0 relative">
        <div className="bg-white p-4 overflow-y-auto" style={{ width: `${leftWidth}%` }}>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Step 1 — Plan details</h2>
          <p className="text-xs text-gray-500 mb-3">Fill in the basics for this plan. The name is editable in the title above.</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
              <input
                type="text"
                value={plan.name}
                onClick={() => { setNameDraft(plan.name); setEditingName(true); }}
                readOnly
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-gray-50 cursor-text"
                title="Click the title above to rename"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Owner *</label>
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
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Period *</label>
              <select
                value={selectedPeriodId}
                onChange={(e) => handlePeriodPick(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
              >
                <option value="">— Pick a period —</option>
                {[...periods].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((p: Period) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Level</label>
              <select
                value={selectedLevel}
                onChange={(e) => handleLevelPick(e.target.value as ObjectiveLevel | '')}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
              >
                <option value="">— Optional —</option>
                {LEVELS.map(lv => <option key={lv} value={lv}>{LEVEL_LABEL[lv]}</option>)}
              </select>
            </div>
          </div>
          {selectedOwnerId && (
            <div className="mt-3 text-xs text-gray-500">
              Owner: <span className="font-medium text-gray-700">{ownerLabel}</span>
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

        <div
          onMouseDown={() => {
            draggingRef.current = 'left';
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
          className="w-1 cursor-col-resize bg-gray-200 hover:bg-blue-400 active:bg-blue-500 flex-shrink-0"
          title="Drag to resize"
        />
        <div className="min-w-0 overflow-y-auto bg-gray-50" style={{ width: `${100 - leftWidth - rightWidth}%` }}>
          {!selectedOwnerId ? (
            <div className="p-8 text-center text-sm text-gray-400">Pick an owner on the left to see their objectives.</div>
          ) : (
            <div className={`p-4 space-y-4 ${resizingCol ? 'select-none' : ''}`}>
              <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
                <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                  <span className="text-xs font-semibold text-gray-700">Objectives owned by {ownerLabel} ({ownedObjectives.length})</span>
                </div>
                <div className="min-w-max">
                  {renderColumnHeader()}
                  <div>{renderTree(ownedObjectives, ownedIncludedIds)}</div>
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
                <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                  <span className="text-xs font-semibold text-gray-700">Objectives assigned to {ownerLabel} ({assignedObjectives.length})</span>
                </div>
                <div className="min-w-max">
                  {renderColumnHeader()}
                  <div>{renderTree(assignedObjectives, assignedIncludedIds)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div
          onMouseDown={() => {
            draggingRef.current = 'right';
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
          className="w-1 cursor-col-resize bg-gray-200 hover:bg-blue-400 active:bg-blue-500 flex-shrink-0"
          title="Drag to resize"
        />
        <div className="overflow-y-auto bg-white border-l border-gray-200" style={{ width: `${rightWidth}%` }}>
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: plan.color || '#6b7280' }} />
            <span className="text-xs font-semibold text-gray-700 truncate flex-1">Plan items ({plan.items.length})</span>
          </div>
          {plan.items.length === 0 ? (
            <div className="p-4 text-xs text-gray-400 italic">No items yet. Click the + button on any objective on the left to add it to this plan.</div>
          ) : (
            <div>
              {[...plan.items].sort((a, b) => a.order - b.order).map(item => {
                const obj = objectives.find(o => o.id === item.objectiveId);
                if (!obj) return null;
                return (
                  <div key={item.objectiveId} className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-800 border-b border-gray-100 hover:bg-gray-50">
                    <span className="flex-1 truncate" title={obj.title}>{obj.title}</span>
                    <button
                      onClick={() => removeItemFromList(plan.id, obj.id)}
                      className="p-0.5 text-gray-400 hover:text-red-600 rounded flex-shrink-0"
                      title="Remove from plan"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
