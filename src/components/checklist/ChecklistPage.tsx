import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useOKRStore, type OKRStore, type ColumnWidths, type ColumnKey, COLUMN_LABELS, DEFAULT_VISIBLE_COLUMNS } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { CompactObjectiveCard } from '../objectives/CompactObjectiveCard';
import type { Period, PeriodType, Objective, Team, Tag, User, FilterOperator, ObjectiveType, ObjectiveLevel, WorkflowStatus } from '../../types';

const TYPE_OPTIONS: { value: ObjectiveType; label: string }[] = [
  { value: 'initiative', label: 'Initiative' },
  { value: 'saga', label: 'Saga' },
  { value: 'epic', label: 'Epic' },
  { value: 'story', label: 'Story' },
  { value: 'subtask', label: 'SubTask' },
];

const LEVEL_OPTIONS: { value: ObjectiveLevel; label: string }[] = [
  { value: 'company', label: 'Company' },
  { value: 'team', label: 'Team' },
  { value: 'individual', label: 'Individual' },
];

const WORKFLOW_STATUS_OPTIONS: { value: WorkflowStatus; label: string }[] = [
  { value: 'todo', label: 'Todo' },
  { value: 'backlog', label: 'Backlog' },
  { value: 'planning', label: 'Planning' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'acceptance', label: 'Acceptance' },
  { value: 'done', label: 'Done' },
  { value: 'archived', label: 'Archived' },
];

const API_URL = import.meta.env.VITE_API_URL || '';

const CHECKLIST_SECTIONS_KEY = 'okr-checklist-sections';

interface ChecklistSectionsState {
  isNoTypeExpanded: boolean;
  isNoNextStepExpanded: boolean;
  isNoPeriodExpanded: boolean;
  isOverdueEvergreenExpanded: boolean;
  isTypeFilterOn: boolean;
  isNoNextStepFilterOn: boolean;
  isNoPeriodFilterOn: boolean;
  isOverdueEvergreenFilterOn: boolean;
}

const defaultSectionsState: ChecklistSectionsState = {
  isNoTypeExpanded: false,
  isNoNextStepExpanded: false,
  isNoPeriodExpanded: false,
  isOverdueEvergreenExpanded: false,
  isTypeFilterOn: false,
  isNoNextStepFilterOn: false,
  isNoPeriodFilterOn: false,
  isOverdueEvergreenFilterOn: false,
};

function loadSectionsState(): ChecklistSectionsState {
  try {
    const data = localStorage.getItem(CHECKLIST_SECTIONS_KEY);
    if (data) {
      return { ...defaultSectionsState, ...JSON.parse(data) };
    }
  } catch {
    // ignore
  }
  return defaultSectionsState;
}

function saveSectionsState(state: Partial<ChecklistSectionsState>): void {
  try {
    const current = loadSectionsState();
    localStorage.setItem(CHECKLIST_SECTIONS_KEY, JSON.stringify({ ...current, ...state }));
  } catch {
    // ignore
  }
}

const PERIOD_TYPE_BADGES: Record<PeriodType, { label: string; color: string }> = {
  quarter: { label: 'Q', color: 'bg-purple-100 text-purple-700' },
  month: { label: 'M', color: 'bg-blue-100 text-blue-700' },
  week: { label: 'W', color: 'bg-green-100 text-green-700' },
};

interface PeriodFilterButtonProps {
  period: Period;
  periods: Period[];
  activePeriodId: string | null;
  onSelect: (id: string | null) => void;
  depth: number;
}

