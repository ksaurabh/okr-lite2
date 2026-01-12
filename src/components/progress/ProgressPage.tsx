import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useOKRStore, type OKRStore, type ColumnWidths } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { CompactObjectiveCard } from '../objectives/CompactObjectiveCard';
import type { Objective } from '../../types';

// Helper to get start of last week (7 days ago at midnight)
function getLastWeekStart(): Date {
  const now = new Date();
  const lastWeek = new Date(now);
  lastWeek.setDate(now.getDate() - 7);
  lastWeek.setHours(0, 0, 0, 0);
  return lastWeek;
}

// Check if a date is within the last week
function isWithinLastWeek(dateString: string): boolean {
  const date = new Date(dateString);
  const lastWeekStart = getLastWeekStart();
  return date >= lastWeekStart;
}

// Get relevant changes from history entries within the last week
interface ProgressChange {
  objective: Objective;
  changeType: 'completed' | 'progress_increased' | 'created';
  timestamp: string;
  details: string;
  userEmail: string;
}

function getProgressChanges(objectives: Objective[]): ProgressChange[] {
  const changes: ProgressChange[] = [];

  for (const obj of objectives) {
    // Check if objective was created last week
    if (isWithinLastWeek(obj.createdAt)) {
      changes.push({
        objective: obj,
        changeType: 'created',
        timestamp: obj.createdAt,
        details: 'Created',
        userEmail: obj.createdBy,
      });
    }

    // Check history for workflow status changes to 'done' or progress increases
    for (const entry of obj.history || []) {
      if (!isWithinLastWeek(entry.timestamp)) continue;

      for (const change of entry.changes) {
        // Check for completion (workflowStatus changed to 'done')
        if (change.field === 'workflowStatus' && change.newValue === 'done') {
          changes.push({
            objective: obj,
            changeType: 'completed',
            timestamp: entry.timestamp,
            details: `Marked as done`,
            userEmail: entry.userEmail,
          });
        }

        // Check for progress increases
        if (change.field === 'progress') {
          const oldVal = typeof change.oldValue === 'number' ? change.oldValue : 0;
          const newVal = typeof change.newValue === 'number' ? change.newValue : 0;
          if (newVal > oldVal) {
            changes.push({
              objective: obj,
              changeType: 'progress_increased',
              timestamp: entry.timestamp,
              details: `Progress: ${oldVal}% → ${newVal}%`,
              userEmail: entry.userEmail,
            });
          }
        }
      }
    }
  }

  // Sort by timestamp, most recent first
  changes.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return changes;
}

const PROGRESS_SECTIONS_KEY = 'okr-progress-sections';

interface ProgressSectionsState {
  isCompletedExpanded: boolean;
  isProgressExpanded: boolean;
  isCreatedExpanded: boolean;
}

const defaultSectionsState: ProgressSectionsState = {
  isCompletedExpanded: true,
  isProgressExpanded: false,
  isCreatedExpanded: false,
};

function loadSectionsState(): ProgressSectionsState {
  try {
    const data = localStorage.getItem(PROGRESS_SECTIONS_KEY);
    if (data) {
      return { ...defaultSectionsState, ...JSON.parse(data) };
    }
  } catch {
    // ignore
  }
  return defaultSectionsState;
}

function saveSectionsState(state: Partial<ProgressSectionsState>): void {
  try {
    const current = loadSectionsState();
    localStorage.setItem(PROGRESS_SECTIONS_KEY, JSON.stringify({ ...current, ...state }));
  } catch {
    // ignore
  }
}

