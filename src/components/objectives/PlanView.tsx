import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useOKRStore, type OKRStore, type ColumnKey, type ColumnWidths, COLUMN_LABELS } from '../../store/okrStore';
import { CompactObjectiveCard } from './CompactObjectiveCard';
import { LEVEL_OPTIONS, WORKFLOW_STATUS_OPTIONS, TYPE_OPTIONS } from '../../utils/objectiveFilters';
import type { Objective, ObjectiveLevel, ObjectiveType, Period, User, WorkflowStatus } from '../../types';

interface PlanViewProps {
  orgObjectives: Objective[];
  orgPeriods: Period[];
  orgUsers: User[];
}

const NO_CHILDREN: Set<string> = new Set();

export function PlanView({ orgObjectives, orgPeriods, orgUsers }: PlanViewProps) {
  const planViewColumns = useOKRStore((s: OKRStore) => s.planViewColumns);
  const togglePlanViewColumn = useOKRStore((s: OKRStore) => s.togglePlanViewColumn);
  const columnWidths = useOKRStore((s: OKRStore) => s.columnWidths);
  const setColumnWidths = useOKRStore((s: OKRStore) => s.setColumnWidths);
  const planFilters = useOKRStore((s: OKRStore) => s.planFilters);
  const setPlanFilters = useOKRStore((s: OKRStore) => s.setPlanFilters);
  const addPlan = useOKRStore((s: OKRStore) => s.addPlan);
  const activePlanId = useOKRStore((s: OKRStore) => s.activePlanId);
  const plans = useOKRStore((s: OKRStore) => s.plans);
  const applyPlan = useOKRStore((s: OKRStore) => s.applyPlan);

  const ownerId = planFilters.ownerId;
  const periodId = planFilters.periodId;
  const level = planFilters.level;
  const statuses = planFilters.statuses;
  const types = planFilters.types || [];
  const setOwnerId = (v: string) => setPlanFilters({ ...planFilters, ownerId: v });
  const setPeriodId = (v: string) => setPlanFilters({ ...planFilters, periodId: v });
  const setLevel = (v: ObjectiveLevel | '') => setPlanFilters({ ...planFilters, level: v });
  const setStatuses = (v: WorkflowStatus[]) => setPlanFilters({ ...planFilters, statuses: v });
  const setTypes = (v: ObjectiveType[]) => setPlanFilters({ ...planFilters, types: v });

  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const typeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showTypeMenu) return;
    const onClick = (e: MouseEvent) => {
      if (typeMenuRef.current && !typeMenuRef.current.contains(e.target as Node)) {
        setShowTypeMenu(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showTypeMenu]);
  const [showSavePlan, setShowSavePlan] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');

  const activePlan = plans.find(p => p.id === activePlanId) || null;

  useEffect(() => {
    if (!showStatusMenu) return;
    const onClick = (e: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setShowStatusMenu(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showStatusMenu]);

  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setShowColumnMenu(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const [resizingColumn, setResizingColumn] = useState<keyof ColumnWidths | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  const handleResizeStart = useCallback((column: keyof ColumnWidths, e: React.MouseEvent) => {
    e.preventDefault();
    setResizingColumn(column);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = columnWidths[column];
  }, [columnWidths]);

  useEffect(() => {
    if (!resizingColumn) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      const newWidth = Math.max(48, resizeStartWidth.current + delta);
      setColumnWidths({ [resizingColumn]: newWidth });
    };
    const onUp = () => setResizingColumn(null);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [resizingColumn, setColumnWidths]);

  const { activePeriods, inactivePeriods } = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const active: Period[] = [];
    const inactive: Period[] = [];
    for (const p of orgPeriods) {
      if ((p.endDate || '') >= today) active.push(p);
      else inactive.push(p);
    }
    const sortByName = (a: Period, b: Period) => a.name.localeCompare(b.name);
    return { activePeriods: active.sort(sortByName), inactivePeriods: inactive.sort(sortByName) };
  }, [orgPeriods]);

  const reorderPlanItems = useOKRStore((s: OKRStore) => s.reorderPlanItems);
  const togglePlanReplacement = useOKRStore((s: OKRStore) => s.togglePlanReplacement);
  const updatePlanFilters = useOKRStore((s: OKRStore) => s.updatePlanFilters);
  const lastSelectedPlanId = useOKRStore((s: OKRStore) => s.lastSelectedPlanId);
  const setHighlightObjectiveId = useOKRStore((s: OKRStore) => s.setHighlightObjectiveId);
  const setForcedExpandedIds = useOKRStore((s: OKRStore) => s.setForcedExpandedIds);
  const [menuObjectiveId, setMenuObjectiveId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuObjectiveId) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuObjectiveId(null);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuObjectiveId]);

  const filtered = useMemo<{ objective: Objective; replacedBy: Objective | null }[]>(() => {
    const matched = orgObjectives.filter((o: Objective) => {
      if (ownerId && o.ownerId !== ownerId) return false;
      if (periodId && o.periodId !== periodId) return false;
      if (level && o.level !== level) return false;
      if (statuses.length > 0 && !statuses.includes(o.workflowStatus)) return false;
      if (types.length > 0 && (!o.type || !types.includes(o.type))) return false;
      return true;
    });
    const replacements = new Set(activePlan?.replacements || []);
    const matchedById = new Map(matched.map(o => [o.id, o]));
    const seen = new Map<string, Objective | null>(); // id -> replacedBy parent (or null)
    matched.forEach((o: Objective) => {
      if (replacements.has(o.id)) {
        const children = orgObjectives.filter(c => c.parentId === o.id);
        children.forEach(c => {
          if (!seen.has(c.id)) seen.set(c.id, matchedById.has(c.id) ? null : o);
        });
      } else {
        if (!seen.has(o.id)) seen.set(o.id, null);
      }
    });
    const ranks = activePlan?.ranks || {};
    const all = Array.from(seen.entries()).map(([id, replacedBy]) => {
      const objective = orgObjectives.find(o => o.id === id);
      return objective ? { objective, replacedBy } : null;
    }).filter((x): x is { objective: Objective; replacedBy: Objective | null } => x !== null);
    return all.sort((a, b) => {
      const ra = ranks[a.objective.id] ?? Number.MAX_SAFE_INTEGER;
      const rb = ranks[b.objective.id] ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.objective.title.localeCompare(b.objective.title);
    });
  }, [orgObjectives, ownerId, periodId, level, statuses, types, activePlan]);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 h-full flex flex-col min-w-0 relative">
      <div className="flex flex-wrap items-center gap-2 p-2 border-b border-gray-200">
        <select
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          className="px-2 py-1 text-xs border border-gray-200 rounded bg-white"
        >
          <option value="">Any owner</option>
          {orgUsers.map((u) => (
            <option key={u.id} value={u.id}>{u.name || u.email}</option>
          ))}
        </select>
        <select
          value={periodId}
          onChange={(e) => setPeriodId(e.target.value)}
          className="px-2 py-1 text-xs border border-gray-200 rounded bg-white"
        >
          <option value="">Any period</option>
          {activePeriods.length > 0 && (
            <optgroup label="Active">
              {activePeriods.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          )}
          {inactivePeriods.length > 0 && (
            <optgroup label="Inactive">
              {inactivePeriods.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          )}
        </select>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as ObjectiveLevel | '')}
          className="px-2 py-1 text-xs border border-gray-200 rounded bg-white"
        >
          <option value="">Any level</option>
          {LEVEL_OPTIONS.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
        <div ref={statusMenuRef} className="relative">
          <button
            onClick={() => setShowStatusMenu(!showStatusMenu)}
            className="px-2 py-1 text-xs border border-gray-200 rounded bg-white hover:bg-gray-50"
          >
            {statuses.length === 0 ? 'Any status' : `Status (${statuses.length})`}
          </button>
          {showStatusMenu && (
            <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[180px]">
              {WORKFLOW_STATUS_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={statuses.includes(opt.value)}
                    onChange={() => setStatuses(
                      statuses.includes(opt.value)
                        ? statuses.filter(s => s !== opt.value)
                        : [...statuses, opt.value]
                    )}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  {opt.label}
                </label>
              ))}
              {statuses.length > 0 && (
                <button
                  onClick={() => setStatuses([])}
                  className="w-full text-left px-3 py-1.5 text-xs text-blue-600 hover:bg-gray-50 border-t border-gray-100 mt-1"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
        <div ref={typeMenuRef} className="relative">
          <button
            onClick={() => setShowTypeMenu(!showTypeMenu)}
            className="px-2 py-1 text-xs border border-gray-200 rounded bg-white hover:bg-gray-50"
          >
            {types.length === 0 ? 'Any type' : `Type (${types.length})`}
          </button>
          {showTypeMenu && (
            <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[180px]">
              {TYPE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={types.includes(opt.value)}
                    onChange={() => setTypes(
                      types.includes(opt.value)
                        ? types.filter(t => t !== opt.value)
                        : [...types, opt.value]
                    )}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  {opt.label}
                </label>
              ))}
              {types.length > 0 && (
                <button
                  onClick={() => setTypes([])}
                  className="w-full text-left px-3 py-1.5 text-xs text-blue-600 hover:bg-gray-50 border-t border-gray-100 mt-1"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex-1" />
        {plans.length > 0 && (
          <select
            value={activePlanId || ''}
            onChange={(e) => {
              if (e.target.value) applyPlan(e.target.value);
            }}
            className="px-2 py-1 text-xs border border-gray-200 rounded bg-white"
            title="Open another plan"
          >
            <option value="">{activePlan ? activePlan.name : '— Pick a plan —'}</option>
            {plans.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => { setNewPlanName(activePlan?.name || ''); setShowSavePlan(true); }}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
          title="Save current filters as a Plan"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          Save as Plan
        </button>
        <div ref={columnMenuRef} className="relative">
          <button
            onClick={() => setShowColumnMenu(!showColumnMenu)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
            title="Choose columns"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            Columns
          </button>
          {showColumnMenu && (
            <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[180px]">
              {(Object.keys(COLUMN_LABELS) as ColumnKey[])
                .filter((c) => c !== 'title')
                .map((col) => (
                  <label key={col} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={planViewColumns.includes(col)}
                      onChange={() => togglePlanViewColumn(col)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    {COLUMN_LABELS[col]}
                  </label>
                ))}
            </div>
          )}
        </div>
      </div>
      <div className={`overflow-x-auto flex-1 ${resizingColumn ? 'select-none' : ''}`}>
        <div className="min-w-max">
          <div className="flex items-center bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
            <div className="relative flex items-center px-2 py-2 flex-shrink-0" style={{ width: columnWidths.title, minWidth: 150 }}>
              <div className="flex-1">Objective ({filtered.length})</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('title', e)} />
            </div>
            {planViewColumns.includes('level') && (
              <div className="relative flex items-center" style={{ width: columnWidths.level }}>
                <div className="px-1 py-2 flex-1">Level</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('level', e)} />
              </div>
            )}
            {planViewColumns.includes('type') && (
              <div className="relative flex items-center" style={{ width: columnWidths.type }}>
                <div className="px-1 py-2 flex-1">Type</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('type', e)} />
              </div>
            )}
            {planViewColumns.includes('workflowStatus') && (
              <div className="relative flex items-center" style={{ width: columnWidths.workflowStatus }}>
                <div className="px-1 py-2 flex-1">Status</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('workflowStatus', e)} />
              </div>
            )}
            {planViewColumns.includes('keyResult') && (
              <div className="relative flex items-center" style={{ width: columnWidths.keyResult }}>
                <div className="px-1 py-2 flex-1">KR</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('keyResult', e)} />
              </div>
            )}
            {planViewColumns.includes('parent') && (
              <div className="relative flex items-center" style={{ width: columnWidths.parent }}>
                <div className="px-1 py-2 flex-1">Parent</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('parent', e)} />
              </div>
            )}
            {planViewColumns.includes('team') && (
              <div className="relative flex items-center" style={{ width: columnWidths.team }}>
                <div className="px-1 py-2 flex-1">Team</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('team', e)} />
              </div>
            )}
            {planViewColumns.includes('owner') && (
              <div className="relative flex items-center" style={{ width: columnWidths.owner }}>
                <div className="px-1 py-2 flex-1">Owner</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('owner', e)} />
              </div>
            )}
            {planViewColumns.includes('assignee') && (
              <div className="relative flex items-center" style={{ width: columnWidths.assignee }}>
                <div className="px-1 py-2 flex-1">Assignee</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('assignee', e)} />
              </div>
            )}
            {planViewColumns.includes('period') && (
              <div className="relative flex items-center" style={{ width: columnWidths.period }}>
                <div className="px-1 py-2 flex-1">Period</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('period', e)} />
              </div>
            )}
            {planViewColumns.includes('nextStepDate') && (
              <div className="relative flex items-center" style={{ width: columnWidths.nextStepDate }}>
                <div className="px-1 py-2 flex-1">Next Date</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('nextStepDate', e)} />
              </div>
            )}
            {planViewColumns.includes('nextStep') && (
              <div className="relative flex items-center" style={{ width: columnWidths.nextStep }}>
                <div className="px-1 py-2 flex-1">Next Step</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('nextStep', e)} />
              </div>
            )}
            {planViewColumns.includes('storyPoints') && (
              <div className="relative flex items-center" style={{ width: columnWidths.storyPoints }}>
                <div className="px-1 py-2 flex-1 text-right">SP</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('storyPoints', e)} />
              </div>
            )}
            {planViewColumns.includes('valuePoints') && (
              <div className="relative flex items-center" style={{ width: columnWidths.valuePoints }}>
                <div className="px-1 py-2 flex-1 text-right">VP</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('valuePoints', e)} />
              </div>
            )}
            {planViewColumns.includes('tags') && (
              <div className="relative flex items-center" style={{ width: columnWidths.tags }}>
                <div className="px-1 py-2 flex-1">Tags</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('tags', e)} />
              </div>
            )}
            {planViewColumns.includes('progress') && (
              <div className="relative flex items-center" style={{ width: columnWidths.progress }}>
                <div className="px-2 py-2 flex-1 text-right">Progress</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('progress', e)} />
              </div>
            )}
            {planViewColumns.includes('resolved') && (
              <div className="relative flex items-center" style={{ width: columnWidths.resolved }}>
                <div className="px-1 py-2 flex-1">Resolved</div>
                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('resolved', e)} />
              </div>
            )}
          </div>
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No matching objectives.</div>
          ) : (
            <div>
              {filtered.map(({ objective: o, replacedBy }) => {
                const isReplaced = activePlan?.replacements?.includes(o.id) ?? false;
                return (
                <div
                  key={o.id}
                  onDragOver={(e) => { if (activePlan) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
                  onDrop={(e) => {
                    if (!activePlan) return;
                    e.preventDefault();
                    const draggedId = e.dataTransfer.getData('text/plain');
                    if (!draggedId || draggedId === o.id) return;
                    const ids = filtered.map(x => x.objective.id).filter(id => id !== draggedId);
                    const targetIdx = ids.indexOf(o.id);
                    ids.splice(targetIdx, 0, draggedId);
                    reorderPlanItems(activePlan.id, ids);
                  }}
                  className="group relative flex items-stretch hover:bg-gray-50/40"
                >
                  {activePlan && (
                    <div
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', o.id); e.dataTransfer.effectAllowed = 'move'; }}
                      className="flex-shrink-0 flex items-center justify-center w-4 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-600 border-r border-gray-100"
                      title="Drag to reorder"
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="9" cy="6" r="1.5" />
                        <circle cx="9" cy="12" r="1.5" />
                        <circle cx="9" cy="18" r="1.5" />
                        <circle cx="15" cy="6" r="1.5" />
                        <circle cx="15" cy="12" r="1.5" />
                        <circle cx="15" cy="18" r="1.5" />
                      </svg>
                    </div>
                  )}
                  {replacedBy && (
                    <span
                      className="flex-shrink-0 flex items-center justify-center w-4 text-blue-500 text-sm font-bold"
                      title={`Shown because "${replacedBy.title}" was replaced with its children`}
                    >
                      *
                    </span>
                  )}
                  {activePlan && (
                    <div className="flex-shrink-0 flex items-center pl-1 pr-1 relative">
                      <button
                        onClick={() => setMenuObjectiveId(menuObjectiveId === o.id ? null : o.id)}
                        className="p-1 text-gray-400 hover:text-gray-700 rounded-full hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Row actions"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <circle cx="5" cy="12" r="2" />
                          <circle cx="12" cy="12" r="2" />
                          <circle cx="19" cy="12" r="2" />
                        </svg>
                      </button>
                      {menuObjectiveId === o.id && (
                        <div ref={menuRef} className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[220px]">
                          <button
                            onClick={() => {
                              if (activePlan) togglePlanReplacement(activePlan.id, o.id);
                              setMenuObjectiveId(null);
                            }}
                            className="w-full text-left text-xs px-3 py-1.5 hover:bg-gray-50 text-gray-700"
                          >
                            {isReplaced ? 'Stop replacing with children' : 'Replace with children'}
                          </button>
                          {replacedBy && (
                            <button
                              onClick={() => {
                                if (activePlan) togglePlanReplacement(activePlan.id, replacedBy.id);
                                setMenuObjectiveId(null);
                              }}
                              className="w-full text-left text-xs px-3 py-1.5 hover:bg-gray-50 text-gray-700"
                              title={`Restore "${replacedBy.title}" as a single row`}
                            >
                              Replace with parent ({replacedBy.title})
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <CompactObjectiveCard
                      objective={o}
                      depth={0}
                      visibleColumnsOverride={planViewColumns}
                      defaultCollapsed
                      groupPeriodsByDate
                      hideRowActions
                      onTitleClick={(obj) => {
                        const byId = new Map(orgObjectives.map(x => [x.id, x]));
                        const ancestors: string[] = [];
                        let cur = byId.get(obj.parentId || '');
                        while (cur) {
                          ancestors.push(cur.id);
                          cur = byId.get(cur.parentId || '');
                        }
                        setForcedExpandedIds(ancestors);
                        setHighlightObjectiveId(obj.id);
                      }}
                      filteredObjectiveIds={NO_CHILDREN}
                    />
                  </div>
                </div>
              );})}
            </div>
          )}
        </div>
      </div>
      {showSavePlan && (() => {
        const ownerName = ownerId ? (orgUsers.find(u => u.id === ownerId)?.name || orgUsers.find(u => u.id === ownerId)?.email || ownerId) : 'Any owner';
        const periodName = periodId ? (orgPeriods.find(p => p.id === periodId)?.name || periodId) : 'Any period';
        const levelLabel = level ? (LEVEL_OPTIONS.find(l => l.value === level)?.label || level) : 'Any level';
        const statusLabels = statuses.length === 0
          ? 'Any status'
          : statuses.map(s => WORKFLOW_STATUS_OPTIONS.find(o => o.value === s)?.label || s).join(', ');
        const typeLabels = types.length === 0
          ? 'Any type'
          : types.map(t => TYPE_OPTIONS.find(o => o.value === t)?.label || t).join(', ');
        return (
          <div
            className="absolute right-2 top-12 z-40 bg-white border border-gray-200 rounded-lg shadow-xl w-80 p-4"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Save as Plan</h3>
            <div className="text-xs text-gray-600 mb-3 space-y-0.5 bg-gray-50 rounded p-2 border border-gray-100">
              <div><span className="text-gray-400">Owner:</span> <span className="text-gray-700">{ownerName}</span></div>
              <div><span className="text-gray-400">Period:</span> <span className="text-gray-700">{periodName}</span></div>
              <div><span className="text-gray-400">Level:</span> <span className="text-gray-700">{levelLabel}</span></div>
              <div><span className="text-gray-400">Status:</span> <span className="text-gray-700">{statusLabels}</span></div>
              <div><span className="text-gray-400">Type:</span> <span className="text-gray-700">{typeLabels}</span></div>
            </div>
            {(() => {
              const referencePlanId = activePlanId || lastSelectedPlanId;
              const referencePlan = referencePlanId ? plans.find(p => p.id === referencePlanId) : null;
              const filtersDirty = referencePlan
                ? JSON.stringify({ ...referencePlan.filters, types: referencePlan.filters.types || [] })
                  !== JSON.stringify({ ...planFilters, types: planFilters.types || [] })
                : false;
              return referencePlan && (filtersDirty || activePlanId === referencePlanId) ? (
                <button
                  onClick={() => { updatePlanFilters(referencePlan.id); setShowSavePlan(false); }}
                  className="w-full mb-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Update "{referencePlan.name}"
                </button>
              ) : null;
            })()}
            <div className="text-xs text-gray-500 mb-1">Or save as a new plan:</div>
            <input
              type="text"
              value={newPlanName}
              onChange={(e) => setNewPlanName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newPlanName.trim()) {
                  addPlan(newPlanName);
                  setShowSavePlan(false);
                }
                if (e.key === 'Escape') setShowSavePlan(false);
              }}
              placeholder="New plan name"
              autoFocus
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSavePlan(false)}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => { if (newPlanName.trim()) { addPlan(newPlanName); setShowSavePlan(false); } }}
                disabled={!newPlanName.trim()}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Save as new
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
