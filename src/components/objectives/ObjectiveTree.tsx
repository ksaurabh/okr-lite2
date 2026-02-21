import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useOKRStore, type OKRStore, type ColumnWidths, type ColumnKey, COLUMN_LABELS, DEFAULT_VISIBLE_COLUMNS } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { CompactObjectiveCard } from './CompactObjectiveCard';
import type { Period, PeriodType, Objective, Team, Tag, User, FilterOperator, ObjectiveType, NextStepDateFilter, ObjectiveLevel, SavedView, WorkflowStatus, List } from '../../types';

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

const NEXT_STEP_DATE_OPTIONS: { value: NextStepDateFilter; label: string }[] = [
  { value: 'not_set', label: 'Not Set' },
  { value: 'last_7d', label: 'In Last 7d' },
  { value: 'last_30d', label: 'In Last 30d' },
  { value: 'past', label: 'In the Past' },
  { value: 'today', label: 'Today' },
  { value: 'next_7d', label: 'In Next 7d' },
  { value: 'next_30d', label: 'In Next 30d' },
  { value: 'future', label: 'In the Future' },
];

const LAST_UPDATED_OPTIONS: { value: string; label: string; ms: number }[] = [
  { value: '30s', label: 'In last 30 seconds', ms: 30 * 1000 },
  { value: '1m',  label: 'In last 1m',         ms: 60 * 1000 },
  { value: '5m',  label: 'In last 5m',         ms: 5 * 60 * 1000 },
  { value: '30m', label: 'In last 30m',        ms: 30 * 60 * 1000 },
  { value: '1h',  label: 'In last 1h',         ms: 60 * 60 * 1000 },
  { value: '24h', label: 'In the last 24h',    ms: 24 * 60 * 60 * 1000 },
  { value: '1w',  label: 'In the last week',   ms: 7 * 24 * 60 * 60 * 1000 },
];

const WORKFLOW_STATUS_OPTIONS: { value: WorkflowStatus; label: string }[] = [
  { value: 'todo', label: 'To Do' },
  { value: 'planning', label: 'In Planning' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'acceptance', label: 'In Acceptance' },
  { value: 'done', label: 'Done' },
  { value: 'archived', label: 'Archived' },
];

const API_URL = import.meta.env.VITE_API_URL || '';

const FILTER_LAYOUT_KEY = 'okr-filter-layout';

function loadFilterLayout(): 1 | 2 {
  try {
    const data = localStorage.getItem(FILTER_LAYOUT_KEY);
    if (data === '1' || data === '2') {
      return parseInt(data) as 1 | 2;
    }
  } catch {
    // ignore
  }
  return 2; // default to 2 columns
}

