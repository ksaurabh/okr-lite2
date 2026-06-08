import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useOKRStore, type OKRStore, type ColumnWidths, type ColumnKey, COLUMN_LABELS, DEFAULT_VISIBLE_COLUMNS } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { CompactObjectiveCard } from './CompactObjectiveCard';
import { ObjectiveFilterPanel } from '../filters/ObjectiveFilterPanel';
import { PlanView } from './PlanView';
import {
  buildPeriodAncestorLookup,
  buildPeriodDescendantLookup,
  buildTeamDescendantLookup,
  buildObjectiveDescendantLookup,
  filterObjectives,
} from '../../utils/objectiveFilters';
import type { Period, PeriodType, Objective, Team, Tag, User, SavedView } from '../../types';

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

interface ObjectiveTreeProps {
  highlightObjectiveId?: string | null;
  onHighlightClear?: () => void;
  onViewChange?: (view: string) => void;
}


export function ObjectiveTree({ highlightObjectiveId, onHighlightClear, onViewChange }: ObjectiveTreeProps = {}) {
  const [includeAncestorPeriods, setIncludeAncestorPeriods] = useState(false);
  const [includeChildPeriods, setIncludeChildPeriods] = useState(true);
  const [includeChildTeams, setIncludeChildTeams] = useState(true);
  const [showChildren, setShowChildren] = useState(false);
  const [directChildrenOnly, setDirectChildrenOnly] = useState(false);
  const openChildrenOnly = useOKRStore((state: OKRStore) => state.openChildrenOnly);
  const clearAllFilters = useOKRStore((state: OKRStore) => state.clearAllFilters);
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
  const filterTypes = useOKRStore((state: OKRStore) => state.filterTypes);
  const filterTypeNotSet = useOKRStore((state: OKRStore) => state.filterTypeNotSet);
  const filterAssigneeNotSet = useOKRStore((state: OKRStore) => state.filterAssigneeNotSet);
  const filterNextStepDate = useOKRStore((state: OKRStore) => state.filterNextStepDate);
  const filterLevels = useOKRStore((state: OKRStore) => state.filterLevels);
  const filterWorkflowStatuses = useOKRStore((state: OKRStore) => state.filterWorkflowStatuses);
  const filterKeyResultsOnly = useOKRStore((state: OKRStore) => state.filterKeyResultsOnly);
  const filterObjectiveId = useOKRStore((state: OKRStore) => state.filterObjectiveId);
  const filterRootObjectiveId = useOKRStore((state: OKRStore) => state.filterRootObjectiveId);
  const lists = useOKRStore((state: OKRStore) => state.lists);
  const filterListIds = useOKRStore((state: OKRStore) => state.filterListIds);
  const columnWidths = useOKRStore((state: OKRStore) => state.columnWidths);
  const setColumnWidths = useOKRStore((state: OKRStore) => state.setColumnWidths);
  const visibleColumnsExplore = useOKRStore((state: OKRStore) => state.visibleColumns);
  const toggleColumnVisibility = useOKRStore((state: OKRStore) => state.toggleColumnVisibility);
  const planTreeColumns = useOKRStore((state: OKRStore) => state.planTreeColumns);
  const togglePlanTreeColumn = useOKRStore((state: OKRStore) => state.togglePlanTreeColumn);
  const visibleColumns = visibleColumnsExplore;
  const toggleColumn = toggleColumnVisibility;

  // Plan-mode splitter
  const [planLeftWidth, setPlanLeftWidth] = useState<number>(() => {
    try {
      const v = localStorage.getItem('okr-objective-plan-left-width');
      const n = v ? parseInt(v, 10) : NaN;
      return Number.isFinite(n) && n >= 20 && n <= 80 ? n : 60;
    } catch { return 60; }
  });
  const planSplitRef = useRef<HTMLDivElement>(null);
  const isDraggingPlanSplitterRef = useRef(false);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isDraggingPlanSplitterRef.current || !planSplitRef.current) return;
      const rect = planSplitRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(20, Math.min(80, pct));
      setPlanLeftWidth(clamped);
    };
    const handleUp = () => {
      if (!isDraggingPlanSplitterRef.current) return;
      isDraggingPlanSplitterRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem('okr-objective-plan-left-width', String(Math.round(planLeftWidth))); } catch { /* ignore */ }
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [planLeftWidth]);

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
  const toggleViewStarred = useOKRStore((state: OKRStore) => state.toggleViewStarred);

  // Column visibility dropdown state
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  // View management state
  const [showViewDropdown, setShowViewDropdown] = useState(false);
  const [showSaveViewDialog, setShowSaveViewDialog] = useState(false);
  const [showManageViewsDialog, setShowManageViewsDialog] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [newViewIsDefault, setNewViewIsDefault] = useState(false);
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [editingViewName, setEditingViewName] = useState('');
  const viewDropdownRef = useRef<HTMLDivElement>(null);

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

  const storeHighlightId = useOKRStore((s: OKRStore) => s.highlightObjectiveId);
  const setStoreHighlightId = useOKRStore((s: OKRStore) => s.setHighlightObjectiveId);
  const effectiveHighlightId = highlightObjectiveId || storeHighlightId;

  // Scroll to and flash a highlighted objective
  useEffect(() => {
    if (!effectiveHighlightId) return;
    const clear = () => {
      onHighlightClear?.();
      setStoreHighlightId(null);
    };
    // Give the tree a moment to render
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-objective-id="${effectiveHighlightId}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'background-color 0.3s';
        el.style.backgroundColor = '#fef08a'; // yellow-200
        setTimeout(() => {
          el.style.backgroundColor = '';
          setTimeout(() => {
            el.style.transition = '';
            clear();
          }, 600);
        }, 1200);
      } else {
        clear();
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [effectiveHighlightId, onHighlightClear, setStoreHighlightId]);

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

  const hasActiveFilters = filterPeriodIds.length > 0 || filterTagIds.length > 0 || filterTeamIds.length > 0 || filterTypes.length > 0 || filterTypeNotSet || filterOwnerIds.length > 0 || filterAssigneeIds.length > 0 || filterAssigneeNotSet || filterNextStepDate || filterLastUpdated || filterLevels.length > 0 || filterWorkflowStatuses.length > 0 || filterKeyResultsOnly || filterObjectiveId || filterRootObjectiveId || filterListIds.length > 0 || searchQuery.trim();

  const ancestorPeriodLookup = useMemo(() => buildPeriodAncestorLookup(orgPeriods), [orgPeriods]);
  const descendantPeriodLookup = useMemo(() => buildPeriodDescendantLookup(orgPeriods), [orgPeriods]);
  const descendantTeamLookup = useMemo(() => buildTeamDescendantLookup(orgTeams), [orgTeams]);
  const descendantObjectiveLookup = useMemo(() => buildObjectiveDescendantLookup(orgObjectives), [orgObjectives]);

  const { filtered: filteredObjectives, directlyMatchingIds: directlyMatchingObjectiveIds } = useMemo(
    () => filterObjectives({
      orgObjectives,
      lists,
      filterPeriodIds,
      filterTagIds,
      filterTeamIds,
      filterTypes,
      filterTypeNotSet,
      filterOwnerIds,
      filterOwnerOperator,
      filterAssigneeIds,
      filterAssigneeOperator,
      filterAssigneeNotSet,
      filterNextStepDate,
      filterLevels,
      filterWorkflowStatuses,
      filterKeyResultsOnly,
      filterObjectiveId,
      filterRootObjectiveId,
      filterListIds,
      filterLastUpdated,
      searchQuery,
      includeAncestorPeriods,
      includeChildPeriods,
      includeChildTeams,
      showChildren,
      directChildrenOnly,
      openChildrenOnly,
      ancestorPeriodLookup,
      descendantPeriodLookup,
      descendantTeamLookup,
      descendantObjectiveLookup,
    }),
    [orgObjectives, lists, filterPeriodIds, filterTagIds, filterTeamIds, filterTypes, filterTypeNotSet, filterOwnerIds, filterOwnerOperator, filterAssigneeIds, filterAssigneeOperator, filterAssigneeNotSet, filterNextStepDate, filterLevels, filterWorkflowStatuses, filterKeyResultsOnly, filterObjectiveId, filterRootObjectiveId, filterListIds, filterLastUpdated, searchQuery, includeAncestorPeriods, includeChildPeriods, includeChildTeams, showChildren, directChildrenOnly, openChildrenOnly, ancestorPeriodLookup, descendantPeriodLookup, descendantTeamLookup, descendantObjectiveLookup]
  );

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
      (f.filterObjectiveId ?? null) !== filterObjectiveId ||
      (f.openChildrenOnly ?? false) !== openChildrenOnly
    );
  }, [activeView, filterPeriodIds, filterTagIds, filterTeamIds, filterTypes, filterTypeNotSet, filterOwnerIds, filterOwnerOperator, filterAssigneeIds, filterAssigneeOperator, filterNextStepDate, filterLevels, filterObjectiveId, openChildrenOnly]);

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
                {savedViews.filter((v: SavedView) => v.starred || v.isDefault).length > 0 && <div className="border-t border-gray-100 my-1" />}
                {savedViews.filter((v: SavedView) => v.starred || v.isDefault).map((view: SavedView) => (
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
                <button
                  onClick={() => {
                    setShowViewDropdown(false);
                    onViewChange?.('views');
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  All Views
                </button>
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
                    onChange={() => toggleColumn(col)}
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
            <h3 className="text-lg font-semibold text-gray-900 mb-4">All Views</h3>
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
                        onClick={() => toggleViewStarred(view.id)}
                        className={`p-1.5 rounded ${view.starred ? 'text-yellow-500 hover:text-yellow-600' : 'text-gray-400 hover:text-yellow-500'} hover:bg-gray-200`}
                        title={view.starred ? 'Unstar' : 'Star'}
                      >
                        <svg className="w-4 h-4" fill={view.starred ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      </button>
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

      <ObjectiveFilterPanel
        orgObjectives={orgObjectives}
        orgPeriods={orgPeriods}
        orgTeams={orgTeams}
        orgTags={orgTags}
        orgUsers={orgUsers}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        includeAncestorPeriods={includeAncestorPeriods}
        setIncludeAncestorPeriods={setIncludeAncestorPeriods}
        includeChildPeriods={includeChildPeriods}
        setIncludeChildPeriods={setIncludeChildPeriods}
        includeChildTeams={includeChildTeams}
        setIncludeChildTeams={setIncludeChildTeams}
        showChildren={showChildren}
        setShowChildren={setShowChildren}
        directChildrenOnly={directChildrenOnly}
        setDirectChildrenOnly={setDirectChildrenOnly}
        filterLastUpdated={filterLastUpdated}
        setFilterLastUpdated={setFilterLastUpdated}
        showListMembershipOption
      />

      {hasActiveFilters && (
        <div className="flex items-center justify-end mb-2">
          <button
            onClick={() => { clearAllFilters(); setSearchQuery(''); }}
            className="px-2 py-1 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
            title="Reset all filters to show the full objective tree"
          >
            Clear filters
          </button>
        </div>
      )}

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

interface TreeTableSectionProps {
  resizingColumn: keyof ColumnWidths | null;
  columnWidths: ColumnWidths;
  visibleColumns: ColumnKey[];
  visibleColumnsOverride?: ColumnKey[];
  handleResizeStart: (column: keyof ColumnWidths, e: React.MouseEvent) => void;
  filteredObjectives: Objective[];
  filteredObjectiveIds: Set<string>;
  directlyMatchingIds: Set<string>;
  companyObjectives: Objective[];
  teamObjectives: Objective[];
  individualObjectives: Objective[];
}

function TreeTableSection({ resizingColumn, columnWidths, visibleColumns, visibleColumnsOverride, handleResizeStart, filteredObjectives, filteredObjectiveIds, directlyMatchingIds, companyObjectives, teamObjectives, individualObjectives }: TreeTableSectionProps) {
  return (
    <section className={`bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto ${resizingColumn ? 'select-none' : ''}`}>
      <div className="min-w-max">
        <div className="flex items-center bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
          <div className="relative flex items-center" style={{ width: columnWidths.title, minWidth: 150 }}>
            <div className="px-2 py-2 flex-1">Objective ({filteredObjectives.length})</div>
            <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('title', e)} />
          </div>
          {visibleColumns.includes('level') && (
            <div className="relative flex items-center" style={{ width: columnWidths.level }}>
              <div className="px-1 py-2 flex-1">Level</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('level', e)} />
            </div>
          )}
          {visibleColumns.includes('type') && (
            <div className="relative flex items-center" style={{ width: columnWidths.type }}>
              <div className="px-1 py-2 flex-1">Type</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('type', e)} />
            </div>
          )}
          {visibleColumns.includes('workflowStatus') && (
            <div className="relative flex items-center" style={{ width: columnWidths.workflowStatus }}>
              <div className="px-1 py-2 flex-1">Status</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('workflowStatus', e)} />
            </div>
          )}
          {visibleColumns.includes('keyResult') && (
            <div className="relative flex items-center" style={{ width: columnWidths.keyResult }}>
              <div className="px-1 py-2 flex-1">KR</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('keyResult', e)} />
            </div>
          )}
          {visibleColumns.includes('parent') && (
            <div className="relative flex items-center" style={{ width: columnWidths.parent }}>
              <div className="px-1 py-2 flex-1">Parent</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('parent', e)} />
            </div>
          )}
          {visibleColumns.includes('team') && (
            <div className="relative flex items-center" style={{ width: columnWidths.team }}>
              <div className="px-1 py-2 flex-1">Team</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('team', e)} />
            </div>
          )}
          {visibleColumns.includes('owner') && (
            <div className="relative flex items-center" style={{ width: columnWidths.owner }}>
              <div className="px-1 py-2 flex-1">Owner</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('owner', e)} />
            </div>
          )}
          {visibleColumns.includes('assignee') && (
            <div className="relative flex items-center" style={{ width: columnWidths.assignee }}>
              <div className="px-1 py-2 flex-1">Assignee</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('assignee', e)} />
            </div>
          )}
          {visibleColumns.includes('period') && (
            <div className="relative flex items-center" style={{ width: columnWidths.period }}>
              <div className="px-1 py-2 flex-1">Period</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('period', e)} />
            </div>
          )}
          {visibleColumns.includes('nextStepDate') && (
            <div className="relative flex items-center" style={{ width: columnWidths.nextStepDate }}>
              <div className="px-1 py-2 flex-1">Next Date</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('nextStepDate', e)} />
            </div>
          )}
          {visibleColumns.includes('nextStep') && (
            <div className="relative flex items-center" style={{ width: columnWidths.nextStep }}>
              <div className="px-1 py-2 flex-1">Next Step</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('nextStep', e)} />
            </div>
          )}
          {visibleColumns.includes('storyPoints') && (
            <div className="relative flex items-center" style={{ width: columnWidths.storyPoints }}>
              <div className="px-1 py-2 flex-1 text-right">SP</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('storyPoints', e)} />
            </div>
          )}
          {visibleColumns.includes('valuePoints') && (
            <div className="relative flex items-center" style={{ width: columnWidths.valuePoints }}>
              <div className="px-1 py-2 flex-1 text-right">VP</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('valuePoints', e)} />
            </div>
          )}
          {visibleColumns.includes('tags') && (
            <div className="relative flex items-center" style={{ width: columnWidths.tags }}>
              <div className="px-1 py-2 flex-1">Tags</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('tags', e)} />
            </div>
          )}
          {visibleColumns.includes('progress') && (
            <div className="relative flex items-center" style={{ width: columnWidths.progress }}>
              <div className="px-2 py-2 flex-1 text-right">Progress</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('progress', e)} />
            </div>
          )}
          {visibleColumns.includes('resolved') && (
            <div className="relative flex items-center" style={{ width: columnWidths.resolved }}>
              <div className="px-1 py-2 flex-1">Resolved</div>
              <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handleResizeStart('resolved', e)} />
            </div>
          )}
        </div>
        <div>
          {companyObjectives.map((obj: Objective) => (
            <CompactObjectiveCard key={obj.id} objective={obj} filteredObjectiveIds={filteredObjectiveIds} directlyMatchingIds={directlyMatchingIds} visibleColumnsOverride={visibleColumnsOverride} />
          ))}
          {teamObjectives.map((obj: Objective) => (
            <CompactObjectiveCard key={obj.id} objective={obj} filteredObjectiveIds={filteredObjectiveIds} directlyMatchingIds={directlyMatchingIds} visibleColumnsOverride={visibleColumnsOverride} />
          ))}
          {individualObjectives.map((obj: Objective) => (
            <CompactObjectiveCard key={obj.id} objective={obj} filteredObjectiveIds={filteredObjectiveIds} directlyMatchingIds={directlyMatchingIds} visibleColumnsOverride={visibleColumnsOverride} />
          ))}
        </div>
      </div>
    </section>
  );
}
