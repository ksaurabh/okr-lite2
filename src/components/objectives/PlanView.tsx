import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useOKRStore, type OKRStore, type ColumnKey, type ColumnWidths, COLUMN_LABELS } from '../../store/okrStore';
import { CompactObjectiveCard } from './CompactObjectiveCard';
import { LEVEL_OPTIONS, WORKFLOW_STATUS_OPTIONS } from '../../utils/objectiveFilters';
import type { Objective, ObjectiveLevel, Period, User, WorkflowStatus } from '../../types';

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

  const [ownerId, setOwnerId] = useState<string>('');
  const [periodId, setPeriodId] = useState<string>('');
  const [level, setLevel] = useState<ObjectiveLevel | ''>('');
  const [statuses, setStatuses] = useState<WorkflowStatus[]>([]);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);

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

  const filtered = useMemo(() => {
    return orgObjectives.filter((o: Objective) => {
      if (ownerId && o.ownerId !== ownerId) return false;
      if (periodId && o.periodId !== periodId) return false;
      if (level && o.level !== level) return false;
      if (statuses.length > 0 && !statuses.includes(o.workflowStatus)) return false;
      return true;
    });
  }, [orgObjectives, ownerId, periodId, level, statuses]);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 h-full flex flex-col min-w-0">
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
        <div className="flex-1" />
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
              {filtered.map((o: Objective) => (
                <CompactObjectiveCard
                  key={o.id}
                  objective={o}
                  depth={0}
                  visibleColumnsOverride={planViewColumns}
                  defaultCollapsed
                  groupPeriodsByDate
                  hideRowActions
                  filteredObjectiveIds={NO_CHILDREN}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
