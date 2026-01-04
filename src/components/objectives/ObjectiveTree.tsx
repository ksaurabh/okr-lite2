import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useOKRStore, type OKRStore, type ColumnWidths } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { CompactObjectiveCard } from './CompactObjectiveCard';
import type { Period, PeriodType, Objective, Team, Tag, User, FilterOperator, ObjectiveType, NextStepDateFilter, ObjectiveLevel } from '../../types';

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

const API_URL = import.meta.env.VITE_API_URL || '';

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

export function ObjectiveTree() {
  const [isFilterExpanded, setIsFilterExpanded] = useState(true);
  const [includeAncestorPeriods, setIncludeAncestorPeriods] = useState(false);
  const [includeChildPeriods, setIncludeChildPeriods] = useState(true);
  const [includeChildTeams, setIncludeChildTeams] = useState(true);
  const [showChildren, setShowChildren] = useState(false);
  const [directChildrenOnly, setDirectChildrenOnly] = useState(false);
  const [orgUsers, setOrgUsers] = useState<User[]>([]);

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
  const filterNextStepDate = useOKRStore((state: OKRStore) => state.filterNextStepDate);
  const setFilterNextStepDate = useOKRStore((state: OKRStore) => state.setFilterNextStepDate);
  const filterLevels = useOKRStore((state: OKRStore) => state.filterLevels);
  const toggleFilterLevel = useOKRStore((state: OKRStore) => state.toggleFilterLevel);
  const clearAllFilters = useOKRStore((state: OKRStore) => state.clearAllFilters);
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

  // Filter items by organization and visibility (admins see all, others see shared or owned)
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

  const hasActiveFilters = activePeriodId || filterTagIds.length > 0 || filterTeamIds.length > 0 || filterTypes.length > 0 || filterTypeNotSet || filterOwnerIds.length > 0 || filterAssigneeIds.length > 0;

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

  // Get root periods (no parent) for hierarchical display
  const rootPeriods = useMemo(() => {
    return orgPeriods.filter((p: Period) => !p.parentId);
  }, [orgPeriods]);

  // Apply all filters
  const filteredObjectives = useMemo(() => {
    let result = orgObjectives;

    // Filter by period (optionally including ancestor and/or child periods)
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

    // Filter by owners (with operator support)
    if (filterOwnerIds.length > 0) {
      if (filterOwnerOperator === 'equals') {
        result = result.filter((obj: Objective) => obj.ownerId && filterOwnerIds.includes(obj.ownerId));
      } else {
        // not_equals: show objectives where owner is NOT in the selected list
        result = result.filter((obj: Objective) => !obj.ownerId || !filterOwnerIds.includes(obj.ownerId));
      }
    }

    // Filter by assignees (with operator support)
    if (filterAssigneeIds.length > 0) {
      if (filterAssigneeOperator === 'equals') {
        result = result.filter((obj: Objective) => obj.assigneeId && filterAssigneeIds.includes(obj.assigneeId));
      } else {
        // not_equals: show objectives where assignee is NOT in the selected list
        result = result.filter((obj: Objective) => !obj.assigneeId || !filterAssigneeIds.includes(obj.assigneeId));
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
          const stepDate = new Date(obj.nextStepDate);
          stepDate.setHours(0, 0, 0, 0);
          const stepMs = stepDate.getTime();
          const diffDays = (stepMs - todayMs) / (1000 * 60 * 60 * 24);

          switch (filterNextStepDate) {
            case 'last_7d':
              return diffDays >= -7 && diffDays < 0;
            case 'last_30d':
              return diffDays >= -30 && diffDays < 0;
            case 'past':
              return diffDays < 0;
            case 'today':
              return diffDays === 0;
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

    // Optionally include children of matching objectives
    if (showChildren && result.length > 0) {
      const matchingIds = new Set(result.map((obj: Objective) => obj.id));

      if (directChildrenOnly) {
        // Only include direct children (immediate children of matching objectives)
        const directChildren = orgObjectives.filter((obj: Objective) =>
          obj.parentId && matchingIds.has(obj.parentId) && !matchingIds.has(obj.id)
        );
        result = [...result, ...directChildren];
      } else {
        // Include all descendants (children, grandchildren, etc.)
        const descendants: Objective[] = [];
        const findDescendants = (parentIds: Set<string>) => {
          const children = orgObjectives.filter((obj: Objective) =>
            obj.parentId && parentIds.has(obj.parentId) && !matchingIds.has(obj.id)
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

    return result;
  }, [orgObjectives, activePeriodId, filterTeamIds, filterTagIds, filterTypes, filterTypeNotSet, filterLevels, filterOwnerIds, filterOwnerOperator, filterAssigneeIds, filterAssigneeOperator, filterNextStepDate, includeAncestorPeriods, includeChildPeriods, includeChildTeams, showChildren, directChildrenOnly, getAncestorPeriodIds, getDescendantPeriodIds, getDescendantTeamIds]);

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
          </div>
          {hasActiveFilters && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearAllFilters();
              }}
              className="text-xs text-blue-600 hover:text-blue-700"
            >
              Clear all
            </button>
          )}
        </div>

        {isFilterExpanded && (
          <div className="px-4 pb-4 border-t border-gray-100 pt-4">
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

            {/* Display Options */}
            {hasActiveFilters && (
              <div className="pt-3 border-t border-gray-200 space-y-2">
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
                  <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer ml-5">
                    <input
                      type="checkbox"
                      checked={directChildrenOnly}
                      onChange={(e) => setDirectChildrenOnly(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Direct children only
                  </label>
                )}
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
        <section className={`bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden ${resizingColumn ? 'select-none' : ''}`}>
          {/* Table header */}
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

          {/* Table body */}
          <div>
            {companyObjectives.map((obj: Objective) => (
              <CompactObjectiveCard key={obj.id} objective={obj} filteredObjectiveIds={filteredObjectiveIds} />
            ))}
            {teamObjectives.map((obj: Objective) => (
              <CompactObjectiveCard key={obj.id} objective={obj} filteredObjectiveIds={filteredObjectiveIds} />
            ))}
            {individualObjectives.map((obj: Objective) => (
              <CompactObjectiveCard key={obj.id} objective={obj} filteredObjectiveIds={filteredObjectiveIds} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