export function ProgressPage() {
  const initialSections = loadSectionsState();
  const [isCompletedExpanded, setIsCompletedExpandedState] = useState(initialSections.isCompletedExpanded);
  const [isProgressExpanded, setIsProgressExpandedState] = useState(initialSections.isProgressExpanded);
  const [isCreatedExpanded, setIsCreatedExpandedState] = useState(initialSections.isCreatedExpanded);

  const setIsCompletedExpanded = useCallback((expanded: boolean) => {
    setIsCompletedExpandedState(expanded);
    saveSectionsState({ isCompletedExpanded: expanded });
  }, []);

  const setIsProgressExpanded = useCallback((expanded: boolean) => {
    setIsProgressExpandedState(expanded);
    saveSectionsState({ isProgressExpanded: expanded });
  }, []);

  const setIsCreatedExpanded = useCallback((expanded: boolean) => {
    setIsCreatedExpandedState(expanded);
    saveSectionsState({ isCreatedExpanded: expanded });
  }, []);

  const { organization, user, isSuperAdmin, isOrgAdmin } = useAuth();
  const orgId = organization?.id || '';
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;

  const objectives = useOKRStore((state: OKRStore) => state.objectives);
  const columnWidths = useOKRStore((state: OKRStore) => state.columnWidths);
  const setColumnWidths = useOKRStore((state: OKRStore) => state.setColumnWidths);

  // Column resize state
  const [resizingColumn, setResizingColumn] = useState<keyof ColumnWidths | null>(null);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(0);

  const handleResizeStart = useCallback((column: keyof ColumnWidths, e: React.MouseEvent) => {
    e.preventDefault();
    setResizingColumn(column);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = columnWidths[column];
  }, [columnWidths]);

  useEffect(() => {
    if (!resizingColumn) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      const newWidth = Math.max(48, resizeStartWidth.current + delta);
      setColumnWidths({ [resizingColumn]: newWidth });
    };

    const handleMouseUp = () => {
      setResizingColumn(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn, setColumnWidths]);

  // Filter objectives by organization and visibility
  const orgObjectives = useMemo(
    () => objectives.filter((o: Objective) =>
      (!o.orgId || o.orgId === orgId) && (isAdmin || o.shared !== false || o.createdBy === userEmail)
    ),
    [objectives, orgId, userEmail, isAdmin]
  );

  // Get all progress changes from last week
  const allChanges = useMemo(() => getProgressChanges(orgObjectives), [orgObjectives]);

  // Separate changes by type
  const completedChanges = useMemo(
    () => allChanges.filter(c => c.changeType === 'completed'),
    [allChanges]
  );

  const progressChanges = useMemo(
    () => allChanges.filter(c => c.changeType === 'progress_increased'),
    [allChanges]
  );

  const createdChanges = useMemo(
    () => allChanges.filter(c => c.changeType === 'created'),
    [allChanges]
  );

  // Get unique objectives for each section (to avoid duplicate rows)
  const completedObjectives = useMemo(() => {
    const seen = new Set<string>();
    return completedChanges
      .filter(c => {
        if (seen.has(c.objective.id)) return false;
        seen.add(c.objective.id);
        return true;
      })
      .map(c => c.objective);
  }, [completedChanges]);

  const progressObjectives = useMemo(() => {
    const seen = new Set<string>();
    return progressChanges
      .filter(c => {
        if (seen.has(c.objective.id)) return false;
        seen.add(c.objective.id);
        return true;
      })
      .map(c => c.objective);
  }, [progressChanges]);

  const createdObjectives = useMemo(() => {
    const seen = new Set<string>();
    return createdChanges
      .filter(c => {
        if (seen.has(c.objective.id)) return false;
        seen.add(c.objective.id);
        return true;
      })
      .map(c => c.objective);
  }, [createdChanges]);

  // For filtering in CompactObjectiveCard
  const completedIds = useMemo(() => new Set(completedObjectives.map(o => o.id)), [completedObjectives]);
  const progressIds = useMemo(() => new Set(progressObjectives.map(o => o.id)), [progressObjectives]);
  const createdIds = useMemo(() => new Set(createdObjectives.map(o => o.id)), [createdObjectives]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const renderTableHeader = () => (
    <div className="flex items-center bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
      <div className="flex-1 px-2 py-2">Objective</div>
      <div className="relative flex items-center" style={{ width: columnWidths.level }}>
        <div className="px-1 py-2 flex-1">Level</div>
        <div
          className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
          onMouseDown={(e) => handleResizeStart('level', e)}
        />
      </div>
      <div className="relative flex items-center" style={{ width: columnWidths.type }}>
        <div className="px-1 py-2 flex-1">Type</div>
        <div
          className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
          onMouseDown={(e) => handleResizeStart('type', e)}
        />
      </div>
      <div className="relative flex items-center" style={{ width: columnWidths.parent }}>
        <div className="px-1 py-2 flex-1">Parent</div>
        <div
          className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
          onMouseDown={(e) => handleResizeStart('parent', e)}
        />
      </div>
      <div className="relative flex items-center" style={{ width: columnWidths.team }}>
        <div className="px-1 py-2 flex-1">Team</div>
        <div
          className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
          onMouseDown={(e) => handleResizeStart('team', e)}
        />
      </div>
      <div className="relative flex items-center" style={{ width: columnWidths.owner }}>
        <div className="px-1 py-2 flex-1">Owner</div>
        <div
          className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
          onMouseDown={(e) => handleResizeStart('owner', e)}
        />
      </div>
      <div className="relative flex items-center" style={{ width: columnWidths.assignee }}>
        <div className="px-1 py-2 flex-1">Assignee</div>
        <div
          className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
          onMouseDown={(e) => handleResizeStart('assignee', e)}
        />
      </div>
      <div className="relative flex items-center" style={{ width: columnWidths.period }}>
        <div className="px-1 py-2 flex-1">Period</div>
        <div
          className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
          onMouseDown={(e) => handleResizeStart('period', e)}
        />
      </div>
      <div className="relative flex items-center" style={{ width: columnWidths.nextStepDate }}>
        <div className="px-1 py-2 flex-1">Next Date</div>
        <div
          className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
          onMouseDown={(e) => handleResizeStart('nextStepDate', e)}
        />
      </div>
      <div className="relative flex items-center" style={{ width: columnWidths.nextStep }}>
        <div className="px-1 py-2 flex-1">Next Step</div>
        <div
          className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
          onMouseDown={(e) => handleResizeStart('nextStep', e)}
        />
      </div>
      <div className="relative flex items-center" style={{ width: columnWidths.storyPoints }}>
        <div className="px-1 py-2 flex-1 text-right">SP</div>
        <div
          className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
          onMouseDown={(e) => handleResizeStart('storyPoints', e)}
        />
      </div>
      <div className="relative flex items-center" style={{ width: columnWidths.valuePoints }}>
        <div className="px-1 py-2 flex-1 text-right">VP</div>
        <div
          className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
          onMouseDown={(e) => handleResizeStart('valuePoints', e)}
        />
      </div>
      <div className="relative flex items-center" style={{ width: columnWidths.tags }}>
        <div className="px-1 py-2 flex-1">Tags</div>
        <div
          className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
          onMouseDown={(e) => handleResizeStart('tags', e)}
        />
      </div>
      <div className="relative flex items-center" style={{ width: columnWidths.progress }}>
        <div className="px-2 py-2 flex-1 text-right">Progress</div>
        <div
          className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
          onMouseDown={(e) => handleResizeStart('progress', e)}
        />
      </div>
      <div className="w-16 px-2 py-2"></div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h2 className="text-lg font-semibold text-gray-900">Progress - Last 7 Days</h2>
        <p className="text-sm text-gray-500 mt-1">
          Summary of what got done since {formatDate(getLastWeekStart().toISOString())}
        </p>
      </div>

      {/* Completed Items Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <button
          onClick={() => setIsCompletedExpanded(!isCompletedExpanded)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
        >
          <div className="flex items-center gap-3">
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${isCompletedExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Completed
              </h3>
              <p className="text-xs text-gray-500">
                {completedObjectives.length} {completedObjectives.length === 1 ? 'item' : 'items'} marked as done
              </p>
            </div>
          </div>
          <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
            completedObjectives.length > 0
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-500'
          }`}>
            {completedObjectives.length}
          </span>
        </button>

        {isCompletedExpanded && (
          <div className="border-t border-gray-200">
            {completedObjectives.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <svg className="mx-auto h-10 w-10 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                <p className="text-sm">No items completed this week</p>
              </div>
            ) : (
              <div className={`overflow-hidden ${resizingColumn ? 'select-none' : ''}`}>
                {renderTableHeader()}
                <div>
                  {completedObjectives.map((obj: Objective) => (
                    <CompactObjectiveCard
                      key={obj.id}
                      objective={obj}
                      depth={0}
                      filteredObjectiveIds={completedIds}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Progress Increased Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <button
          onClick={() => setIsProgressExpanded(!isProgressExpanded)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
        >
          <div className="flex items-center gap-3">
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${isProgressExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Progress Updated
              </h3>
              <p className="text-xs text-gray-500">
                {progressObjectives.length} {progressObjectives.length === 1 ? 'item' : 'items'} with progress changes
              </p>
            </div>
          </div>
          <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
            progressObjectives.length > 0
              ? 'bg-blue-100 text-blue-700'
              : 'bg-gray-100 text-gray-500'
          }`}>
            {progressObjectives.length}
          </span>
        </button>

        {isProgressExpanded && (
          <div className="border-t border-gray-200">
            {progressObjectives.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <svg className="mx-auto h-10 w-10 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                <p className="text-sm">No progress updates this week</p>
              </div>
            ) : (
              <div className={`overflow-hidden ${resizingColumn ? 'select-none' : ''}`}>
                {renderTableHeader()}
                <div>
                  {progressObjectives.map((obj: Objective) => (
                    <CompactObjectiveCard
                      key={obj.id}
                      objective={obj}
                      depth={0}
                      filteredObjectiveIds={progressIds}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Created Items Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <button
          onClick={() => setIsCreatedExpanded(!isCreatedExpanded)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
        >
          <div className="flex items-center gap-3">
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${isCreatedExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Newly Created
              </h3>
              <p className="text-xs text-gray-500">
                {createdObjectives.length} {createdObjectives.length === 1 ? 'item' : 'items'} created
              </p>
            </div>
          </div>
          <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
            createdObjectives.length > 0
              ? 'bg-purple-100 text-purple-700'
              : 'bg-gray-100 text-gray-500'
          }`}>
            {createdObjectives.length}
          </span>
        </button>

        {isCreatedExpanded && (
          <div className="border-t border-gray-200">
            {createdObjectives.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <svg className="mx-auto h-10 w-10 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <p className="text-sm">No items created this week</p>
              </div>
            ) : (
              <div className={`overflow-hidden ${resizingColumn ? 'select-none' : ''}`}>
                {renderTableHeader()}
                <div>
                  {createdObjectives.map((obj: Objective) => (
                    <CompactObjectiveCard
                      key={obj.id}
                      objective={obj}
                      depth={0}
                      filteredObjectiveIds={createdIds}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