function PeriodFilterButton({ period, periods, activePeriodId, onSelect, depth }: PeriodFilterButtonProps) {
  const childPeriods = periods.filter((p: Period) => p.parentId === period.id);
  const isActive = activePeriodId === period.id;
  const periodType = period.type || 'quarter';
  const badge = PERIOD_TYPE_BADGES[periodType];

  return (
    <>
      <button
        onClick={() => onSelect(isActive ? null : period.id)}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors ${
          isActive
            ? 'bg-gray-800 text-white'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
        }`}
        style={{ marginLeft: depth > 0 ? `${depth * 6}px` : undefined }}
      >
        <span className={`text-xs font-medium px-1 rounded ${isActive ? 'bg-gray-600' : badge.color}`}>
          {badge.label}
        </span>
        {period.name}
      </button>
      {childPeriods.map((child: Period) => (
        <PeriodFilterButton
          key={child.id}
          period={child}
          periods={periods}
          activePeriodId={activePeriodId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

export function ChecklistPage() {
  // Load initial section states from localStorage (default to collapsed)
  const initialSections = loadSectionsState();
  const [isNoTypeExpanded, setIsNoTypeExpandedState] = useState(initialSections.isNoTypeExpanded);
  const [isNoNextStepExpanded, setIsNoNextStepExpandedState] = useState(initialSections.isNoNextStepExpanded);
  const [isNoPeriodExpanded, setIsNoPeriodExpandedState] = useState(initialSections.isNoPeriodExpanded);
  const [isOverdueEvergreenExpanded, setIsOverdueEvergreenExpandedState] = useState(initialSections.isOverdueEvergreenExpanded);
  const [isTypeFilterOn, setIsTypeFilterOnState] = useState(initialSections.isTypeFilterOn);
  const [isNoNextStepFilterOn, setIsNoNextStepFilterOnState] = useState(initialSections.isNoNextStepFilterOn);
  const [isNoPeriodFilterOn, setIsNoPeriodFilterOnState] = useState(initialSections.isNoPeriodFilterOn);
  const [isOverdueEvergreenFilterOn, setIsOverdueEvergreenFilterOnState] = useState(initialSections.isOverdueEvergreenFilterOn);

  // Wrapper functions that persist state changes
  const setIsNoTypeExpanded = useCallback((expanded: boolean) => {
    setIsNoTypeExpandedState(expanded);
    saveSectionsState({ isNoTypeExpanded: expanded });
  }, []);

  const setIsNoNextStepExpanded = useCallback((expanded: boolean) => {
    setIsNoNextStepExpandedState(expanded);
    saveSectionsState({ isNoNextStepExpanded: expanded });
  }, []);

  const setIsNoPeriodExpanded = useCallback((expanded: boolean) => {
    setIsNoPeriodExpandedState(expanded);
    saveSectionsState({ isNoPeriodExpanded: expanded });
  }, []);

  const setIsOverdueEvergreenExpanded = useCallback((expanded: boolean) => {
    setIsOverdueEvergreenExpandedState(expanded);
    saveSectionsState({ isOverdueEvergreenExpanded: expanded });
  }, []);

  const toggleTypeFilter = useCallback(() => {
    setIsTypeFilterOnState(prev => {
      const next = !prev;
      saveSectionsState({ isTypeFilterOn: next });
      return next;
    });
  }, []);

  const toggleNoNextStepFilter = useCallback(() => {
    setIsNoNextStepFilterOnState(prev => {
      const next = !prev;
      saveSectionsState({ isNoNextStepFilterOn: next });
      return next;
    });
  }, []);

  const toggleNoPeriodFilter = useCallback(() => {
    setIsNoPeriodFilterOnState(prev => {
      const next = !prev;
      saveSectionsState({ isNoPeriodFilterOn: next });
      return next;
    });
  }, []);

  const toggleOverdueEvergreenFilter = useCallback(() => {
    setIsOverdueEvergreenFilterOnState(prev => {
      const next = !prev;
      saveSectionsState({ isOverdueEvergreenFilterOn: next });
      return next;
    });
  }, []);

  const [includeAncestorPeriods, setIncludeAncestorPeriods] = useState(false);
  const [includeChildPeriods, setIncludeChildPeriods] = useState(true);
  const [includeChildTeams, setIncludeChildTeams] = useState(true);
  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [filterWorkflowStatuses, setFilterWorkflowStatuses] = useState<WorkflowStatus[]>([]);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  const { organization, user, isSuperAdmin, isOrgAdmin } = useAuth();
  const orgId = organization?.id || '';
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;

  // Fetch users for owner/assignee filters
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch(`${API_URL}/api/users`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setOrgUsers(data.users || []);
        }
      } catch (err) {
        console.error('Failed to fetch users:', err);
      }
    };
    fetchUsers();
  }, []);

  const objectives = useOKRStore((state: OKRStore) => state.objectives);
  const periods = useOKRStore((state: OKRStore) => state.periods);
  const teams = useOKRStore((state: OKRStore) => state.teams);
  const tags = useOKRStore((state: OKRStore) => state.tags);
  const activePeriodId = useOKRStore((state: OKRStore) => state.activePeriodId);
  const filterTagIds = useOKRStore((state: OKRStore) => state.filterTagIds);
  const filterTeamIds = useOKRStore((state: OKRStore) => state.filterTeamIds);
  const filterOwnerIds = useOKRStore((state: OKRStore) => state.filterOwnerIds);
  const filterOwnerOperator = useOKRStore((state: OKRStore) => state.filterOwnerOperator);
  const filterAssigneeIds = useOKRStore((state: OKRStore) => state.filterAssigneeIds);
  const filterAssigneeOperator = useOKRStore((state: OKRStore) => state.filterAssigneeOperator);
  const setActivePeriod = useOKRStore((state: OKRStore) => state.setActivePeriod);
  const toggleFilterTag = useOKRStore((state: OKRStore) => state.toggleFilterTag);
  const toggleFilterTeam = useOKRStore((state: OKRStore) => state.toggleFilterTeam);
  const filterTypes = useOKRStore((state: OKRStore) => state.filterTypes);
  const filterTypeNotSet = useOKRStore((state: OKRStore) => state.filterTypeNotSet);
  const toggleFilterType = useOKRStore((state: OKRStore) => state.toggleFilterType);
  const toggleFilterTypeNotSet = useOKRStore((state: OKRStore) => state.toggleFilterTypeNotSet);
  const setFilterOwners = useOKRStore((state: OKRStore) => state.setFilterOwners);
  const setFilterOwnerOperator = useOKRStore((state: OKRStore) => state.setFilterOwnerOperator);
  const setFilterAssignees = useOKRStore((state: OKRStore) => state.setFilterAssignees);
  const setFilterAssigneeOperator = useOKRStore((state: OKRStore) => state.setFilterAssigneeOperator);
  const filterLevels = useOKRStore((state: OKRStore) => state.filterLevels);
  const toggleFilterLevel = useOKRStore((state: OKRStore) => state.toggleFilterLevel);
  const clearAllFilters = useOKRStore((state: OKRStore) => state.clearAllFilters);
  const columnWidths = useOKRStore((state: OKRStore) => state.columnWidths);
  const setColumnWidths = useOKRStore((state: OKRStore) => state.setColumnWidths);
  const visibleColumns = useOKRStore((state: OKRStore) => state.visibleColumns);
  const toggleColumnVisibility = useOKRStore((state: OKRStore) => state.toggleColumnVisibility);

  // Toggle workflow status filter
  const toggleWorkflowStatusFilter = useCallback((status: WorkflowStatus) => {
    setFilterWorkflowStatuses(prev =>
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    );
  }, []);

  // Close column menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) {
        setShowColumnMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  // Filter items by organization and visibility
  const orgObjectives = useMemo(
    () => objectives.filter((o: Objective) =>
      (!o.orgId || o.orgId === orgId) && (isAdmin || o.shared !== false || o.createdBy === userEmail)
    ),
    [objectives, orgId, userEmail, isAdmin]
  );
  const orgPeriods = useMemo(
    () => periods.filter((p: Period) =>
      (!p.orgId || p.orgId === orgId) && (isAdmin || p.shared !== false || p.createdBy === userEmail)
    ),
    [periods, orgId, userEmail, isAdmin]
  );
  const orgTeams = useMemo(
    () => teams.filter((t: Team) =>
      (!t.orgId || t.orgId === orgId) && (isAdmin || t.shared !== false || t.createdBy === userEmail)
    ),
    [teams, orgId, userEmail, isAdmin]
  );
  const orgTags = useMemo(
    () => tags.filter((t: Tag) =>
      (!t.orgId || t.orgId === orgId) && (isAdmin || t.shared !== false || t.createdBy === userEmail)
    ),
    [tags, orgId, userEmail, isAdmin]
  );

  const hasActiveFilters = activePeriodId || filterTagIds.length > 0 || filterTeamIds.length > 0 || filterTypes.length > 0 || filterTypeNotSet || filterOwnerIds.length > 0 || filterAssigneeIds.length > 0 || filterLevels.length > 0 || filterWorkflowStatuses.length > 0;

  // Get all ancestor period IDs for a given period
  const getAncestorPeriodIds = useMemo(() => {
    return (periodId: string): string[] => {
      const ids: string[] = [periodId];
      let current = orgPeriods.find((p: Period) => p.id === periodId);
      while (current?.parentId) {
        ids.push(current.parentId);
        current = orgPeriods.find((p: Period) => p.id === current!.parentId);
      }
      return ids;
    };
  }, [orgPeriods]);

  // Get all descendant period IDs for a given period
  const getDescendantPeriodIds = useMemo(() => {
    return (periodId: string): string[] => {
      const ids: string[] = [periodId];
      const findChildren = (parentId: string) => {
        const children = orgPeriods.filter((p: Period) => p.parentId === parentId);
        children.forEach((child: Period) => {
          ids.push(child.id);
          findChildren(child.id);
        });
      };
      findChildren(periodId);
      return ids;
    };
  }, [orgPeriods]);

  // Get all descendant team IDs for a given team
  const getDescendantTeamIds = useMemo(() => {
    return (teamId: string): string[] => {
      const ids: string[] = [teamId];
      const findChildren = (parentId: string) => {
        const children = orgTeams.filter((t: Team) => t.parentId === parentId);
        children.forEach((child: Team) => {
          ids.push(child.id);
          findChildren(child.id);
        });
      };
      findChildren(teamId);
      return ids;
    };
  }, [orgTeams]);

  // Get root periods for hierarchical display
  const rootPeriods = useMemo(() => {
    return orgPeriods.filter((p: Period) => !p.parentId);
  }, [orgPeriods]);

  // Apply all panel filters; downstream sections layer their own predicates on this set.
  const filteredObjectives = useMemo(() => {
    let result = orgObjectives;

    // Filter by period
    if (activePeriodId) {
      let validPeriodIds: string[] = [activePeriodId];
      if (includeAncestorPeriods) {
        validPeriodIds = [...new Set([...validPeriodIds, ...getAncestorPeriodIds(activePeriodId)])];
      }
      if (includeChildPeriods) {
        validPeriodIds = [...new Set([...validPeriodIds, ...getDescendantPeriodIds(activePeriodId)])];
      }
      result = result.filter((obj: Objective) => validPeriodIds.includes(obj.periodId));
    }

    // Filter by teams
    if (filterTeamIds.length > 0) {
      let validTeamIds = [...filterTeamIds];
      if (includeChildTeams) {
        filterTeamIds.forEach(teamId => {
          validTeamIds = [...new Set([...validTeamIds, ...getDescendantTeamIds(teamId)])];
        });
      }
      result = result.filter((obj: Objective) => obj.teamId && validTeamIds.includes(obj.teamId));
    }

    // Filter by tags
    if (filterTagIds.length > 0) {
      result = result.filter((obj: Objective) =>
        obj.tagIds?.some((tagId: string) => filterTagIds.includes(tagId))
      );
    }

    // Filter by type
    if (filterTypes.length > 0 || filterTypeNotSet) {
      result = result.filter((obj: Objective) => {
        const matchesType = filterTypes.length > 0 && obj.type && filterTypes.includes(obj.type);
        const matchesNotSet = filterTypeNotSet && !obj.type;
        return matchesType || matchesNotSet;
      });
    }

    // Filter by level
    if (filterLevels.length > 0) {
      result = result.filter((obj: Objective) =>
        filterLevels.includes(obj.level)
      );
    }

    // Filter by owners
    if (filterOwnerIds.length > 0) {
      if (filterOwnerOperator === 'equals') {
        result = result.filter((obj: Objective) => obj.ownerId && filterOwnerIds.includes(obj.ownerId));
      } else {
        result = result.filter((obj: Objective) => !obj.ownerId || !filterOwnerIds.includes(obj.ownerId));
      }
    }

    // Filter by assignees
    if (filterAssigneeIds.length > 0) {
      if (filterAssigneeOperator === 'equals') {
        result = result.filter((obj: Objective) => obj.assigneeId && filterAssigneeIds.includes(obj.assigneeId));
      } else {
        result = result.filter((obj: Objective) => !obj.assigneeId || !filterAssigneeIds.includes(obj.assigneeId));
      }
    }

    // Filter by workflow status
    if (filterWorkflowStatuses.length > 0) {
      result = result.filter((obj: Objective) =>
        filterWorkflowStatuses.includes(obj.workflowStatus)
      );
    }

    return result;
  }, [orgObjectives, activePeriodId, filterTeamIds, filterTagIds, filterTypes, filterTypeNotSet, filterLevels, filterOwnerIds, filterOwnerOperator, filterAssigneeIds, filterAssigneeOperator, filterWorkflowStatuses, includeAncestorPeriods, includeChildPeriods, includeChildTeams, getAncestorPeriodIds, getDescendantPeriodIds, getDescendantTeamIds]);

  const filteredObjectivesWithoutNextStep = useMemo(() => {
    const source = isNoNextStepFilterOn ? filteredObjectives : orgObjectives;
    return source.filter((obj: Objective) =>
      !obj.nextStepDate &&
      obj.workflowStatus !== 'done' &&
      obj.workflowStatus !== 'archived' &&
      obj.workflowStatus !== 'backlog'
    );
  }, [filteredObjectives, orgObjectives, isNoNextStepFilterOn]);

  const filteredObjectivesWithoutType = useMemo(() => {
    const source = isTypeFilterOn ? filteredObjectives : orgObjectives;
    return source.filter((obj: Objective) => !obj.type);
  }, [filteredObjectives, orgObjectives, isTypeFilterOn]);

  const filteredObjectivesWithoutPeriod = useMemo(() => {
    const validPeriodIds = new Set(orgPeriods.map((p: Period) => p.id));
    const source = isNoPeriodFilterOn ? filteredObjectives : orgObjectives;
    return source.filter((obj: Objective) =>
      !obj.periodId || !validPeriodIds.has(obj.periodId)
    );
  }, [filteredObjectives, orgObjectives, orgPeriods, isNoPeriodFilterOn]);

  const filteredObjectiveIdsNoPeriod = useMemo(
    () => new Set(filteredObjectivesWithoutPeriod.map((obj: Objective) => obj.id)),
    [filteredObjectivesWithoutPeriod]
  );

  const overdueEvergreenObjectives = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const source = isOverdueEvergreenFilterOn ? filteredObjectives : orgObjectives;
    const matched = source.filter((obj: Objective) => {
      if (!obj.nextStepDate) return false;
      if (obj.workflowStatus === 'done' || obj.workflowStatus === 'archived' || obj.workflowStatus === 'backlog') return false;
      const [y, m, d] = obj.nextStepDate.split('-').map(Number);
      return new Date(y, m - 1, d).getTime() < todayMs;
    });
    const matchedIds = new Set(matched.map(o => o.id));
    return matched.filter(o => !o.parentId || !matchedIds.has(o.parentId));
  }, [filteredObjectives, orgObjectives, isOverdueEvergreenFilterOn]);

  const overdueEvergreenIds = useMemo(
    () => new Set(overdueEvergreenObjectives.map((obj: Objective) => obj.id)),
    [overdueEvergreenObjectives]
  );

  // Get IDs for quick lookup
  const filteredObjectiveIdsNoType = useMemo(
    () => new Set(filteredObjectivesWithoutType.map((obj: Objective) => obj.id)),
    [filteredObjectivesWithoutType]
  );

  // Get IDs for quick lookup
  const filteredObjectiveIds = useMemo(
    () => new Set(filteredObjectivesWithoutNextStep.map((obj: Objective) => obj.id)),
    [filteredObjectivesWithoutNextStep]
  );

  const filterPanel = (
    <div className="px-4 py-3 bg-gray-50/50 border-b border-gray-200">
      <div className="flex items-center justify-end mb-2 min-h-[20px]">
        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            Clear all
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        {/* Period Filter */}
        <div className="flex items-start gap-3">
          <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Period</label>
          <div className="flex-1">
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setActivePeriod(null)}
                className={`px-2 py-1 rounded-full text-xs transition-colors ${
                  !activePeriodId
                    ? 'bg-gray-800 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All
              </button>
              {rootPeriods.map((period: Period) => (
                <PeriodFilterButton
                  key={period.id}
                  period={period}
                  periods={orgPeriods}
                  activePeriodId={activePeriodId}
                  onSelect={setActivePeriod}
                  depth={0}
                />
              ))}
            </div>
            {activePeriodId && (
              <div className="flex items-center gap-3 mt-1.5">
                <label className="inline-flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeAncestorPeriods}
                    onChange={(e) => setIncludeAncestorPeriods(e.target.checked)}
                    className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Parent
                </label>
                <label className="inline-flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeChildPeriods}
                    onChange={(e) => setIncludeChildPeriods(e.target.checked)}
                    className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Child
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Team Filter */}
        {orgTeams.length > 0 && (
          <div className="flex items-start gap-3">
            <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Team</label>
            <div className="flex-1">
              <div className="flex flex-wrap gap-1.5">
                {orgTeams.map((team: Team) => (
                  <button
                    key={team.id}
                    onClick={() => toggleFilterTeam(team.id)}
                    className={`px-2 py-1 rounded-full text-xs transition-colors ${
                      filterTeamIds.includes(team.id)
                        ? 'bg-gray-800 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {team.name}
                  </button>
                ))}
              </div>
              {filterTeamIds.length > 0 && (
                <label className="inline-flex items-center gap-1 text-xs text-gray-500 cursor-pointer mt-1.5">
                  <input
                    type="checkbox"
                    checked={includeChildTeams}
                    onChange={(e) => setIncludeChildTeams(e.target.checked)}
                    className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Include child teams
                </label>
              )}
            </div>
          </div>
        )}

        {/* Tag Filter */}
        {orgTags.length > 0 && (
          <div className="flex items-start gap-3">
            <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Tags</label>
            <div className="flex flex-wrap gap-1.5">
              {orgTags.map((tag: Tag) => (
                <button
                  key={tag.id}
                  onClick={() => toggleFilterTag(tag.id)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors ${
                    filterTagIds.includes(tag.id)
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${tag.color}`}></span>
                  {tag.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Type Filter */}
        <div className="flex items-start gap-3">
          <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Type</label>
          <div className="flex flex-wrap gap-1.5">
            {TYPE_OPTIONS.map((type) => (
              <button
                key={type.value}
                onClick={() => toggleFilterType(type.value)}
                className={`px-2 py-1 rounded-full text-xs transition-colors ${
                  filterTypes.includes(type.value)
                    ? 'bg-gray-800 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {type.label}
              </button>
            ))}
            <button
              onClick={() => toggleFilterTypeNotSet()}
              className={`px-2 py-1 rounded-full text-xs transition-colors ${
                filterTypeNotSet
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Not Set
            </button>
          </div>
        </div>

        {/* Level Filter */}
        <div className="flex items-start gap-3">
          <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Level</label>
          <div className="flex flex-wrap gap-1.5">
            {LEVEL_OPTIONS.map((level) => (
              <button
                key={level.value}
                onClick={() => toggleFilterLevel(level.value)}
                className={`px-2 py-1 rounded-full text-xs transition-colors ${
                  filterLevels.includes(level.value)
                    ? 'bg-gray-800 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {level.label}
              </button>
            ))}
          </div>
        </div>

        {/* Status Filter */}
        <div className="flex items-start gap-3">
          <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Status</label>
          <div className="flex flex-wrap gap-1.5">
            {WORKFLOW_STATUS_OPTIONS.map((status) => (
              <button
                key={status.value}
                onClick={() => toggleWorkflowStatusFilter(status.value)}
                className={`px-2 py-1 rounded-full text-xs transition-colors ${
                  filterWorkflowStatuses.includes(status.value)
                    ? 'bg-gray-800 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {status.label}
              </button>
            ))}
          </div>
        </div>

        {/* Owner Filter */}
        {orgUsers.length > 0 && (
          <div className="flex items-start gap-3">
            <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Owner</label>
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={filterOwnerOperator}
                onChange={(e) => setFilterOwnerOperator(e.target.value as FilterOperator)}
                className="px-1.5 py-1 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="equals">=</option>
                <option value="not_equals">!=</option>
              </select>
              {orgUsers.map((u: User) => (
                <button
                  key={u.id}
                  onClick={() => {
                    if (filterOwnerIds.includes(u.id)) {
                      setFilterOwners(filterOwnerIds.filter(id => id !== u.id));
                    } else {
                      setFilterOwners([...filterOwnerIds, u.id]);
                    }
                  }}
                  className={`px-2 py-1 rounded-full text-xs transition-colors ${
                    filterOwnerIds.includes(u.id)
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Assignee Filter */}
        {orgUsers.length > 0 && (
          <div className="flex items-start gap-3">
            <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Assignee</label>
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={filterAssigneeOperator}
                onChange={(e) => setFilterAssigneeOperator(e.target.value as FilterOperator)}
                className="px-1.5 py-1 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="equals">=</option>
                <option value="not_equals">!=</option>
              </select>
              {orgUsers.map((u: User) => (
                <button
                  key={u.id}
                  onClick={() => {
                    if (filterAssigneeIds.includes(u.id)) {
                      setFilterAssignees(filterAssigneeIds.filter(id => id !== u.id));
                    } else {
                      setFilterAssignees([...filterAssigneeIds, u.id]);
                    }
                  }}
                  className={`px-2 py-1 rounded-full text-xs transition-colors ${
                    filterAssigneeIds.includes(u.id)
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Column Visibility Toggle */}
      <div className="flex items-center gap-4">
        <div className="relative" ref={columnMenuRef}>
          <button
            onClick={() => setShowColumnMenu(!showColumnMenu)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50 shadow-sm text-gray-600"
            title="Show/hide columns"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2m0 10V7m6 10V7" />
            </svg>
            <span>Columns</span>
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showColumnMenu && (
            <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-2 min-w-[180px]">
              <div className="px-3 py-1.5 text-xs font-medium text-gray-500 border-b border-gray-100 mb-1">
                Show/Hide Columns
              </div>
              {(DEFAULT_VISIBLE_COLUMNS.filter(c => c !== 'title') as ColumnKey[]).map((col) => (
                <label
                  key={col}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm text-gray-700 normal-case"
                >
                  <input
                    type="checkbox"
                    checked={visibleColumns.includes(col)}
                    onChange={() => toggleColumnVisibility(col)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  {COLUMN_LABELS[col]}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>


      {/* Items without Type Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsNoTypeExpanded(!isNoTypeExpanded)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsNoTypeExpanded(!isNoTypeExpanded); } }}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${isNoTypeExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); toggleTypeFilter(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleTypeFilter(); } }}
              title={isTypeFilterOn ? 'Filters on' : 'Filters off'}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
                isTypeFilterOn ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </span>
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Items without Type
              </h3>
              <p className="text-xs text-gray-500">
                {filteredObjectivesWithoutType.length} {filteredObjectivesWithoutType.length === 1 ? 'item' : 'items'} need attention
              </p>
            </div>
          </div>
          <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
            filteredObjectivesWithoutType.length > 0
              ? 'bg-amber-100 text-amber-700'
              : 'bg-green-100 text-green-700'
          }`}>
            {filteredObjectivesWithoutType.length}
          </span>
        </div>

        {isNoTypeExpanded && (
          <div className="border-t border-gray-200">
            {isTypeFilterOn && filterPanel}
            {filteredObjectivesWithoutType.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <svg className="mx-auto h-10 w-10 text-green-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm">
                  {hasActiveFilters
                    ? 'No matching objectives without a type!'
                    : 'All objectives have a type defined!'}
                </p>
              </div>
            ) : (
              <div className={`overflow-hidden ${resizingColumn ? 'select-none' : ''}`}>
                {/* Table header */}
                <div className="flex items-center bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div className="px-2 py-2 flex-shrink-0" style={{ width: columnWidths.title, minWidth: 150 }}>Objective</div>
                  {visibleColumns.includes('level') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.level }}>
                      <div className="px-1 py-2 flex-1">Level</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('level', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('type') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.type }}>
                      <div className="px-1 py-2 flex-1">Type</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('type', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('workflowStatus') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.workflowStatus }}>
                      <div className="px-1 py-2 flex-1">Status</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('workflowStatus', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('parent') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.parent }}>
                      <div className="px-1 py-2 flex-1">Parent</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('parent', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('team') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.team }}>
                      <div className="px-1 py-2 flex-1">Team</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('team', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('owner') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.owner }}>
                      <div className="px-1 py-2 flex-1">Owner</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('owner', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('assignee') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.assignee }}>
                      <div className="px-1 py-2 flex-1">Assignee</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('assignee', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('period') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.period }}>
                      <div className="px-1 py-2 flex-1">Period</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('period', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('nextStepDate') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.nextStepDate }}>
                      <div className="px-1 py-2 flex-1">Next Date</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('nextStepDate', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('nextStep') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.nextStep }}>
                      <div className="px-1 py-2 flex-1">Next Step</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('nextStep', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('storyPoints') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.storyPoints }}>
                      <div className="px-1 py-2 flex-1 text-right">SP</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('storyPoints', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('valuePoints') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.valuePoints }}>
                      <div className="px-1 py-2 flex-1 text-right">VP</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('valuePoints', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('tags') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.tags }}>
                      <div className="px-1 py-2 flex-1">Tags</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('tags', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('progress') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.progress }}>
                      <div className="px-2 py-2 flex-1 text-right">Progress</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('progress', e)}
                      />
                    </div>
                  )}
                  <div className="w-16 px-2 py-2"></div>
                </div>

                {/* Table body */}
                <div>
                  {filteredObjectivesWithoutType.map((obj: Objective) => (
                    <CompactObjectiveCard
                      key={obj.id}
                      objective={obj}
                      depth={0}
                      filteredObjectiveIds={filteredObjectiveIdsNoType}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Items without Next Step Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsNoNextStepExpanded(!isNoNextStepExpanded)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsNoNextStepExpanded(!isNoNextStepExpanded); } }}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${isNoNextStepExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); toggleNoNextStepFilter(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleNoNextStepFilter(); } }}
              title={isNoNextStepFilterOn ? 'Filters on' : 'Filters off'}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
                isNoNextStepFilterOn ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </span>
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Items without Next Step
              </h3>
              <p className="text-xs text-gray-500">
                {filteredObjectivesWithoutNextStep.length} {filteredObjectivesWithoutNextStep.length === 1 ? 'item' : 'items'} need attention
              </p>
            </div>
          </div>
          <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
            filteredObjectivesWithoutNextStep.length > 0
              ? 'bg-amber-100 text-amber-700'
              : 'bg-green-100 text-green-700'
          }`}>
            {filteredObjectivesWithoutNextStep.length}
          </span>
        </div>

        {isNoNextStepExpanded && (
          <div className="border-t border-gray-200">
            {isNoNextStepFilterOn && filterPanel}
            <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 text-xs text-amber-800">
              To remove an item from this list, do one of the following:
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                <li>Set a <span className="font-medium">Next Date</span> on it</li>
                <li>Mark its status as <span className="font-medium">Done</span>, <span className="font-medium">Archived</span>, or <span className="font-medium">In Backlog</span></li>
              </ul>
            </div>
            {filteredObjectivesWithoutNextStep.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <svg className="mx-auto h-10 w-10 text-green-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm">
                  {hasActiveFilters
                    ? 'No matching objectives without a next step!'
                    : 'All objectives have a next step defined!'}
                </p>
              </div>
            ) : (
              <div className={`overflow-hidden ${resizingColumn ? 'select-none' : ''}`}>
                {/* Table header */}
                <div className="flex items-center bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div className="px-2 py-2 flex-shrink-0" style={{ width: columnWidths.title, minWidth: 150 }}>Objective</div>
                  {visibleColumns.includes('level') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.level }}>
                      <div className="px-1 py-2 flex-1">Level</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('level', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('type') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.type }}>
                      <div className="px-1 py-2 flex-1">Type</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('type', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('workflowStatus') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.workflowStatus }}>
                      <div className="px-1 py-2 flex-1">Status</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('workflowStatus', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('parent') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.parent }}>
                      <div className="px-1 py-2 flex-1">Parent</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('parent', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('team') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.team }}>
                      <div className="px-1 py-2 flex-1">Team</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('team', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('owner') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.owner }}>
                      <div className="px-1 py-2 flex-1">Owner</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('owner', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('assignee') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.assignee }}>
                      <div className="px-1 py-2 flex-1">Assignee</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('assignee', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('period') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.period }}>
                      <div className="px-1 py-2 flex-1">Period</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('period', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('nextStepDate') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.nextStepDate }}>
                      <div className="px-1 py-2 flex-1">Next Date</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('nextStepDate', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('nextStep') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.nextStep }}>
                      <div className="px-1 py-2 flex-1">Next Step</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('nextStep', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('storyPoints') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.storyPoints }}>
                      <div className="px-1 py-2 flex-1 text-right">SP</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('storyPoints', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('valuePoints') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.valuePoints }}>
                      <div className="px-1 py-2 flex-1 text-right">VP</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('valuePoints', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('tags') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.tags }}>
                      <div className="px-1 py-2 flex-1">Tags</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('tags', e)}
                      />
                    </div>
                  )}
                  {visibleColumns.includes('progress') && (
                    <div className="relative flex items-center" style={{ width: columnWidths.progress }}>
                      <div className="px-2 py-2 flex-1 text-right">Progress</div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                        onMouseDown={(e) => handleResizeStart('progress', e)}
                      />
                    </div>
                  )}
                  <div className="w-16 px-2 py-2"></div>
                </div>

                {/* Table body - flat list since these are filtered items */}
                <div>
                  {filteredObjectivesWithoutNextStep.map((obj: Objective) => (
                    <CompactObjectiveCard
                      key={obj.id}
                      objective={obj}
                      depth={0}
                      filteredObjectiveIds={filteredObjectiveIds}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Items without Period Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsNoPeriodExpanded(!isNoPeriodExpanded)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsNoPeriodExpanded(!isNoPeriodExpanded); } }}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${isNoPeriodExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); toggleNoPeriodFilter(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleNoPeriodFilter(); } }}
              title={isNoPeriodFilterOn ? 'Filters on' : 'Filters off'}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
                isNoPeriodFilterOn ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </span>
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Items without Period
              </h3>
              <p className="text-xs text-gray-500">
                {filteredObjectivesWithoutPeriod.length} {filteredObjectivesWithoutPeriod.length === 1 ? 'item' : 'items'} need attention
              </p>
            </div>
          </div>
          <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
            filteredObjectivesWithoutPeriod.length > 0
              ? 'bg-amber-100 text-amber-700'
              : 'bg-green-100 text-green-700'
          }`}>
            {filteredObjectivesWithoutPeriod.length}
          </span>
        </div>

        {isNoPeriodExpanded && (
          <div className="border-t border-gray-200">
            {isNoPeriodFilterOn && filterPanel}
            <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 text-xs text-amber-800">
              An item appears here if it has no period set, or if its period no longer exists.
              To remove it from this list, set a valid <span className="font-medium">Period</span> on the objective.
            </div>
            {filteredObjectivesWithoutPeriod.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <svg className="mx-auto h-10 w-10 text-green-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm">All objectives have a valid period assigned!</p>
              </div>
            ) : (
              <div className={`overflow-hidden ${resizingColumn ? 'select-none' : ''}`}>
                <div className="flex items-center bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div className="px-2 py-2 flex-shrink-0" style={{ width: columnWidths.title, minWidth: 150 }}>Objective</div>
                  {visibleColumns.includes('level') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.level }}>Level</div>}
                  {visibleColumns.includes('type') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.type }}>Type</div>}
                  {visibleColumns.includes('workflowStatus') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.workflowStatus }}>Status</div>}
                  {visibleColumns.includes('parent') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.parent }}>Parent</div>}
                  {visibleColumns.includes('team') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.team }}>Team</div>}
                  {visibleColumns.includes('owner') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.owner }}>Owner</div>}
                  {visibleColumns.includes('assignee') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.assignee }}>Assignee</div>}
                  {visibleColumns.includes('period') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.period }}>Period</div>}
                  {visibleColumns.includes('nextStepDate') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.nextStepDate }}>Next Date</div>}
                  {visibleColumns.includes('nextStep') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.nextStep }}>Next Step</div>}
                  {visibleColumns.includes('storyPoints') && <div className="px-1 py-2 flex items-center text-right" style={{ width: columnWidths.storyPoints }}>SP</div>}
                  {visibleColumns.includes('valuePoints') && <div className="px-1 py-2 flex items-center text-right" style={{ width: columnWidths.valuePoints }}>VP</div>}
                  {visibleColumns.includes('tags') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.tags }}>Tags</div>}
                  {visibleColumns.includes('progress') && <div className="px-2 py-2 flex items-center text-right" style={{ width: columnWidths.progress }}>Progress</div>}
                  <div className="w-16 px-2 py-2"></div>
                </div>
                <div>
                  {filteredObjectivesWithoutPeriod.map((obj: Objective) => (
                    <CompactObjectiveCard
                      key={obj.id}
                      objective={obj}
                      depth={0}
                      filteredObjectiveIds={filteredObjectiveIdsNoPeriod}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Evergreen items with next date in the past */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsOverdueEvergreenExpanded(!isOverdueEvergreenExpanded)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsOverdueEvergreenExpanded(!isOverdueEvergreenExpanded); } }}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${isOverdueEvergreenExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); toggleOverdueEvergreenFilter(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleOverdueEvergreenFilter(); } }}
              title={isOverdueEvergreenFilterOn ? 'Filters on' : 'Filters off'}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
                isOverdueEvergreenFilterOn ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </span>
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Evergreen items with next date in the past
              </h3>
              <p className="text-xs text-gray-500">
                {overdueEvergreenObjectives.length} {overdueEvergreenObjectives.length === 1 ? 'item' : 'items'} overdue
              </p>
            </div>
          </div>
          <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
            overdueEvergreenObjectives.length > 0
              ? 'bg-amber-100 text-amber-700'
              : 'bg-green-100 text-green-700'
          }`}>
            {overdueEvergreenObjectives.length}
          </span>
        </div>

        {isOverdueEvergreenExpanded && (
          <div className="border-t border-gray-200">
            {isOverdueEvergreenFilterOn && filterPanel}
            <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 text-xs text-amber-800">
              These open items have a Next Date that's already passed. To clear an item from this list,
              update its <span className="font-medium">Next Date</span>, mark it as
              <span className="font-medium"> Done</span>, <span className="font-medium">Archived</span>,
              or move it to <span className="font-medium">In Backlog</span>.
            </div>
            {overdueEvergreenObjectives.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <svg className="mx-auto h-10 w-10 text-green-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm">No open items have a past Next Date — nice!</p>
              </div>
            ) : (
              <div className={`overflow-hidden ${resizingColumn ? 'select-none' : ''}`}>
                <div className="flex items-center bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div className="px-2 py-2 flex-shrink-0" style={{ width: columnWidths.title, minWidth: 150 }}>Objective</div>
                  {visibleColumns.includes('level') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.level }}>Level</div>}
                  {visibleColumns.includes('type') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.type }}>Type</div>}
                  {visibleColumns.includes('workflowStatus') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.workflowStatus }}>Status</div>}
                  {visibleColumns.includes('parent') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.parent }}>Parent</div>}
                  {visibleColumns.includes('team') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.team }}>Team</div>}
                  {visibleColumns.includes('owner') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.owner }}>Owner</div>}
                  {visibleColumns.includes('assignee') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.assignee }}>Assignee</div>}
                  {visibleColumns.includes('period') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.period }}>Period</div>}
                  {visibleColumns.includes('nextStepDate') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.nextStepDate }}>Next Date</div>}
                  {visibleColumns.includes('nextStep') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.nextStep }}>Next Step</div>}
                  {visibleColumns.includes('storyPoints') && <div className="px-1 py-2 flex items-center text-right" style={{ width: columnWidths.storyPoints }}>SP</div>}
                  {visibleColumns.includes('valuePoints') && <div className="px-1 py-2 flex items-center text-right" style={{ width: columnWidths.valuePoints }}>VP</div>}
                  {visibleColumns.includes('tags') && <div className="px-1 py-2 flex items-center" style={{ width: columnWidths.tags }}>Tags</div>}
                  {visibleColumns.includes('progress') && <div className="px-2 py-2 flex items-center text-right" style={{ width: columnWidths.progress }}>Progress</div>}
                  <div className="w-16 px-2 py-2"></div>
                </div>
                <div>
                  {overdueEvergreenObjectives.map((obj: Objective) => (
                    <CompactObjectiveCard
                      key={obj.id}
                      objective={obj}
                      depth={0}
                      filteredObjectiveIds={overdueEvergreenIds}
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