function saveFilterLayout(columns: 1 | 2): void {
  try {
    localStorage.setItem(FILTER_LAYOUT_KEY, String(columns));
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
  // Fallback for periods created before type was added
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

interface ObjectiveTreeProps {
  highlightObjectiveId?: string | null;
  onHighlightClear?: () => void;
}

export function ObjectiveTree({ highlightObjectiveId, onHighlightClear }: ObjectiveTreeProps = {}) {
  const [isFilterExpanded, setIsFilterExpanded] = useState(true);
  const [filterColumns, setFilterColumnsState] = useState<1 | 2>(loadFilterLayout);
  const [includeAncestorPeriods, setIncludeAncestorPeriods] = useState(false);
  const [includeChildPeriods, setIncludeChildPeriods] = useState(true);
  const [includeChildTeams, setIncludeChildTeams] = useState(true);
  const [showChildren, setShowChildren] = useState(false);
  const [directChildrenOnly, setDirectChildrenOnly] = useState(false);
  const [openChildrenOnly, setOpenChildrenOnly] = useState(false);
  const [filterLastUpdated, setFilterLastUpdated] = useState<string | null>(null);
  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

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
  const filterPeriodIds = useOKRStore((state: OKRStore) => state.filterPeriodIds);
  const filterTagIds = useOKRStore((state: OKRStore) => state.filterTagIds);
  const filterTeamIds = useOKRStore((state: OKRStore) => state.filterTeamIds);
  const filterOwnerIds = useOKRStore((state: OKRStore) => state.filterOwnerIds);
  const filterOwnerOperator = useOKRStore((state: OKRStore) => state.filterOwnerOperator);
  const filterAssigneeIds = useOKRStore((state: OKRStore) => state.filterAssigneeIds);
  const filterAssigneeOperator = useOKRStore((state: OKRStore) => state.filterAssigneeOperator);
  const toggleFilterPeriod = useOKRStore((state: OKRStore) => state.toggleFilterPeriod);
  const clearFilterPeriods = useOKRStore((state: OKRStore) => state.clearFilterPeriods);
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
  const filterAssigneeNotSet = useOKRStore((state: OKRStore) => state.filterAssigneeNotSet);
  const toggleFilterAssigneeNotSet = useOKRStore((state: OKRStore) => state.toggleFilterAssigneeNotSet);
  const filterNextStepDate = useOKRStore((state: OKRStore) => state.filterNextStepDate);
  const setFilterNextStepDate = useOKRStore((state: OKRStore) => state.setFilterNextStepDate);
  const filterLevels = useOKRStore((state: OKRStore) => state.filterLevels);
  const toggleFilterLevel = useOKRStore((state: OKRStore) => state.toggleFilterLevel);
  const filterWorkflowStatuses = useOKRStore((state: OKRStore) => state.filterWorkflowStatuses);
  const toggleFilterWorkflowStatus = useOKRStore((state: OKRStore) => state.toggleFilterWorkflowStatus);
  const filterKeyResultsOnly = useOKRStore((state: OKRStore) => state.filterKeyResultsOnly);
  const toggleFilterKeyResultsOnly = useOKRStore((state: OKRStore) => state.toggleFilterKeyResultsOnly);
  const filterObjectiveId = useOKRStore((state: OKRStore) => state.filterObjectiveId);
  const setFilterObjective = useOKRStore((state: OKRStore) => state.setFilterObjective);
  const lists = useOKRStore((state: OKRStore) => state.lists);
  const filterListIds = useOKRStore((state: OKRStore) => state.filterListIds);
  const toggleFilterList = useOKRStore((state: OKRStore) => state.toggleFilterList);
  const clearFilterLists = useOKRStore((state: OKRStore) => state.clearFilterLists);
  const clearAllFilters = useOKRStore((state: OKRStore) => state.clearAllFilters);
  const columnWidths = useOKRStore((state: OKRStore) => state.columnWidths);
  const setColumnWidths = useOKRStore((state: OKRStore) => state.setColumnWidths);
  const visibleColumns = useOKRStore((state: OKRStore) => state.visibleColumns);
  const toggleColumnVisibility = useOKRStore((state: OKRStore) => state.toggleColumnVisibility);

  // Saved views
  const savedViews = useOKRStore((state: OKRStore) => state.savedViews);
  const activeViewId = useOKRStore((state: OKRStore) => state.activeViewId);
  const createView = useOKRStore((state: OKRStore) => state.createView);
  const updateView = useOKRStore((state: OKRStore) => state.updateView);
  const deleteView = useOKRStore((state: OKRStore) => state.deleteView);
  const applyView = useOKRStore((state: OKRStore) => state.applyView);
  const setDefaultView = useOKRStore((state: OKRStore) => state.setDefaultView);
  const clearActiveView = useOKRStore((state: OKRStore) => state.clearActiveView);
  const renameView = useOKRStore((state: OKRStore) => state.renameView);

  // Column visibility dropdown state
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const [objectiveSearch, setObjectiveSearch] = useState('');
  const [showObjectiveDropdown, setShowObjectiveDropdown] = useState(false);
  const objectiveDropdownRef = useRef<HTMLDivElement>(null);
  const objectiveSearchRef = useRef<HTMLInputElement>(null);

  // View management state
  const [showViewDropdown, setShowViewDropdown] = useState(false);
  const [showSaveViewDialog, setShowSaveViewDialog] = useState(false);
  const [showManageViewsDialog, setShowManageViewsDialog] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [newViewIsDefault, setNewViewIsDefault] = useState(false);
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [editingViewName, setEditingViewName] = useState('');
  const viewDropdownRef = useRef<HTMLDivElement>(null);

  // List filter dropdown state
  const [showListDropdown, setShowListDropdown] = useState(false);
  const listDropdownRef = useRef<HTMLDivElement>(null);

  // Period / Team / Owner / Assignee dropdown state
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
  const periodDropdownRef = useRef<HTMLDivElement>(null);
  const [showTeamDropdown, setShowTeamDropdown] = useState(false);
  const teamDropdownRef = useRef<HTMLDivElement>(null);
  const [showOwnerDropdown, setShowOwnerDropdown] = useState(false);
  const ownerDropdownRef = useRef<HTMLDivElement>(null);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);

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

  // Close view dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (viewDropdownRef.current && !viewDropdownRef.current.contains(event.target as Node)) {
        setShowViewDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close objective dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (objectiveDropdownRef.current && !objectiveDropdownRef.current.contains(event.target as Node)) {
        setShowObjectiveDropdown(false);
        setObjectiveSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close list dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (listDropdownRef.current && !listDropdownRef.current.contains(event.target as Node)) {
        setShowListDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close period/team/assignee dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (periodDropdownRef.current && !periodDropdownRef.current.contains(event.target as Node)) setShowPeriodDropdown(false);
      if (teamDropdownRef.current && !teamDropdownRef.current.contains(event.target as Node)) setShowTeamDropdown(false);
      if (ownerDropdownRef.current && !ownerDropdownRef.current.contains(event.target as Node)) setShowOwnerDropdown(false);
      if (assigneeDropdownRef.current && !assigneeDropdownRef.current.contains(event.target as Node)) setShowAssigneeDropdown(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll to and flash a highlighted objective
  useEffect(() => {
    if (!highlightObjectiveId) return;
    // Give the tree a moment to render
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-objective-id="${highlightObjectiveId}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'background-color 0.3s';
        el.style.backgroundColor = '#fef08a'; // yellow-200
        setTimeout(() => {
          el.style.backgroundColor = '';
          setTimeout(() => {
            el.style.transition = '';
            onHighlightClear?.();
          }, 600);
        }, 1200);
      } else {
        onHighlightClear?.();
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [highlightObjectiveId, onHighlightClear]);

  // Filter layout toggle
  const toggleFilterColumns = useCallback(() => {
    const newColumns = filterColumns === 2 ? 1 : 2;
    setFilterColumnsState(newColumns);
    saveFilterLayout(newColumns);
  }, [filterColumns]);

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

  // Filter items by organization and visibility (admins see all, others see shared or owned)
  const orgObjectives = useMemo(
    () => objectives.filter((o: Objective) =>
      (!o.orgId || o.orgId === orgId) && (isAdmin || o.shared !== false || o.createdBy === userEmail)
    ),
    [objectives, orgId, userEmail, isAdmin]
  );
  const orgPeriods = useMemo(
    () => periods.filter((p: Period) =>
      (!p.orgId || p.orgId === orgId) && (isAdmin || p.shared !== false || p.createdBy === userEmail) && !p.archived
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

  const hasActiveFilters = filterPeriodIds.length > 0 || filterTagIds.length > 0 || filterTeamIds.length > 0 || filterTypes.length > 0 || filterTypeNotSet || filterOwnerIds.length > 0 || filterAssigneeIds.length > 0 || filterAssigneeNotSet || filterNextStepDate || filterLastUpdated || filterLevels.length > 0 || filterWorkflowStatuses.length > 0 || filterKeyResultsOnly || filterObjectiveId || filterListIds.length > 0 || searchQuery.trim();

  // Get all ancestor period IDs for a given period (including the period itself)
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

  // Get all descendant period IDs for a given period (including the period itself)
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

  // Get all descendant team IDs for a given team (including the team itself)
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

  // Get all descendant objective IDs for a given objective (not including the objective itself)
  const getDescendantObjectiveIds = useMemo(() => {
    return (objectiveId: string): string[] => {
      const ids: string[] = [];
      const findChildren = (parentId: string) => {
        const children = orgObjectives.filter((o: Objective) => o.parentId === parentId);
        children.forEach((child: Objective) => {
          ids.push(child.id);
          findChildren(child.id);
        });
      };
      findChildren(objectiveId);
      return ids;
    };
  }, [orgObjectives]);

  // Get root periods (no parent) for hierarchical display
  const rootPeriods = useMemo(() => {
    return orgPeriods.filter((p: Period) => !p.parentId);
  }, [orgPeriods]);

  // Apply all filters
  const [filteredObjectives, directlyMatchingObjectiveIds] = useMemo(() => {
    let result = orgObjectives;

    // Filter by period (optionally including ancestor and/or child periods)
    if (filterPeriodIds.length > 0) {
      let validPeriodIds: string[] = [...filterPeriodIds];
      if (includeAncestorPeriods) {
        filterPeriodIds.forEach(id => {
          validPeriodIds = [...new Set([...validPeriodIds, ...getAncestorPeriodIds(id)])];
        });
      }
      if (includeChildPeriods) {
        filterPeriodIds.forEach(id => {
          validPeriodIds = [...new Set([...validPeriodIds, ...getDescendantPeriodIds(id)])];
        });
      }
      result = result.filter((obj: Objective) => validPeriodIds.includes(obj.periodId));
    }

    // Filter by teams (optionally including child teams)
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

    // Filter by workflow status
    if (filterWorkflowStatuses.length > 0) {
      // If only active statuses are selected (not done/archived), include items without status set
      const includesOnlyActiveStatuses = !filterWorkflowStatuses.includes('done') && !filterWorkflowStatuses.includes('archived');
      result = result.filter((obj: Objective) => {
        if (!obj.workflowStatus) {
          // Items without status are included if filtering for active statuses only
          return includesOnlyActiveStatuses;
        }
        return filterWorkflowStatuses.includes(obj.workflowStatus);
      });
    }

    // Filter by parent objective (show only descendants)
    if (filterObjectiveId) {
      const descendantIds = new Set(getDescendantObjectiveIds(filterObjectiveId));
      result = result.filter((obj: Objective) => descendantIds.has(obj.id));
    }

    // Filter by owners (with operator support)
    if (filterOwnerIds.length > 0) {
      if (filterOwnerOperator === 'equals') {
        result = result.filter((obj: Objective) => obj.ownerId && filterOwnerIds.includes(obj.ownerId));
      } else {
        // not_equals: show objectives where owner is NOT in the selected list
        result = result.filter((obj: Objective) => !obj.ownerId || !filterOwnerIds.includes(obj.ownerId));
      }
    }

    // Filter by assignees (with operator support and Not Set option)
    if (filterAssigneeIds.length > 0 || filterAssigneeNotSet) {
      if (filterAssigneeOperator === 'equals') {
        result = result.filter((obj: Objective) => {
          const matchesAssignee = obj.assigneeId && filterAssigneeIds.includes(obj.assigneeId);
          const matchesNotSet = filterAssigneeNotSet && !obj.assigneeId;
          return matchesAssignee || matchesNotSet;
        });
      } else {
        // not_equals: show objectives where assignee is NOT in the selected list
        result = result.filter((obj: Objective) => {
          const excludesAssignee = !obj.assigneeId || !filterAssigneeIds.includes(obj.assigneeId);
          const matchesNotSet = filterAssigneeNotSet && !obj.assigneeId;
          // For not_equals with NotSet selected, show items that either have no assignee OR have an assignee not in the list
          if (filterAssigneeNotSet && filterAssigneeIds.length === 0) {
            return matchesNotSet;
          }
          return excludesAssignee;
        });
      }
    }

    // Filter by next step date
    if (filterNextStepDate) {
      if (filterNextStepDate === 'not_set') {
        result = result.filter((obj: Objective) => !obj.nextStepDate);
      } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayMs = today.getTime();

        result = result.filter((obj: Objective) => {
          if (!obj.nextStepDate) return false;
          // Parse date components to create local timezone date (consistent with dashboard)
          const [year, month, day] = obj.nextStepDate.split('-').map(Number);
          const stepDate = new Date(year, month - 1, day);
          stepDate.setHours(0, 0, 0, 0);
          const stepMs = stepDate.getTime();
          const diffDays = (stepMs - todayMs) / (1000 * 60 * 60 * 24);

          // For 'past' and 'today', use actual current time comparison
          if (filterNextStepDate === 'past' || filterNextStepDate === 'today') {
            const now = Date.now();
            const twentyFourHoursMs = 24 * 60 * 60 * 1000;
            // Use end of the next step date for comparison
            const stepEndMs = stepMs + twentyFourHoursMs;
            const diffFromNow = stepEndMs - now;

            if (filterNextStepDate === 'past') {
              // Past: more than 24 hours ago (step date ended before 24h window)
              return diffFromNow < 0;
            } else {
              // Today: within 24 hours (step date overlaps with 24h window)
              return diffFromNow >= 0 && diffFromNow < twentyFourHoursMs;
            }
          }

          switch (filterNextStepDate) {
            case 'last_7d':
              return diffDays >= -7 && diffDays < 0;
            case 'last_30d':
              return diffDays >= -30 && diffDays < 0;
            case 'next_7d':
              return diffDays >= 0 && diffDays <= 7;
            case 'next_30d':
              return diffDays >= 0 && diffDays <= 30;
            case 'future':
              return diffDays >= 0;
            default:
              return true;
          }
        });
      }
    }

    // Filter by last updated
    if (filterLastUpdated) {
      const option = LAST_UPDATED_OPTIONS.find(o => o.value === filterLastUpdated);
      if (option) {
        const cutoff = Date.now() - option.ms;
        result = result.filter((obj: Objective) => new Date(obj.updatedAt).getTime() >= cutoff);
      }
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      const keywords = query.split(/\s+/);
      result = result.filter((obj: Objective) => {
        const searchText = `${obj.title} ${obj.description || ''} ${obj.nextStep || ''}`.toLowerCase();
        return keywords.every(keyword => searchText.includes(keyword));
      });
    }

    // Filter by list membership (OR logic - item must be in at least one selected list)
    if (filterListIds.length > 0) {
      const selectedLists = lists.filter(l => filterListIds.includes(l.id));
      const listObjectiveIds = new Set(
        selectedLists.flatMap(list => list.items.map(item => item.objectiveId))
      );
      result = result.filter((obj: Objective) => listObjectiveIds.has(obj.id));
    }

    // Filter by key results only
    if (filterKeyResultsOnly) {
      result = result.filter((obj: Objective) => obj.isKeyResult === true);
    }

    // Capture the directly matching set before expanding to include children
    const directlyMatchingIds = new Set(result.map((obj: Objective) => obj.id));

    // Optionally include children of matching objectives
    if (showChildren && result.length > 0) {
      const matchingIds = new Set(result.map((obj: Objective) => obj.id));
      const isOpenChild = (obj: Objective) =>
        !openChildrenOnly || (obj.workflowStatus !== 'done' && obj.workflowStatus !== 'archived');

      if (directChildrenOnly) {
        // Only include direct children (immediate children of matching objectives)
        const directChildren = orgObjectives.filter((obj: Objective) =>
          obj.parentId && matchingIds.has(obj.parentId) && !matchingIds.has(obj.id) && isOpenChild(obj)
        );
        result = [...result, ...directChildren];
      } else {
        // Include all descendants (children, grandchildren, etc.)
        const descendants: Objective[] = [];
        const findDescendants = (parentIds: Set<string>) => {
          const children = orgObjectives.filter((obj: Objective) =>
            obj.parentId && parentIds.has(obj.parentId) && !matchingIds.has(obj.id) && isOpenChild(obj)
          );
          if (children.length > 0) {
            children.forEach((child: Objective) => {
              if (!matchingIds.has(child.id)) {
                descendants.push(child);
                matchingIds.add(child.id);
              }
            });
            findDescendants(new Set(children.map((c: Objective) => c.id)));
          }
        };
        findDescendants(matchingIds);
        result = [...result, ...descendants];
      }
    }

    return [result, directlyMatchingIds];
  }, [orgObjectives, filterPeriodIds, filterTeamIds, filterTagIds, filterTypes, filterTypeNotSet, filterLevels, filterWorkflowStatuses, filterKeyResultsOnly, filterObjectiveId, filterOwnerIds, filterOwnerOperator, filterAssigneeIds, filterAssigneeOperator, filterAssigneeNotSet, filterNextStepDate, filterLastUpdated, filterListIds, lists, searchQuery, includeAncestorPeriods, includeChildPeriods, includeChildTeams, showChildren, directChildrenOnly, openChildrenOnly, getAncestorPeriodIds, getDescendantPeriodIds, getDescendantTeamIds, getDescendantObjectiveIds]);

  // Get IDs of all filtered objectives for quick lookup
  const filteredObjectiveIds = useMemo(
    () => new Set(filteredObjectives.map((obj: Objective) => obj.id)),
    [filteredObjectives]
  );

  // Get root objectives for tree view:
  // - Objectives with no parent, OR
  // - Objectives whose parent is not in the filtered results (they become virtual roots)
  const rootObjectives = useMemo(
    () => filteredObjectives.filter((obj: Objective) =>
      !obj.parentId || !filteredObjectiveIds.has(obj.parentId)
    ),
    [filteredObjectives, filteredObjectiveIds]
  );

  // Group by level
  const companyObjectives = rootObjectives.filter((obj: Objective) => obj.level === 'company');
  const teamObjectives = rootObjectives.filter((obj: Objective) => obj.level === 'team');
  const individualObjectives = rootObjectives.filter((obj: Objective) => obj.level === 'individual');

  // Get active view
  const activeView = savedViews.find((v: SavedView) => v.id === activeViewId);

  // Detect if current filters have drifted from the saved view
  const isViewDirty = useMemo(() => {
    if (!activeView) return false;
    const f = activeView.filters;
    const sortedEq = (a: string[], b: string[]) =>
      JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    return (
      !sortedEq(f.filterPeriodIds ?? [], filterPeriodIds) ||
      !sortedEq(f.filterTagIds ?? [], filterTagIds) ||
      !sortedEq(f.filterTeamIds ?? [], filterTeamIds) ||
      !sortedEq(f.filterTypes ?? [], filterTypes) ||
      (f.filterTypeNotSet ?? false) !== filterTypeNotSet ||
      !sortedEq(f.filterOwnerIds ?? [], filterOwnerIds) ||
      (f.filterOwnerOperator ?? 'equals') !== filterOwnerOperator ||
      !sortedEq(f.filterAssigneeIds ?? [], filterAssigneeIds) ||
      (f.filterAssigneeOperator ?? 'equals') !== filterAssigneeOperator ||
      (f.filterNextStepDate ?? null) !== filterNextStepDate ||
      !sortedEq(f.filterLevels ?? [], filterLevels) ||
      (f.filterObjectiveId ?? null) !== filterObjectiveId
    );
  }, [activeView, filterPeriodIds, filterTagIds, filterTeamIds, filterTypes, filterTypeNotSet, filterOwnerIds, filterOwnerOperator, filterAssigneeIds, filterAssigneeOperator, filterNextStepDate, filterLevels, filterObjectiveId]);

  // View handlers
  const handleCreateView = async () => {
    if (!newViewName.trim()) return;
    await createView(newViewName.trim(), newViewIsDefault);
    setNewViewName('');
    setNewViewIsDefault(false);
    setShowSaveViewDialog(false);
  };

  const handleSaveCurrentView = async () => {
    if (activeViewId) {
      await updateView(activeViewId);
    }
  };

  const handleDeleteView = async (viewId: string) => {
    if (confirm('Are you sure you want to delete this view?')) {
      await deleteView(viewId);
    }
  };

  const handleRenameView = async (viewId: string) => {
    if (editingViewName.trim() && editingViewName.trim() !== savedViews.find((v: SavedView) => v.id === viewId)?.name) {
      await renameView(viewId, editingViewName.trim());
    }
    setEditingViewId(null);
    setEditingViewName('');
  };

  const startEditingView = (view: SavedView) => {
    setEditingViewId(view.id);
    setEditingViewName(view.name);
  };

  if (orgPeriods.length === 0) {
    return (
      <div className="text-center py-12">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900">No periods yet</h3>
        <p className="mt-1 text-sm text-gray-500">
          Create a period first to start adding objectives.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Views, Columns, and Search Row */}
      <div className="flex items-center gap-4">
        {/* View Selector */}
        <div className="relative" ref={viewDropdownRef}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-500">View:</span>
            <button
              onClick={() => setShowViewDropdown(!showViewDropdown)}
              className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50 shadow-sm"
            >
              <span className={activeView ? 'text-gray-900' : 'text-gray-500'}>
                {activeView ? activeView.name : 'Select View...'}
              </span>
              {activeView?.isDefault && (
                <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Default</span>
              )}
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {/* View Dropdown Menu */}
          {showViewDropdown && (
            <div className="absolute left-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
              <div className="py-1">
                <button
                  onClick={() => {
                    clearActiveView();
                    setShowViewDropdown(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${!activeViewId ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                >
                  No View (Default Settings)
                </button>
                {savedViews.length > 0 && <div className="border-t border-gray-100 my-1" />}
                {savedViews.map((view: SavedView) => (
                  <button
                    key={view.id}
                    onClick={() => {
                      applyView(view.id);
                      setShowViewDropdown(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center justify-between ${activeViewId === view.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                  >
                    <span>{view.name}</span>
                    {view.isDefault && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Default</span>
                    )}
                  </button>
                ))}
                {/* View Actions */}
                <div className="border-t border-gray-100 my-1" />
                <button
                  onClick={() => {
                    setNewViewName('');
                    setNewViewIsDefault(false);
                    setShowSaveViewDialog(true);
                    setShowViewDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Save as New View
                </button>
                {activeView && (
                  <button
                    onClick={() => {
                      handleSaveCurrentView();
                      setShowViewDropdown(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                    Update Current View
                  </button>
                )}
                {savedViews.length > 0 && (
                  <button
                    onClick={() => {
                      setShowManageViewsDialog(true);
                      setShowViewDropdown(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Manage Views
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Dirty view indicator */}
        {activeView && isViewDirty && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
              Unsaved changes
            </span>
            <button
              onClick={handleSaveCurrentView}
              className="px-2.5 py-1 text-xs bg-gray-800 text-white rounded-md hover:bg-gray-700"
              title={`Update "${activeView.name}"`}
            >
              Update
            </button>
            <button
              onClick={() => { setNewViewName(''); setNewViewIsDefault(false); setShowSaveViewDialog(true); }}
              className="px-2.5 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
            >
              Save as New
            </button>
          </div>
        )}

        {/* Column Visibility Toggle */}
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
              {(Object.keys(COLUMN_LABELS).filter(c => c !== 'title') as ColumnKey[]).map((col) => (
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

        {/* Search */}
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search objectives..."
            className="w-full bg-white border border-gray-200 rounded-lg px-4 py-2 pl-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Save View Dialog */}
      {showSaveViewDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Save Current View</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">View Name</label>
                <input
                  type="text"
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  placeholder="Enter view name..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateView();
                    if (e.key === 'Escape') setShowSaveViewDialog(false);
                  }}
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newViewIsDefault}
                  onChange={(e) => setNewViewIsDefault(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Set as default view</span>
              </label>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowSaveViewDialog(false)}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateView}
                disabled={!newViewName.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Views Dialog */}
      {showManageViewsDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Manage Views</h3>
            {savedViews.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">No saved views yet.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {savedViews.map((view: SavedView) => (
                  <div
                    key={view.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    {editingViewId === view.id ? (
                      <input
                        type="text"
                        value={editingViewName}
                        onChange={(e) => setEditingViewName(e.target.value)}
                        onBlur={() => handleRenameView(view.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameView(view.id);
                          if (e.key === 'Escape') {
                            setEditingViewId(null);
                            setEditingViewName('');
                          }
                        }}
                        className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{view.name}</span>
                        {view.isDefault && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Default</span>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => startEditingView(view)}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded"
                        title="Rename"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      {!view.isDefault && (
                        <button
                          onClick={() => setDefaultView(view.id)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-200 rounded"
                          title="Set as default"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteView(view.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-gray-200 rounded"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setShowManageViewsDialog(false)}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div
          className="flex items-center justify-between p-4 cursor-pointer"
          onClick={() => setIsFilterExpanded(!isFilterExpanded)}
        >
          <div className="flex items-center gap-2">
            <button className="text-gray-400 hover:text-gray-600">
              <svg
                className={`w-4 h-4 transition-transform ${isFilterExpanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <h3 className="text-sm font-medium text-gray-700">Filters</h3>
            {hasActiveFilters && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                Active
              </span>
            )}
            {hasActiveFilters && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearAllFilters();
                  setSearchQuery('');
                }}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {isFilterExpanded && (
          <div className="px-4 pb-4 border-t border-gray-100 pt-4">
            <div className="flex gap-6">
              {/* Column 1 - 50%: Period, Team, Owner, Assignee */}
              <div className="flex-[2] space-y-3 min-w-0">
                {/* Period Filter */}
                <div className="flex items-start gap-3">
                  <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Period</label>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {filterPeriodIds.map(pid => {
                        const period = orgPeriods.find((p: Period) => p.id === pid);
                        return period ? (
                          <span key={pid} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-800 text-white rounded-full text-xs">
                            {period.name}
                            <button onClick={() => toggleFilterPeriod(pid)} className="hover:text-gray-300 ml-0.5">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </span>
                        ) : null;
                      })}
                      <div className="relative" ref={periodDropdownRef}>
                        <button
                          onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
                          className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                        >
                          + Add
                        </button>
                        {showPeriodDropdown && (
                          <div className="absolute z-50 mt-1 bg-white border border-gray-300 rounded-md shadow-lg min-w-[180px] max-h-64 overflow-y-auto">
                            {orgPeriods.filter((p: Period) => !filterPeriodIds.includes(p.id)).length === 0 ? (
                              <div className="text-xs text-gray-400 px-3 py-2">All periods selected</div>
                            ) : orgPeriods.filter((p: Period) => !filterPeriodIds.includes(p.id)).map((period: Period) => (
                              <button
                                key={period.id}
                                onClick={() => { toggleFilterPeriod(period.id); setShowPeriodDropdown(false); }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 truncate"
                              >
                                {period.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {filterPeriodIds.length > 0 && (
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
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {filterTeamIds.map(tid => {
                          const team = orgTeams.find((t: Team) => t.id === tid);
                          return team ? (
                            <span key={tid} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-800 text-white rounded-full text-xs">
                              {team.name}
                              <button onClick={() => toggleFilterTeam(tid)} className="hover:text-gray-300 ml-0.5">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            </span>
                          ) : null;
                        })}
                        <div className="relative" ref={teamDropdownRef}>
                          <button
                            onClick={() => setShowTeamDropdown(!showTeamDropdown)}
                            className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                          >
                            + Add
                          </button>
                          {showTeamDropdown && (
                            <div className="absolute z-50 mt-1 bg-white border border-gray-300 rounded-md shadow-lg min-w-[180px] max-h-64 overflow-y-auto">
                              {orgTeams.filter((t: Team) => !filterTeamIds.includes(t.id)).length === 0 ? (
                                <div className="text-xs text-gray-400 px-3 py-2">All teams selected</div>
                              ) : orgTeams.filter((t: Team) => !filterTeamIds.includes(t.id)).map((team: Team) => (
                                <button
                                  key={team.id}
                                  onClick={() => { toggleFilterTeam(team.id); setShowTeamDropdown(false); }}
                                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 truncate"
                                >
                                  {team.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
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

                {/* Owner Filter */}
                {orgUsers.length > 0 && (
                  <div className="flex items-start gap-3">
                    <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Owner</label>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <select
                          value={filterOwnerOperator}
                          onChange={(e) => setFilterOwnerOperator(e.target.value as FilterOperator)}
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="equals">=</option>
                          <option value="not_equals">!=</option>
                        </select>
                        {filterOwnerIds.map(uid => {
                          const u = orgUsers.find((u: User) => u.id === uid);
                          return u ? (
                            <span key={uid} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-800 text-white rounded-full text-xs">
                              {u.name}
                              <button onClick={() => setFilterOwners(filterOwnerIds.filter(id => id !== uid))} className="hover:text-gray-300 ml-0.5">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            </span>
                          ) : null;
                        })}
                        <div className="relative" ref={ownerDropdownRef}>
                          <button
                            onClick={() => setShowOwnerDropdown(!showOwnerDropdown)}
                            className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                          >
                            + Add
                          </button>
                          {showOwnerDropdown && (
                            <div className="absolute z-50 mt-1 bg-white border border-gray-300 rounded-md shadow-lg min-w-[160px] max-h-64 overflow-y-auto">
                              {orgUsers.filter((u: User) => !filterOwnerIds.includes(u.id)).length === 0 ? (
                                <div className="text-xs text-gray-400 px-3 py-2">All users selected</div>
                              ) : orgUsers.filter((u: User) => !filterOwnerIds.includes(u.id)).map((u: User) => (
                                <button
                                  key={u.id}
                                  onClick={() => { setFilterOwners([...filterOwnerIds, u.id]); setShowOwnerDropdown(false); }}
                                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 truncate"
                                >
                                  {u.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Assignee Filter */}
                {orgUsers.length > 0 && (
                  <div className="flex items-start gap-3">
                    <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Assignee</label>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <select
                          value={filterAssigneeOperator}
                          onChange={(e) => setFilterAssigneeOperator(e.target.value as FilterOperator)}
                          className="px-1.5 py-1 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="equals">=</option>
                          <option value="not_equals">!=</option>
                        </select>
                        {filterAssigneeIds.map(uid => {
                          const u = orgUsers.find((u: User) => u.id === uid);
                          return u ? (
                            <span key={uid} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-800 text-white rounded-full text-xs">
                              {u.name}
                              <button onClick={() => setFilterAssignees(filterAssigneeIds.filter(id => id !== uid))} className="hover:text-gray-300 ml-0.5">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            </span>
                          ) : null;
                        })}
                        {filterAssigneeNotSet && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-800 text-white rounded-full text-xs">
                            Not Set
                            <button onClick={() => toggleFilterAssigneeNotSet()} className="hover:text-gray-300 ml-0.5">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </span>
                        )}
                        <div className="relative" ref={assigneeDropdownRef}>
                          <button
                            onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
                            className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                          >
                            + Add
                          </button>
                          {showAssigneeDropdown && (
                            <div className="absolute z-50 mt-1 bg-white border border-gray-300 rounded-md shadow-lg min-w-[160px] max-h-64 overflow-y-auto">
                              {!filterAssigneeNotSet && (
                                <button
                                  onClick={() => { toggleFilterAssigneeNotSet(); setShowAssigneeDropdown(false); }}
                                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 italic text-gray-500"
                                >
                                  Not Set
                                </button>
                              )}
                              {orgUsers.filter((u: User) => !filterAssigneeIds.includes(u.id)).map((u: User) => (
                                <button
                                  key={u.id}
                                  onClick={() => { setFilterAssignees([...filterAssigneeIds, u.id]); setShowAssigneeDropdown(false); }}
                                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 truncate"
                                >
                                  {u.name}
                                </button>
                              ))}
                              {orgUsers.filter((u: User) => !filterAssigneeIds.includes(u.id)).length === 0 && filterAssigneeNotSet && (
                                <div className="text-xs text-gray-400 px-3 py-2">All options selected</div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Column 2 - 25%: Tags, Type, Level, Status */}
              <div className="flex-1 space-y-3 min-w-0">
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

                {/* Workflow Status Filter */}
                <div className="flex items-start gap-3">
                  <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Status</label>
                  <div className="flex flex-wrap gap-1.5">
                    {WORKFLOW_STATUS_OPTIONS.map((status) => (
                      <button
                        key={status.value}
                        onClick={() => toggleFilterWorkflowStatus(status.value)}
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
              </div>

              {/* Column 3 - 25%: Key Results, Next Date, Updated, Parent, List */}
              <div className="flex-1 space-y-3 min-w-0">
                {/* Key Results Only Filter */}
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0">Key Results</label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filterKeyResultsOnly}
                      onChange={() => toggleFilterKeyResultsOnly()}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Show only Key Results
                  </label>
                </div>

                {/* Next Step Date Filter */}
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0">Next Date</label>
                  <select
                    value={filterNextStepDate || ''}
                    onChange={(e) => setFilterNextStepDate(e.target.value as NextStepDateFilter || null)}
                    className="px-2 py-1 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">All</option>
                    {NEXT_STEP_DATE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Last Updated Filter */}
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0">Updated</label>
                  <select
                    value={filterLastUpdated || ''}
                    onChange={(e) => setFilterLastUpdated(e.target.value || null)}
                    className="px-2 py-1 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">All</option>
                    {LAST_UPDATED_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Parent Objective Filter */}
                <div className="flex items-start gap-3">
                  <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Parent</label>
                  <div className="relative flex-1 min-w-0" ref={objectiveDropdownRef}>
                    {filterObjectiveId ? (
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-1 bg-gray-800 text-white rounded-full text-xs truncate max-w-xs">
                          {orgObjectives.find((o: Objective) => o.id === filterObjectiveId)?.title || 'Unknown'}
                        </span>
                        <button
                          onClick={() => setFilterObjective(null)}
                          className="text-gray-400 hover:text-gray-600"
                          title="Clear filter"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setShowObjectiveDropdown(!showObjectiveDropdown);
                            setTimeout(() => objectiveSearchRef.current?.focus(), 0);
                          }}
                          className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                        >
                          Select objective...
                        </button>
                        {showObjectiveDropdown && (
                          <div className="absolute z-50 mt-1 w-72 bg-white border border-gray-300 rounded-lg shadow-lg">
                            <div className="p-2 border-b border-gray-200">
                              <input
                                ref={objectiveSearchRef}
                                type="text"
                                value={objectiveSearch}
                                onChange={(e) => setObjectiveSearch(e.target.value)}
                                placeholder="Search objectives..."
                                className="w-full text-xs px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    setShowObjectiveDropdown(false);
                                    setObjectiveSearch('');
                                  }
                                }}
                              />
                            </div>
                            <div className="max-h-64 overflow-y-auto">
                              {orgObjectives
                                .filter((o: Objective) =>
                                  objectiveSearch.trim()
                                    ? o.title.toLowerCase().includes(objectiveSearch.toLowerCase())
                                    : true
                                )
                                .slice(0, 50)
                                .map((o: Objective) => (
                                  <button
                                    key={o.id}
                                    onClick={() => {
                                      setFilterObjective(o.id);
                                      setShowObjectiveDropdown(false);
                                      setObjectiveSearch('');
                                    }}
                                    className="w-full text-left text-xs px-3 py-2 hover:bg-gray-100 truncate"
                                    title={o.title}
                                  >
                                    {o.title}
                                  </button>
                                ))}
                              {orgObjectives.filter((o: Objective) =>
                                objectiveSearch.trim()
                                  ? o.title.toLowerCase().includes(objectiveSearch.toLowerCase())
                                  : true
                              ).length === 0 && (
                                <div className="text-xs text-gray-400 px-3 py-2">No objectives found</div>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* List Filter */}
                {lists.length > 0 && (
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0">List</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className="relative" ref={listDropdownRef}>
                        <button
                          onClick={() => setShowListDropdown(!showListDropdown)}
                          className="flex items-center gap-1.5 px-2 py-1 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          {filterListIds.length > 0 ? (
                            <>
                              <div className="flex items-center gap-0.5">
                                {filterListIds.slice(0, 3).map(listId => {
                                  const list = lists.find(l => l.id === listId);
                                  return list ? (
                                    <span
                                      key={listId}
                                      className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                      style={{ backgroundColor: list.color || '#6b7280' }}
                                      title={list.name}
                                    />
                                  ) : null;
                                })}
                                {filterListIds.length > 3 && (
                                  <span className="text-gray-400 text-xs">+{filterListIds.length - 3}</span>
                                )}
                              </div>
                              <span>{filterListIds.length} selected</span>
                            </>
                          ) : (
                            <span>All</span>
                          )}
                          <svg className="w-3 h-3 text-gray-400 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {showListDropdown && (
                          <div className="absolute z-50 mt-1 bg-white border border-gray-300 rounded-md shadow-lg min-w-[180px]">
                            {lists.map((list: List) => {
                              const isSelected = filterListIds.includes(list.id);
                              return (
                                <button
                                  key={list.id}
                                  onClick={() => toggleFilterList(list.id)}
                                  className={`w-full text-left px-2 py-1.5 text-xs hover:bg-gray-100 flex items-center gap-1.5 ${isSelected ? 'bg-blue-50' : ''}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {}}
                                    className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  />
                                  <span
                                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                    style={{ backgroundColor: list.color || '#6b7280' }}
                                  />
                                  <span className={isSelected ? 'text-blue-700' : ''}>{list.name}</span>
                                  <span className="text-gray-400">({list.items.length})</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {filterListIds.length > 0 && (
                        <button
                          onClick={() => clearFilterLists()}
                          className="text-gray-400 hover:text-gray-600"
                          title="Clear filter"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Display Options */}
            {hasActiveFilters && (
              <div className="pt-3 border-t border-gray-200">
                <div className="flex items-center gap-4">
                  <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showChildren}
                      onChange={(e) => {
                        setShowChildren(e.target.checked);
                        if (e.target.checked) setDirectChildrenOnly(true);
                      }}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Show children of matching objectives
                  </label>
                  {showChildren && (
                    <>
                      <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={directChildrenOnly}
                          onChange={(e) => setDirectChildrenOnly(e.target.checked)}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        Direct children only
                      </label>
                      <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={openChildrenOnly}
                          onChange={(e) => setOpenChildrenOnly(e.target.checked)}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        Only show open children
                      </label>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Empty state for filtered results */}
      {filteredObjectives.length === 0 && (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">
            {hasActiveFilters ? 'No matching objectives' : 'No objectives yet'}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {hasActiveFilters
              ? 'Try adjusting your filters or create objectives that match.'
              : 'Get started by creating a new objective.'}
          </p>
        </div>
      )}

      {/* Objectives Table */}
      {filteredObjectives.length > 0 && (
        <section className={`bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto ${resizingColumn ? 'select-none' : ''}`}>
          <div className="min-w-max">
          {/* Table header */}
          <div className="flex items-center bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
            <div className="relative flex items-center" style={{ width: columnWidths.title, minWidth: 150 }}>
              <div className="px-2 py-2 flex-1">Objective ({filteredObjectives.length})</div>
              <div
                className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                onMouseDown={(e) => handleResizeStart('title', e)}
              />
            </div>
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
            {visibleColumns.includes('keyResult') && (
              <div className="relative flex items-center" style={{ width: columnWidths.keyResult }}>
                <div className="px-1 py-2 flex-1">KR</div>
                <div
                  className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                  onMouseDown={(e) => handleResizeStart('keyResult', e)}
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
            {visibleColumns.includes('resolved') && (
              <div className="relative flex items-center" style={{ width: columnWidths.resolved }}>
                <div className="px-1 py-2 flex-1">Resolved</div>
                <div
                  className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10"
                  onMouseDown={(e) => handleResizeStart('resolved', e)}
                />
              </div>
            )}
          </div>

          {/* Table body */}
          <div>
            {companyObjectives.map((obj: Objective) => (
              <CompactObjectiveCard key={obj.id} objective={obj} filteredObjectiveIds={filteredObjectiveIds} directlyMatchingIds={directlyMatchingObjectiveIds} />
            ))}
            {teamObjectives.map((obj: Objective) => (
              <CompactObjectiveCard key={obj.id} objective={obj} filteredObjectiveIds={filteredObjectiveIds} directlyMatchingIds={directlyMatchingObjectiveIds} />
            ))}
            {individualObjectives.map((obj: Objective) => (
              <CompactObjectiveCard key={obj.id} objective={obj} filteredObjectiveIds={filteredObjectiveIds} directlyMatchingIds={directlyMatchingObjectiveIds} />
            ))}
          </div>
          </div>
        </section>
      )}
    </div>
  );
}
