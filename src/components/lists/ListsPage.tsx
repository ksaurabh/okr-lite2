import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { useOKRStore, type OKRStore, type ColumnKey, COLUMN_LABELS } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { ObjectiveFilterPanel } from '../filters/ObjectiveFilterPanel';
import { CompactObjectiveCard } from '../objectives/CompactObjectiveCard';
import { AddToPlanBookmark } from '../plans/AddToPlanBookmark';
import { renderGroupedPeriodOptions } from '../../utils/periodOptions';
import { ObjectiveForm } from '../objectives/ObjectiveForm';
import { SlidePane } from '../common/SlidePane';
import {
  buildPeriodAncestorLookup,
  buildPeriodDescendantLookup,
  buildTeamDescendantLookup,
  buildObjectiveDescendantLookup,
  filterObjectives,
} from '../../utils/objectiveFilters';
import type { Objective, ObjectiveLevel, Period, Team, Tag, User, WorkflowStatus } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';

const NO_CHILDREN_PLAN_LIST: Set<string> = new Set();

type View = 'dashboard' | 'objectives' | 'checklist' | 'progress' | 'updates' | 'lists' | 'logwork' | 'teams' | 'periods' | 'tags' | 'settings' | 'admin';

interface ListsPageProps {
  onViewChange: (view: View) => void;
}

const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  todo: 'To Do',
  backlog: 'In Backlog',
  planning: 'In Planning',
  in_progress: 'In Progress',
  acceptance: 'In Acceptance',
  done: 'Done',
  archived: 'Archived',
};

const WORKFLOW_STATUS_OPTIONS: { value: WorkflowStatus; label: string }[] = [
  { value: 'todo', label: 'To Do' },
  { value: 'backlog', label: 'In Backlog' },
  { value: 'planning', label: 'In Planning' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'acceptance', label: 'In Acceptance' },
  { value: 'done', label: 'Done' },
  { value: 'archived', label: 'Archived' },
];

const LIST_COLORS = [
  '#6b7280', // gray
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
];

const LIST_COLUMN_WIDTHS_KEY = 'okr-list-column-widths';

interface ListColumnWidths {
  name: number;
  parent: number;
  owner: number;
  assignee: number;
  status: number;
}

const DEFAULT_LIST_COLUMN_WIDTHS: ListColumnWidths = {
  name: 300,
  parent: 200,
  owner: 150,
  assignee: 150,
  status: 120,
};

function loadListColumnWidths(): ListColumnWidths {
  try {
    const data = localStorage.getItem(LIST_COLUMN_WIDTHS_KEY);
    if (data) {
      return { ...DEFAULT_LIST_COLUMN_WIDTHS, ...JSON.parse(data) };
    }
  } catch {
    // ignore
  }
  return DEFAULT_LIST_COLUMN_WIDTHS;
}

function saveListColumnWidths(widths: ListColumnWidths): void {
  try {
    localStorage.setItem(LIST_COLUMN_WIDTHS_KEY, JSON.stringify(widths));
  } catch {
    // ignore
  }
}

export function ListsPage({ onViewChange }: ListsPageProps) {
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [newListName, setNewListName] = useState('');
  const [newListColor, setNewListColor] = useState(LIST_COLORS[0]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingColorListId, setEditingColorListId] = useState<string | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [isListsCollapsed, setIsListsCollapsed] = useState(false);
  const [columnWidths, setColumnWidths] = useState<ListColumnWidths>(loadListColumnWidths);
  const [resizingColumn, setResizingColumn] = useState<keyof ListColumnWidths | null>(null);
  const planColumnWidths = useOKRStore((state: OKRStore) => state.columnWidths);
  const setPlanColumnWidths = useOKRStore((state: OKRStore) => state.setColumnWidths);
  const [resizingPlanCol, setResizingPlanCol] = useState<ColumnKey | null>(null);
  const planResizeStartX = useRef(0);
  const planResizeStartWidth = useRef(0);
  const handlePlanResizeStart = useCallback((col: ColumnKey, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingPlanCol(col);
    planResizeStartX.current = e.clientX;
    planResizeStartWidth.current = planColumnWidths[col];
  }, [planColumnWidths]);
  useEffect(() => {
    if (!resizingPlanCol) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - planResizeStartX.current;
      const newWidth = Math.max(48, planResizeStartWidth.current + delta);
      setPlanColumnWidths({ [resizingPlanCol]: newWidth });
    };
    const onUp = () => setResizingPlanCol(null);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [resizingPlanCol, setPlanColumnWidths]);
  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const planFocusListId = useOKRStore((state: OKRStore) => state.planFocusListId);
  const setPlanFocusListId = useOKRStore((state: OKRStore) => state.setPlanFocusListId);
  const listViewModes = useOKRStore((state: OKRStore) => state.listViewModes);
  const setListViewMode = useOKRStore((state: OKRStore) => state.setListViewMode);
  const listPlanColumns = useOKRStore((state: OKRStore) => state.listPlanColumns);
  const toggleListPlanColumn = useOKRStore((state: OKRStore) => state.toggleListPlanColumn);
  const listPlanChildView = useOKRStore((state: OKRStore) => state.listPlanChildView);
  const setListPlanChildView = useOKRStore((state: OKRStore) => state.setListPlanChildView);
  const listPlanTreeView = useOKRStore((state: OKRStore) => state.listPlanTreeView);
  const setListPlanTreeView = useOKRStore((state: OKRStore) => state.setListPlanTreeView);
  const listPlanCurrentView = useOKRStore((state: OKRStore) => state.listPlanCurrentView);
  const setListPlanCurrentView = useOKRStore((state: OKRStore) => state.setListPlanCurrentView);
  const [collapsedCardIds, setCollapsedCardIds] = useState<Set<string>>(new Set());
  const [firstColStatusFilter, setFirstColStatusFilter] = useState<WorkflowStatus[]>([]);
  const [thirdColStatusFilter, setThirdColStatusFilter] = useState<WorkflowStatus[]>([]);
  const [firstColOwnerFilter, setFirstColOwnerFilter] = useState<string[]>([]);
  const [firstColAssigneeFilter, setFirstColAssigneeFilter] = useState<string[]>([]);
  const [firstColPeriodFilter, setFirstColPeriodFilter] = useState<string[]>([]);
  const [thirdColOwnerFilter, setThirdColOwnerFilter] = useState<string[]>([]);
  const [thirdColAssigneeFilter, setThirdColAssigneeFilter] = useState<string[]>([]);
  const [thirdColPeriodFilter, setThirdColPeriodFilter] = useState<string[]>([]);
  const [treeStatusFilter, setTreeStatusFilter] = useState<WorkflowStatus[]>([]);
  const [treeOwnerFilter, setTreeOwnerFilter] = useState<string[]>([]);
  const [treeAssigneeFilter, setTreeAssigneeFilter] = useState<string[]>([]);
  const [treePeriodFilter, setTreePeriodFilter] = useState<string[]>([]);
  const [treeShowDoneArchived, setTreeShowDoneArchived] = useState(false);
  const [editingPlanName, setEditingPlanName] = useState(false);
  const [planNameDraft, setPlanNameDraft] = useState('');
  const togglePlanSelectedObjective = (obj: Objective) => {
    setPlanSelectedObjective(prev => prev?.id === obj.id ? null : obj);
  };
  const [expandedListRowIds, setExpandedListRowIds] = useState<Set<string>>(new Set());
  const toggleListRowExpanded = (id: string) => {
    setExpandedListRowIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const [showCreateChildPlan, setShowCreateChildPlan] = useState(false);
  const [newChildPlanName, setNewChildPlanName] = useState('');
  const [newChildPlanOwnerId, setNewChildPlanOwnerId] = useState('');
  const [newChildPlanPeriodId, setNewChildPlanPeriodId] = useState('');
  const [newChildPlanLevel, setNewChildPlanLevel] = useState<ObjectiveLevel | ''>('');
  const [newChildPlanError, setNewChildPlanError] = useState<string | null>(null);
  const [creatingChildPlan, setCreatingChildPlan] = useState(false);
  const [showTreeFilter, setShowTreeFilter] = useState(false);
  const treeFilterRef = useRef<HTMLDivElement>(null);
  const [collapsedFilterSections, setCollapsedFilterSections] = useState<Set<string>>(new Set(['first:Owner', 'first:Assignee', 'first:Period', 'third:Owner', 'third:Assignee', 'third:Period', 'tree:Owner', 'tree:Assignee', 'tree:Period']));
  const toggleFilterSection = (key: string) => {
    setCollapsedFilterSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const passesFilters = (
    obj: Objective,
    statuses: WorkflowStatus[],
    ownerIds: string[],
    assigneeIds: string[],
    periodIds: string[],
  ): boolean => {
    if (statuses.length > 0 && !statuses.includes(obj.workflowStatus || 'todo')) return false;
    if (ownerIds.length > 0 && (!obj.ownerId || !ownerIds.includes(obj.ownerId))) return false;
    if (assigneeIds.length > 0 && (!obj.assigneeId || !assigneeIds.includes(obj.assigneeId))) return false;
    if (periodIds.length > 0 && !periodIds.includes(obj.periodId)) return false;
    return true;
  };

  const filterCount = (
    statuses: WorkflowStatus[],
    ownerIds: string[],
    assigneeIds: string[],
    periodIds: string[],
  ): number => statuses.length + ownerIds.length + assigneeIds.length + periodIds.length;
  const [showFirstColFilter, setShowFirstColFilter] = useState(false);
  const [showThirdColFilter, setShowThirdColFilter] = useState(false);
  const firstColFilterRef = useRef<HTMLDivElement>(null);
  const thirdColFilterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showFirstColFilter) return;
    const onClick = (e: MouseEvent) => {
      if (firstColFilterRef.current && !firstColFilterRef.current.contains(e.target as Node)) setShowFirstColFilter(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showFirstColFilter]);

  useEffect(() => {
    if (!showThirdColFilter) return;
    const onClick = (e: MouseEvent) => {
      if (thirdColFilterRef.current && !thirdColFilterRef.current.contains(e.target as Node)) setShowThirdColFilter(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showThirdColFilter]);

  useEffect(() => {
    if (!showTreeFilter) return;
    const onClick = (e: MouseEvent) => {
      if (treeFilterRef.current && !treeFilterRef.current.contains(e.target as Node)) setShowTreeFilter(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showTreeFilter]);

  const toggleCardCollapsed = (id: string) => {
    setCollapsedCardIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const [showListPlanColumnMenu, setShowListPlanColumnMenu] = useState(false);
  const listPlanColumnMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showListPlanColumnMenu) return;
    const onClick = (e: MouseEvent) => {
      if (listPlanColumnMenuRef.current && !listPlanColumnMenuRef.current.contains(e.target as Node)) {
        setShowListPlanColumnMenu(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showListPlanColumnMenu]);
  const listsEarly = useOKRStore((state: OKRStore) => state.lists);
  const sharedPlansEarly = useOKRStore((state: OKRStore) => state.sharedPlans);
  const selectedListEarly = listsEarly.find(l => l.id === selectedListId) || sharedPlansEarly.find(l => l.id === selectedListId);
  const isReadOnlyListEarly = !!(selectedListEarly && (selectedListEarly as List & { createdByEmail?: string }).createdByEmail);
  const isListPlanMode = !!selectedListId;
  const [planSelectedObjective, setPlanSelectedObjective] = useState<Objective | null>(null);
  const [planTopLevel, setPlanTopLevel] = useState(false);
  const [showObjectiveTree, setShowObjectiveTree] = useState<boolean>(() => {
    try { const v = localStorage.getItem('okr-list-plan-show-tree'); return v == null ? true : v === 'true'; } catch { return true; }
  });
  const setShowObjectiveTreePersist = (v: boolean) => {
    setShowObjectiveTree(v);
    try { localStorage.setItem('okr-list-plan-show-tree', String(v)); } catch { /* ignore */ }
  };
  const [topLevelFilterOn, setTopLevelFilterOn] = useState(false);
  const [planSelectedChildListId, setPlanSelectedChildListId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedListId) { setPlanSelectedChildListId(null); return; }
    const currentChildIsValid = planSelectedChildListId && listsEarly.some(l => l.id === planSelectedChildListId && l.parentId === selectedListId);
    if (currentChildIsValid) return;
    const candidates = listsEarly.filter(l => l.parentId === selectedListId && l.ownerId && l.periodId);
    const tsOf = (l: List) => (l.updatedAt || l.createdAt || '');
    const mostRecent = candidates.length > 0
      ? candidates.reduce((a, b) => (tsOf(a) >= tsOf(b) ? a : b))
      : null;
    setPlanSelectedChildListId(mostRecent ? mostRecent.id : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedListId, listsEarly]);

  const [listPlanLeftWidth, setListPlanLeftWidth] = useState<number>(() => {
    try {
      const v = localStorage.getItem('okr-list-plan-left-width');
      const n = v ? parseFloat(v) : NaN;
      return Number.isFinite(n) && n >= 10 && n <= 70 ? n : 20;
    } catch { return 20; }
  });
  const [listPlanRightWidth, setListPlanRightWidth] = useState<number>(() => {
    try {
      const v = localStorage.getItem('okr-list-plan-right-width');
      const n = v ? parseFloat(v) : NaN;
      return Number.isFinite(n) && n >= 10 && n <= 70 ? n : 20;
    } catch { return 20; }
  });
  const listPlanSplitRef = useRef<HTMLDivElement>(null);
  const rightStackRef = useRef<HTMLDivElement>(null);
  const draggingListPlanSep = useRef<'left' | 'right' | 'horiz' | null>(null);
  const [listPlanRightTopHeight, setListPlanRightTopHeight] = useState<number>(() => {
    try {
      const v = localStorage.getItem('okr-list-plan-right-top-height');
      const n = v ? parseFloat(v) : NaN;
      return Number.isFinite(n) && n >= 15 && n <= 85 ? n : 40;
    } catch { return 40; }
  });
  const [listPlanTotalHeight, setListPlanTotalHeight] = useState<number>(() => {
    try {
      const v = localStorage.getItem('okr-list-plan-total-height');
      const n = v ? parseFloat(v) : NaN;
      return Number.isFinite(n) && n >= 300 && n <= 4000 ? n : 600;
    } catch { return 600; }
  });
  const heightDragRef = useRef<{ startY: number; startH: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!heightDragRef.current) return;
      const next = Math.max(300, Math.min(4000, heightDragRef.current.startH + (e.clientY - heightDragRef.current.startY)));
      setListPlanTotalHeight(next);
    };
    const onUp = () => {
      if (!heightDragRef.current) return;
      heightDragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem('okr-list-plan-total-height', String(Math.round(listPlanTotalHeight))); } catch { /* ignore */ }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [listPlanTotalHeight]);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!draggingListPlanSep.current || !listPlanSplitRef.current) return;
      const rect = listPlanSplitRef.current.getBoundingClientRect();
      if (draggingListPlanSep.current === 'left') {
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        const clamped = Math.max(10, Math.min(80, pct));
        setListPlanLeftWidth(clamped);
      } else if (draggingListPlanSep.current === 'horiz') {
        const stack = rightStackRef.current;
        if (!stack) return;
        const sr = stack.getBoundingClientRect();
        const pct = ((e.clientY - sr.top) / sr.height) * 100;
        const clamped = Math.max(15, Math.min(85, pct));
        setListPlanRightTopHeight(clamped);
      }
    };
    const handleUp = () => {
      if (!draggingListPlanSep.current) return;
      draggingListPlanSep.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem('okr-list-plan-left-width', String(Math.round(listPlanLeftWidth * 10) / 10));
        localStorage.setItem('okr-list-plan-right-top-height', String(Math.round(listPlanRightTopHeight * 10) / 10));
      } catch { /* ignore */ }
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [listPlanLeftWidth, listPlanRightTopHeight]);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(0);

  const lists = useOKRStore((state: OKRStore) => state.lists);
  const objectives = useOKRStore((state: OKRStore) => state.objectives);
  const periods = useOKRStore((state: OKRStore) => state.periods);
  const teams = useOKRStore((state: OKRStore) => state.teams);
  const tags = useOKRStore((state: OKRStore) => state.tags);

  const cellValueForCard = useCallback((o: Objective, col: ColumnKey): string => {
    switch (col) {
      case 'title': return o.title;
      case 'level': return o.level || '—';
      case 'type': return o.type || '—';
      case 'workflowStatus': return o.workflowStatus || 'todo';
      case 'parent': return o.parentId ? (objectives.find(x => x.id === o.parentId)?.title || '—') : '—';
      case 'team': return o.teamId ? (teams.find(t => t.id === o.teamId)?.name || '—') : '—';
      case 'owner': return o.ownerId ? (orgUsers.find(u => u.id === o.ownerId)?.name || o.ownerId) : '—';
      case 'assignee': return o.assigneeId ? (orgUsers.find(u => u.id === o.assigneeId)?.name || o.assigneeId) : '—';
      case 'period': return periods.find(p => p.id === o.periodId)?.name || '—';
      case 'nextStepDate': return o.nextStepDate || '—';
      case 'nextStep': return o.nextStep || '—';
      case 'storyPoints': return o.storyPoints?.toString() ?? '—';
      case 'valuePoints': return o.valuePoints?.toString() ?? '—';
      case 'tags': return o.tagIds?.map(id => tags.find(t => t.id === id)?.name || '').filter(Boolean).join(', ') || '—';
      case 'progress': return `${Math.round(o.progress)}%`;
      case 'resolved': return o.resolvedAt || '—';
      case 'keyResult': return o.isKeyResult ? 'Yes' : 'No';
      default: return '';
    }
  }, [objectives, teams, orgUsers, periods, tags]);
  const filterPeriodIds = useOKRStore((state: OKRStore) => state.filterPeriodIds);
  const filterTagIds = useOKRStore((state: OKRStore) => state.filterTagIds);
  const filterTeamIds = useOKRStore((state: OKRStore) => state.filterTeamIds);
  const filterTypes = useOKRStore((state: OKRStore) => state.filterTypes);
  const filterTypeNotSet = useOKRStore((state: OKRStore) => state.filterTypeNotSet);
  const filterOwnerIds = useOKRStore((state: OKRStore) => state.filterOwnerIds);
  const filterOwnerOperator = useOKRStore((state: OKRStore) => state.filterOwnerOperator);
  const filterAssigneeIds = useOKRStore((state: OKRStore) => state.filterAssigneeIds);
  const filterAssigneeOperator = useOKRStore((state: OKRStore) => state.filterAssigneeOperator);
  const filterAssigneeNotSet = useOKRStore((state: OKRStore) => state.filterAssigneeNotSet);
  const filterNextStepDate = useOKRStore((state: OKRStore) => state.filterNextStepDate);
  const filterLevels = useOKRStore((state: OKRStore) => state.filterLevels);
  const filterWorkflowStatuses = useOKRStore((state: OKRStore) => state.filterWorkflowStatuses);
  const filterKeyResultsOnly = useOKRStore((state: OKRStore) => state.filterKeyResultsOnly);
  const filterObjectiveId = useOKRStore((state: OKRStore) => state.filterObjectiveId);
  const filterRootObjectiveId = useOKRStore((state: OKRStore) => state.filterRootObjectiveId);
  const filterListIds = useOKRStore((state: OKRStore) => state.filterListIds);
  const openChildrenOnly = useOKRStore((state: OKRStore) => state.openChildrenOnly);
  const fetchLists = useOKRStore((state: OKRStore) => state.fetchLists);
  const createList = useOKRStore((state: OKRStore) => state.createList);
  const deleteList = useOKRStore((state: OKRStore) => state.deleteList);
  const renameList = useOKRStore((state: OKRStore) => state.renameList);
  const setListOwner = useOKRStore((state: OKRStore) => state.setListOwner);
  const setListPeriod = useOKRStore((state: OKRStore) => state.setListPeriod);
  const setListLevel = useOKRStore((state: OKRStore) => state.setListLevel);
  const updateListColor = useOKRStore((state: OKRStore) => state.updateListColor);
  const removeItemFromList = useOKRStore((state: OKRStore) => state.removeItemFromList);
  const updateListParent = useOKRStore((state: OKRStore) => state.updateListParent);
  const addItemToList = useOKRStore((state: OKRStore) => state.addItemToList);
  const cloneObjective = useOKRStore((state: OKRStore) => state.cloneObjective);
  const deleteObjective = useOKRStore((state: OKRStore) => state.deleteObjective);
  const addObjective = useOKRStore((state: OKRStore) => state.addObjective);
  const setHighlightObjectiveId = useOKRStore((state: OKRStore) => state.setHighlightObjectiveId);
  const setForcedExpandedIds = useOKRStore((state: OKRStore) => state.setForcedExpandedIds);
  const [editingCardObjective, setEditingCardObjective] = useState<Objective | null>(null);
  const [quickAddCardParentId, setQuickAddCardParentId] = useState<string | null>(null);
  const [quickAddCardTitle, setQuickAddCardTitle] = useState('');
  const reorderListItems = useOKRStore((state: OKRStore) => state.reorderListItems);
  const setFilterRootObjective = useOKRStore((state: OKRStore) => state.setFilterRootObjective);
  const clearAllFilters = useOKRStore((state: OKRStore) => state.clearAllFilters);
  const updateObjective = useOKRStore((state: OKRStore) => state.updateObjective);

  const { user, organization, isSuperAdmin, isOrgAdmin } = useAuth();
  const userEmail = user?.email || '';
  const orgId = organization?.id || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;

  // Filter panel local state (mirrors ObjectiveTree defaults)
  const [filterSearchQuery, setFilterSearchQuery] = useState('');
  const [includeAncestorPeriods, setIncludeAncestorPeriods] = useState(false);
  const [includeChildPeriods, setIncludeChildPeriods] = useState(true);
  const [includeChildTeams, setIncludeChildTeams] = useState(true);
  const [showChildren, setShowChildren] = useState(false);
  const [directChildrenOnly, setDirectChildrenOnly] = useState(false);
  const [filterLastUpdated, setFilterLastUpdated] = useState<string | null>(null);

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

  const ancestorPeriodLookup = useMemo(() => buildPeriodAncestorLookup(orgPeriods), [orgPeriods]);
  const descendantPeriodLookup = useMemo(() => buildPeriodDescendantLookup(orgPeriods), [orgPeriods]);
  const descendantTeamLookup = useMemo(() => buildTeamDescendantLookup(orgTeams), [orgTeams]);
  const descendantObjectiveLookup = useMemo(() => buildObjectiveDescendantLookup(orgObjectives), [orgObjectives]);

  const filteredObjectiveIdSet = useMemo(() => {
    const { filtered } = filterObjectives({
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
      searchQuery: filterSearchQuery,
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
    });
    return new Set(filtered.map(o => o.id));
  }, [orgObjectives, lists, filterPeriodIds, filterTagIds, filterTeamIds, filterTypes, filterTypeNotSet, filterOwnerIds, filterOwnerOperator, filterAssigneeIds, filterAssigneeOperator, filterAssigneeNotSet, filterNextStepDate, filterLevels, filterWorkflowStatuses, filterKeyResultsOnly, filterObjectiveId, filterRootObjectiveId, filterListIds, filterLastUpdated, filterSearchQuery, includeAncestorPeriods, includeChildPeriods, includeChildTeams, showChildren, directChildrenOnly, openChildrenOnly, ancestorPeriodLookup, descendantPeriodLookup, descendantTeamLookup, descendantObjectiveLookup]);

  const [editingStatusObjId, setEditingStatusObjId] = useState<string | null>(null);
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());

  const toggleExpandRow = (objectiveId: string) => {
    setExpandedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(objectiveId)) next.delete(objectiveId);
      else next.add(objectiveId);
      return next;
    });
  };

  const getDirectChildren = useCallback((objectiveId: string): Objective[] => {
    return objectives.filter(o => o.parentId === objectiveId);
  }, [objectives]);

  const handleStatusChange = async (objectiveId: string, newStatus: WorkflowStatus, currentStatus: WorkflowStatus | undefined) => {
    setEditingStatusObjId(null);
    if (newStatus !== currentStatus) {
      await updateObjective(objectiveId, { workflowStatus: newStatus }, userEmail);
    }
  };

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  useEffect(() => {
    try {
      const pending = localStorage.getItem('okr-lists-pending-selection');
      if (pending && lists.some(l => l.id === pending)) {
        setSelectedListId(pending);
        localStorage.removeItem('okr-lists-pending-selection');
      }
    } catch { /* ignore */ }
  }, [lists]);

  useEffect(() => {
    if (planFocusListId && (lists.some(l => l.id === planFocusListId) || sharedPlansEarly.some(l => l.id === planFocusListId))) {
      setSelectedListId(planFocusListId);
    }
  }, [planFocusListId, lists, sharedPlansEarly]);

  // Fetch users for owner/assignee display
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch(`${API_URL}/api/users`, { credentials: 'include' });
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

  // Column resize handlers
  const handleResizeStart = useCallback((column: keyof ListColumnWidths, e: React.MouseEvent) => {
    e.preventDefault();
    setResizingColumn(column);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = columnWidths[column];
  }, [columnWidths]);

  useEffect(() => {
    if (!resizingColumn) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      const newWidth = Math.max(100, resizeStartWidth.current + delta);
      setColumnWidths(prev => {
        const updated = { ...prev, [resizingColumn]: newWidth };
        saveListColumnWidths(updated);
        return updated;
      });
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
  }, [resizingColumn]);

  const sharedPlans = sharedPlansEarly;
  const selectedList = selectedListEarly;
  const isReadOnlyList = isReadOnlyListEarly;

  const showPathInTree = (targetId: string) => {
    const byId = new Map(objectives.map(o => [o.id, o]));
    const target = byId.get(targetId);
    if (!target) return;
    const currentItemIds = new Set(selectedList?.items.map(it => it.objectiveId) || []);
    const chain: Objective[] = [target];
    let cur: Objective | undefined = target;
    while (cur?.parentId) {
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      chain.push(parent);
      if (currentItemIds.has(parent.id)) break;
      cur = parent;
    }
    const root = chain[chain.length - 1];
    setPlanSelectedObjective(root);
    setForcedExpandedIds(chain.map(o => o.id));
    setHighlightObjectiveId(targetId);
  };

  const handleCreateList = async () => {
    if (!newListName.trim()) return;
    const list = await createList(newListName.trim(), newListColor);
    if (list) {
      setNewListName('');
      setNewListColor(LIST_COLORS[0]);
      setIsCreating(false);
      setSelectedListId(list.id);
    }
  };

  const handleColorChange = async (listId: string, color: string) => {
    await updateListColor(listId, color);
    setEditingColorListId(null);
  };

  const handleDeleteList = async (listId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this list?')) {
      await deleteList(listId);
      if (selectedListId === listId) {
        setSelectedListId(null);
      }
    }
  };

  const handleRenameList = async () => {
    if (!editingListId || !editingName.trim()) return;
    await renameList(editingListId, editingName.trim());
    setEditingListId(null);
    setEditingName('');
  };

  const handleRemoveItem = async (objectiveId: string) => {
    if (!selectedListId) return;
    await removeItemFromList(selectedListId, objectiveId);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, objectiveId: string) => {
    setDraggedItemId(objectiveId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetObjectiveId: string) => {
    e.preventDefault();
    if (!draggedItemId || !selectedList || draggedItemId === targetObjectiveId) {
      setDraggedItemId(null);
      return;
    }

    const items = [...selectedList.items];
    const draggedIndex = items.findIndex(i => i.objectiveId === draggedItemId);
    const targetIndex = items.findIndex(i => i.objectiveId === targetObjectiveId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedItemId(null);
      return;
    }

    // Remove dragged item and insert at target position
    const [draggedItem] = items.splice(draggedIndex, 1);
    items.splice(targetIndex, 0, draggedItem);

    // Update order values
    const reorderedItems = items.map((item, index) => ({
      objectiveId: item.objectiveId,
      order: index,
    }));

    await reorderListItems(selectedListId!, reorderedItems);
    setDraggedItemId(null);
  };

  const handleDragEnd = () => {
    setDraggedItemId(null);
  };

  const reorderItemsInList = async (listId: string, draggedObjectiveId: string, targetObjectiveId: string) => {
    const list = lists.find(l => l.id === listId);
    if (!list || draggedObjectiveId === targetObjectiveId) return;
    const items = [...list.items].sort((a, b) => a.order - b.order);
    const draggedIndex = items.findIndex(i => i.objectiveId === draggedObjectiveId);
    const targetIndex = items.findIndex(i => i.objectiveId === targetObjectiveId);
    if (draggedIndex === -1 || targetIndex === -1) return;
    const [moved] = items.splice(draggedIndex, 1);
    items.splice(targetIndex, 0, moved);
    const reordered = items.map((item, idx) => ({ objectiveId: item.objectiveId, order: idx }));
    await reorderListItems(listId, reordered);
  };

  const getObjective = useCallback((objectiveId: string): Objective | undefined => {
    return objectives.find(o => o.id === objectiveId);
  }, [objectives]);

  const getUserName = useCallback((userId: string | undefined): string => {
    if (!userId) return '-';
    const user = orgUsers.find(u => u.id === userId);
    return user?.name || '-';
  }, [orgUsers]);

  const handleNavigateToObjective = useCallback((objectiveId: string) => {
    clearAllFilters();
    setFilterRootObjective(objectiveId);
    onViewChange('objectives');
  }, [clearAllFilters, setFilterRootObjective, onViewChange]);

  // Sort items by order
  const sortedItems = selectedList?.items
    ? [...selectedList.items].sort((a, b) => a.order - b.order)
    : [];

  const buildAssigneeCounts = (objs: Objective[]) => {
    const m = new Map<string, number>();
    for (const o of objs) if (o.assigneeId) m.set(o.assigneeId, (m.get(o.assigneeId) || 0) + 1);
    return m;
  };

  const planFocus = planFocusListId ? (lists.find(l => l.id === planFocusListId) || sharedPlans.find(l => l.id === planFocusListId)) : null;

  const [panel1EditMode, setPanel1EditMode] = useState(false);
  const [panel3EditMode, setPanel3EditMode] = useState(false);
  const [cardEditingId, setCardEditingId] = useState<string | null>(null);
  const [cardDraft, setCardDraft] = useState<Partial<Objective>>({});
  const beginCardEdit = (objId: string) => { setCardEditingId(objId); setCardDraft({}); };
  const cancelCardEdit = () => { setCardEditingId(null); setCardDraft({}); };
  const commitCardEdit = async (objId: string) => {
    if (Object.keys(cardDraft).length > 0) await updateObjective(objId, cardDraft, userEmail);
    setCardEditingId(null);
    setCardDraft({});
  };

  const CardCellEditor = ({ obj, col, draft, setDraft }: { obj: Objective; col: ColumnKey; draft?: Partial<Objective>; setDraft?: (updates: Partial<Objective>) => void }) => {
    const useDraft = !!setDraft;
    const valueOf = <K extends keyof Objective>(key: K): Objective[K] | undefined => {
      if (useDraft && draft && key in draft) return draft[key] as Objective[K];
      return obj[key];
    };
    const save = (updates: Partial<Objective>) => {
      if (useDraft && setDraft) setDraft(updates);
      else updateObjective(obj.id, updates, userEmail);
    };
    const cls = 'w-full text-xs px-1 py-0.5 border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500';
    switch (col) {
      case 'workflowStatus':
        return (
          <select value={valueOf('workflowStatus') || 'todo'} onChange={(e) => save({ workflowStatus: e.target.value as WorkflowStatus })} className={cls}>
            {WORKFLOW_STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        );
      case 'level':
        return (
          <select value={valueOf('level') || 'company'} onChange={(e) => save({ level: e.target.value as Objective['level'] })} className={cls}>
            <option value="company">Company</option>
            <option value="team">Team</option>
            <option value="individual">Individual</option>
          </select>
        );
      case 'owner':
        return (
          <select value={valueOf('ownerId') || ''} onChange={(e) => save({ ownerId: e.target.value || undefined })} className={cls}>
            <option value="">—</option>
            {[...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </select>
        );
      case 'assignee':
        return (
          <select value={valueOf('assigneeId') || ''} onChange={(e) => save({ assigneeId: e.target.value || undefined })} className={cls}>
            <option value="">—</option>
            {[...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </select>
        );
      case 'period':
        return (
          <select value={valueOf('periodId') || ''} onChange={(e) => save({ periodId: e.target.value || undefined })} className={cls}>
            <option value="">—</option>
            {[...orgPeriods].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '')).map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        );
      case 'team':
        return (
          <select value={valueOf('teamId') || ''} onChange={(e) => save({ teamId: e.target.value || undefined })} className={cls}>
            <option value="">—</option>
            {[...orgTeams].sort((a, b) => a.name.localeCompare(b.name)).map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        );
      case 'keyResult':
        return (
          <select value={valueOf('isKeyResult') ? 'yes' : 'no'} onChange={(e) => save({ isKeyResult: e.target.value === 'yes' })} className={cls}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        );
      case 'nextStepDate':
        return (
          <input type="date" value={valueOf('nextStepDate') || ''} onChange={(e) => save({ nextStepDate: e.target.value || undefined })} className={cls} />
        );
      case 'nextStep':
        return (
          <input
            type="text"
            defaultValue={valueOf('nextStep') || ''}
            onBlur={(e) => { const v = e.target.value; const prev = valueOf('nextStep') || ''; if (v !== prev) save({ nextStep: v || undefined }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className={cls}
          />
        );
      case 'storyPoints':
      case 'valuePoints': {
        const v = (valueOf(col) as number | null | undefined);
        return (
          <input
            type="text"
            inputMode="decimal"
            defaultValue={v == null ? '' : String(v)}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const prev = v ?? null;
              if (raw === '') {
                if (prev !== null) save({ [col]: null } as unknown as Partial<Objective>);
              } else {
                const n = Number(raw);
                if (Number.isFinite(n) && n !== prev) save({ [col]: n } as Partial<Objective>);
              }
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className={cls}
          />
        );
      }
      default:
        return <span className="text-gray-700">{cellValueForCard(obj, col)}</span>;
    }
  };

  const JiraTicketButton = ({ obj }: { obj: Objective }) => {
    const [busy, setBusy] = useState(false);
    if (obj.jiraEpicKey) {
      return (
        <a
          href={obj.jiraEpicUrl || '#'}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 flex-shrink-0"
          title={`Tracked in Jira as ${obj.jiraEpicKey}`}
        >
          {obj.jiraEpicKey}
        </a>
      );
    }
    return (
      <button
        onClick={async (e) => {
          e.stopPropagation();
          if (busy) return;
          setBusy(true);
          try {
            const res = await fetch(`${API_URL}/api/jira/create-epic`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ summary: obj.title, description: obj.description, objectiveId: obj.id }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { window.alert(`Failed to create Jira ticket: ${data.error || res.status}`); return; }
            await updateObjective(obj.id, { jiraEpicKey: data.key, jiraEpicUrl: data.url }, userEmail);
          } catch (err) {
            window.alert(`Failed to create Jira ticket: ${String(err)}`);
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold rounded border border-gray-300 bg-gray-50 text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 flex-shrink-0 disabled:opacity-50"
        title="Create Jira ticket"
        disabled={busy}
      >
        {busy ? '…' : 'J+'}
      </button>
    );
  };

  const childPlansOf = (parentId: string | undefined) => parentId ? lists.filter(l => l.parentId === parentId && l.ownerId && l.periodId) : [];
  const ChildPlanBadges = ({ objectiveId }: { objectiveId: string }) => {
    const parent = selectedList;
    if (!parent) return null;
    const children = childPlansOf(parent.id);
    const memberOf = children.filter(c => c.items.some(it => it.objectiveId === objectiveId));
    if (memberOf.length === 0) return null;
    return (
      <span className="flex items-center gap-1 flex-shrink-0">
        {memberOf.map(c => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-gray-200 bg-gray-50 text-gray-700 max-w-[120px] truncate"
            title={`In child plan: ${c.name}`}
          >
            <span className="w-1.5 h-1.5 rounded-sm flex-shrink-0" style={{ backgroundColor: c.color || '#6b7280' }} />
            <span className="truncate">{c.name}</span>
          </span>
        ))}
      </span>
    );
  };

  const renderObjectiveCard = (obj: Objective, depth: number): React.ReactNode => {
    const children = orgObjectives.filter(o => o.parentId === obj.id);
    const hasChildren = children.length > 0;
    const isCollapsed = depth === 0 ? collapsedCardIds.has(obj.id) : !collapsedCardIds.has(obj.id);
    const targetListId = planTopLevel ? selectedList?.id : planSelectedChildListId;
    return (
      <div key={obj.id} style={{ marginLeft: depth * 16 }}>
        <div className="group border border-gray-200 rounded p-2 bg-white">
          <div className="flex items-center gap-1">
            {hasChildren ? (
              <button
                onClick={() => toggleCardCollapsed(obj.id)}
                className="text-gray-400 hover:text-gray-700 flex-shrink-0"
                title={isCollapsed ? 'Show children' : 'Hide children'}
              >
                <svg className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ) : (
              <span className="w-3 flex-shrink-0" />
            )}
            <div className="text-sm font-medium text-gray-900 break-words flex-1 min-w-0" title={obj.title}>{obj.title}</div>
            <ChildPlanBadges objectiveId={obj.id} />
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <AddToPlanBookmark objectiveId={obj.id} size="sm" />
              <button
                onClick={() => setPlanSelectedObjective(obj)}
                className="p-0.5 text-gray-400 hover:text-blue-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                title="Focus on this objective"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <circle cx="12" cy="12" r="5" fill="currentColor" />
                </svg>
              </button>
            </div>
          </div>
          {listPlanColumns.length > 0 && (
            <div className="mt-1 grid gap-x-3 gap-y-0.5 pl-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              {listPlanColumns.map(col => (
                <div key={col} className="text-xs text-gray-600">
                  <span className="text-gray-400">{COLUMN_LABELS[col]}=</span>
                  <span className="text-gray-700">{cellValueForCard(obj, col)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {hasChildren && !isCollapsed && (
          <div className="mt-1 space-y-1">
            {children.map(child => renderObjectiveCard(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };
  const planFocusEffective = planFocus && planFocus.id === selectedListId ? planFocus : null;

  return (
    <div className="flex h-full -ml-5">
      {/* Lists sidebar (hidden in plan focus mode) */}
      {!planFocusEffective && (
      <div className={`border-r border-gray-200 bg-gray-50 flex flex-col h-full max-h-full transition-all duration-200 ${isListsCollapsed ? 'w-6' : 'w-64'}`}>
        {isListsCollapsed ? (
          /* Collapsed sidebar */
          <div className="flex flex-col items-center py-2">
            <button
              onClick={() => setIsListsCollapsed(false)}
              className="p-0.5 text-gray-400 hover:text-gray-600 rounded"
              title="Expand sidebar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        ) : (
          /* Expanded sidebar */
          <>
            <div className="p-4 border-b border-gray-200 flex-shrink-0 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Lists</h2>
              <button
                onClick={() => setIsListsCollapsed(true)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
                title="Collapse sidebar"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>

            {/* New List button at top */}
            <div className="p-2 border-b border-gray-200 flex-shrink-0">
              {isCreating ? (
                <div className="p-2 bg-white rounded-md border border-gray-200">
                  <input
                    type="text"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateList();
                      if (e.key === 'Escape') {
                        setIsCreating(false);
                        setNewListName('');
                        setNewListColor(LIST_COLORS[0]);
                      }
                    }}
                    placeholder="List name"
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    autoFocus
                  />
                  <div className="flex items-center gap-1 mt-2">
                    {LIST_COLORS.map(color => (
                      <button
                        key={color}
                        onClick={() => setNewListColor(color)}
                        className={`w-5 h-5 rounded-full border-2 ${newListColor === color ? 'border-gray-800' : 'border-transparent'}`}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      onClick={() => {
                        setIsCreating(false);
                        setNewListName('');
                        setNewListColor(LIST_COLORS[0]);
                      }}
                      className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateList}
                      disabled={!newListName.trim()}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      Create
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsCreating(true)}
                  className="w-full px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-md flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New List
                </button>
              )}
            </div>

            {/* Scrollable list of lists */}
            <div className="flex-1 overflow-auto p-2 min-h-0">
              {lists.length === 0 ? (
                <p className="text-sm text-gray-500 p-2">No lists yet</p>
              ) : (
                <div className="space-y-1">
                  {lists.map(list => (
                    <div
                      key={list.id}
                      onClick={() => setSelectedListId(list.id)}
                      className={`flex items-center justify-between px-3 py-2 rounded-md cursor-pointer group ${
                        selectedListId === list.id
                          ? 'bg-blue-100 text-blue-800'
                          : 'hover:bg-gray-100 text-gray-700'
                      }`}
                    >
                      {editingListId === list.id ? (
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={handleRenameList}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameList();
                            if (e.key === 'Escape') {
                              setEditingListId(null);
                              setEditingName('');
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 px-1 py-0.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                          autoFocus
                        />
                      ) : (
                        <>
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingColorListId(editingColorListId === list.id ? null : list.id);
                              }}
                              className="w-3 h-3 rounded-full mr-2 flex-shrink-0"
                              style={{ backgroundColor: list.color || '#6b7280' }}
                              title="Change color"
                            />
                            {editingColorListId === list.id && (
                              <div
                                className="absolute left-0 top-5 z-10 bg-white rounded-md shadow-lg border border-gray-200 p-1.5 flex gap-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {LIST_COLORS.map(color => (
                                  <button
                                    key={color}
                                    onClick={() => handleColorChange(list.id, color)}
                                    className={`w-5 h-5 rounded-full border-2 ${list.color === color ? 'border-gray-800' : 'border-transparent hover:border-gray-400'}`}
                                    style={{ backgroundColor: color }}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                          <span className="text-sm truncate flex-1">{list.name}</span>
                          <span className="text-xs text-gray-500 mr-2">{list.items.length}</span>
                          <div className="hidden group-hover:flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingListId(list.id);
                                setEditingName(list.name);
                              }}
                              className="p-1 text-gray-400 hover:text-gray-600"
                              title="Rename"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => handleDeleteList(list.id, e)}
                              className="p-1 text-gray-400 hover:text-red-600"
                              title="Delete"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      )}

      {/* List content */}
      <div className="flex-1 overflow-auto">
        {planFocusEffective && (
          <div className="px-4 pt-3 pb-2 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-white">
            <button
              onClick={() => { setPlanFocusListId(null); onViewChange('plans'); }}
              className="text-xs text-blue-600 hover:text-blue-700 mb-1"
            >
              ← Back to Plans
            </button>
            <div className="flex items-center gap-3 flex-wrap">
              {editingPlanName && !isReadOnlyList ? (
                <input
                  type="text"
                  autoFocus
                  value={planNameDraft}
                  onChange={(e) => setPlanNameDraft(e.target.value)}
                  onBlur={async () => {
                    const n = planNameDraft.trim();
                    if (n && n !== planFocusEffective.name) await renameList(planFocusEffective.id, n);
                    setEditingPlanName(false);
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      const n = planNameDraft.trim();
                      if (n && n !== planFocusEffective.name) await renameList(planFocusEffective.id, n);
                      setEditingPlanName(false);
                    } else if (e.key === 'Escape') {
                      setEditingPlanName(false);
                    }
                  }}
                  className="text-xl font-semibold text-gray-900 border border-gray-300 rounded px-2 py-0.5"
                />
              ) : (
                <h2
                  onClick={() => { if (!isReadOnlyList) { setPlanNameDraft(planFocusEffective.name); setEditingPlanName(true); } }}
                  className={`text-xl font-semibold text-gray-900 ${!isReadOnlyList ? 'cursor-text hover:bg-blue-100 px-1 -mx-1 rounded' : ''}`}
                  title={!isReadOnlyList ? 'Click to rename' : undefined}
                >
                  {planFocusEffective.name}
                </h2>
              )}
              {!isReadOnlyList && (
                <button
                  onClick={async () => {
                    if (window.confirm(`Delete plan "${planFocusEffective.name}"? This removes the list and its items.`)) {
                      await deleteList(planFocusEffective.id);
                      setPlanFocusListId(null);
                      onViewChange('plans');
                    }
                  }}
                  className="p-1 text-gray-400 hover:text-red-600 rounded"
                  title="Delete this plan"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
              {(() => {
                const parent = planFocusEffective.parentId
                  ? (lists.find(l => l.id === planFocusEffective.parentId) || sharedPlans.find(l => l.id === planFocusEffective.parentId))
                  : null;
                if (!parent) return null;
                return (
                  <span className="text-xs text-gray-500">
                    <span className="text-gray-400">Parent:</span>{' '}
                    <button
                      onClick={() => { setPlanFocusListId(parent.id); setSelectedListId(parent.id); }}
                      className="text-blue-600 hover:text-blue-700 hover:underline"
                      title="Open parent plan"
                    >
                      {parent.name}
                    </button>
                  </span>
                );
              })()}
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <span className="text-gray-400">Owner:</span>
                {isReadOnlyList ? (
                  <span className="text-gray-700">{orgUsers.find(u => u.id === planFocusEffective.ownerId)?.name || orgUsers.find(u => u.id === planFocusEffective.ownerId)?.email || planFocusEffective.ownerId || '—'}</span>
                ) : (
                  <select
                    value={planFocusEffective.ownerId || ''}
                    onChange={(e) => setListOwner(planFocusEffective.id, e.target.value)}
                    className="border border-gray-300 rounded px-1 py-0.5 text-xs bg-white"
                  >
                    <option value="">— None —</option>
                    {[...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
                      <option key={u.id} value={u.id}>{u.name || u.email}</option>
                    ))}
                  </select>
                )}
              </span>
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <span className="text-gray-400">Period:</span>
                {isReadOnlyList ? (
                  <span className="text-gray-700">{periods.find(p => p.id === planFocusEffective.periodId)?.name || '—'}</span>
                ) : (
                  <select
                    value={planFocusEffective.periodId || ''}
                    onChange={(e) => setListPeriod(planFocusEffective.id, e.target.value)}
                    className="border border-gray-300 rounded px-1 py-0.5 text-xs bg-white"
                  >
                    <option value="">— None —</option>
                    {renderGroupedPeriodOptions(periods)}
                  </select>
                )}
              </span>
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <span className="text-gray-400">Level:</span>
                {isReadOnlyList ? (
                  <span className="text-gray-700 capitalize">{planFocusEffective.level || '—'}</span>
                ) : (
                  <select
                    value={planFocusEffective.level || ''}
                    onChange={(e) => setListLevel(planFocusEffective.id, e.target.value as ObjectiveLevel | '')}
                    className="border border-gray-300 rounded px-1 py-0.5 text-xs bg-white capitalize"
                  >
                    <option value="">— None —</option>
                    <option value="company">Company</option>
                    <option value="team">Team</option>
                    <option value="individual">Individual</option>
                  </select>
                )}
              </span>
              {(() => {
                const children = lists.filter(l => l.parentId === planFocusEffective.id && l.ownerId && l.periodId);
                if (children.length === 0) return null;
                return (
                  <span className="text-xs text-gray-500 flex items-center gap-1 flex-wrap">
                    <span className="text-gray-400">Children:</span>
                    {children.map((c, i) => (
                      <span key={c.id} className="flex items-center">
                        <button
                          onClick={() => { setPlanFocusListId(c.id); setSelectedListId(c.id); }}
                          className="text-blue-600 hover:text-blue-700 hover:underline"
                          title="Open child plan"
                        >
                          {c.name}
                        </button>
                        {i < children.length - 1 && <span className="text-gray-300 ml-1">,</span>}
                      </span>
                    ))}
                  </span>
                );
              })()}
            </div>
          </div>
        )}
        {selectedList ? (
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              {!planFocusEffective ? (
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-gray-900">{selectedList.name}</h2>
                  {isListPlanMode && selectedList.level && (
                    <span className="px-2 py-0.5 text-xs rounded border border-gray-300 bg-gray-50 text-gray-700 capitalize" title="Plan level">
                      {selectedList.level}
                    </span>
                  )}
                </div>
              ) : <span />}
              <div className="flex items-center gap-2">
                {isListPlanMode && !planTopLevel && !isReadOnlyList && (
                  <>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Child list</label>
                    <select
                      value={planSelectedChildListId || ''}
                      onChange={(e) => setPlanSelectedChildListId(e.target.value || null)}
                      className="px-2 py-1 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">— None —</option>
                      {lists.filter(l => l.parentId === selectedList.id).map(child => (
                        <option key={child.id} value={child.id}>{child.name} ({child.items.length})</option>
                      ))}
                    </select>
                    {planSelectedChildListId && (() => {
                      const childList = lists.find(l => l.id === planSelectedChildListId);
                      if (!childList) return null;
                      return (
                        <button
                          onClick={async () => {
                            if (window.confirm(`Delete child list "${childList.name}"? This removes the list and its items.`)) {
                              await deleteList(childList.id);
                              setPlanSelectedChildListId(null);
                            }
                          }}
                          className="p-1 text-gray-400 hover:text-red-600 rounded"
                          title={`Delete child list "${childList.name}"`}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      );
                    })()}
                    <button
                      onClick={async () => {
                        const name = window.prompt('Child list name:');
                        if (name && name.trim()) {
                          const created = await createList(name.trim(), undefined, selectedList.id);
                          if (created) setPlanSelectedChildListId(created.id);
                        }
                      }}
                      className="flex items-center gap-1 px-3 py-1 text-sm text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Create child list
                    </button>
                    <button
                      onClick={() => {
                        setNewChildPlanName('');
                        setNewChildPlanOwnerId(selectedList.ownerId || '');
                        setNewChildPlanPeriodId(selectedList.periodId || '');
                        setNewChildPlanLevel(selectedList.level || '');
                        setNewChildPlanError(null);
                        setShowCreateChildPlan(true);
                      }}
                      className="flex items-center gap-1 px-3 py-1 text-sm text-blue-700 border border-blue-300 rounded bg-blue-50 hover:bg-blue-100"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Create child plan
                    </button>
                  </>
                )}
                {isListPlanMode && (
                  <>
                    <div ref={listPlanColumnMenuRef} className="relative">
                      <button
                        onClick={() => setShowListPlanColumnMenu(!showListPlanColumnMenu)}
                        className="flex items-center gap-1 px-3 py-1 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
                        title="Choose columns"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                        Columns
                      </button>
                      {showListPlanColumnMenu && (
                        <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[180px]">
                          {(Object.keys(COLUMN_LABELS) as ColumnKey[])
                            .filter(c => c !== 'title')
                            .map(col => (
                              <label key={col} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={listPlanColumns.includes(col)}
                                  onChange={() => toggleListPlanColumn(col)}
                                  className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                {COLUMN_LABELS[col]}
                              </label>
                            ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
                {isListPlanMode && !planTopLevel && !isReadOnlyList && (
                  <>
                    <select
                      value=""
                      onChange={async (e) => {
                        const id = e.target.value;
                        if (!id) return;
                        await updateListParent(id, selectedList.id);
                        setPlanSelectedChildListId(id);
                      }}
                      className="px-2 py-1 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      title="Attach an existing list as a child of this list"
                    >
                      <option value="">Add existing as child…</option>
                      {(() => {
                        const descendantIds = new Set<string>();
                        const collect = (id: string) => {
                          lists.forEach(l => {
                            if (l.parentId === id && !descendantIds.has(l.id)) {
                              descendantIds.add(l.id);
                              collect(l.id);
                            }
                          });
                        };
                        collect(selectedList.id);
                        return lists
                          .filter(l => l.id !== selectedList.id && l.parentId !== selectedList.id && !descendantIds.has(l.id))
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map(l => <option key={l.id} value={l.id}>{l.name}</option>);
                      })()}
                    </select>
                  </>
                )}
                {isListPlanMode && (
                  <label className="inline-flex items-center gap-1 text-xs text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={planTopLevel}
                      onChange={(e) => setPlanTopLevel(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Top Level
                  </label>
                )}
                {isListPlanMode && (
                  <label className="inline-flex items-center gap-1 text-xs text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showObjectiveTree}
                      onChange={(e) => setShowObjectiveTreePersist(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Objective Tree
                  </label>
                )}
                {isReadOnlyList && (
                  <span className="px-2 py-0.5 text-xs rounded bg-amber-50 border border-amber-300 text-amber-700">Read-only · shared by {((selectedList as List & { createdByEmail?: string }).createdByEmail) || 'another user'}</span>
                )}
              </div>
            </div>

            {!isListPlanMode && (
            <div className="mb-4">
              <ObjectiveFilterPanel
                orgObjectives={orgObjectives}
                orgPeriods={orgPeriods}
                orgTeams={orgTeams}
                orgTags={orgTags}
                orgUsers={orgUsers}
                searchQuery={filterSearchQuery}
                setSearchQuery={setFilterSearchQuery}
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
              />
            </div>
            )}

            {isListPlanMode ? (
              <>
              <div ref={listPlanSplitRef} className="flex relative" style={{ height: listPlanTotalHeight }}>
                {!planTopLevel && (
                <div className="border border-gray-200 rounded-lg overflow-y-auto bg-white" style={{ width: `${listPlanLeftWidth}%` }}>
                  <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
                    <span className="text-xs font-semibold text-gray-700 truncate flex-1" title={selectedList.name}>Parent/Current Plan ({selectedList.name})</span>
                    {(() => {
                      const total = sortedItems.reduce((sum, it) => { const o = getObjective(it.objectiveId); return sum + (o?.valuePoints ?? 0); }, 0);
                      return <span className="text-[10px] text-gray-500 flex-shrink-0" title="Total VP across items in this plan">Total VP: <span className="font-semibold text-gray-700">{total}</span></span>;
                    })()}
                    <div ref={firstColFilterRef} className="relative">
                      <button
                        onClick={() => setShowFirstColFilter(!showFirstColFilter)}
                        className="px-2 py-0.5 text-[10px] border border-gray-300 rounded bg-white text-gray-600 hover:bg-gray-50"
                        title="Filter"
                      >
                        Filter{filterCount(firstColStatusFilter, firstColOwnerFilter, firstColAssigneeFilter, firstColPeriodFilter) > 0 ? ` (${filterCount(firstColStatusFilter, firstColOwnerFilter, firstColAssigneeFilter, firstColPeriodFilter)})` : ''}
                      </button>
                      {showFirstColFilter && (() => {
                        const panel1Objs = sortedItems.map(it => getObjective(it.objectiveId)).filter((o): o is Objective => !!o);
                        const panel1AssigneeCounts = buildAssigneeCounts(panel1Objs);
                        return (
                        <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[200px] max-h-96 overflow-y-auto">
                          {(['Status', 'Owner', 'Assignee', 'Period'] as const).map((section) => {
                            const key = `first:${section}`;
                            const collapsed = collapsedFilterSections.has(key);
                            const count = section === 'Status' ? firstColStatusFilter.length : section === 'Owner' ? firstColOwnerFilter.length : section === 'Assignee' ? firstColAssigneeFilter.length : firstColPeriodFilter.length;
                            return (
                              <div key={section}>
                                <button
                                  onClick={() => toggleFilterSection(key)}
                                  className="w-full flex items-center justify-between px-3 py-1 text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50 hover:bg-gray-100 border-t border-gray-100"
                                >
                                  <span className="flex items-center gap-1">
                                    <span>{collapsed ? '▸' : '▾'}</span>
                                    {section}
                                    {count > 0 && <span className="ml-1 text-blue-600 normal-case">({count})</span>}
                                  </span>
                                </button>
                                {!collapsed && section === 'Status' && WORKFLOW_STATUS_OPTIONS.map((opt) => (
                                  <label key={opt.value} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={firstColStatusFilter.includes(opt.value)}
                                      onChange={() => setFirstColStatusFilter(firstColStatusFilter.includes(opt.value) ? firstColStatusFilter.filter(s => s !== opt.value) : [...firstColStatusFilter, opt.value])}
                                      className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    {opt.label}
                                  </label>
                                ))}
                                {!collapsed && section === 'Owner' && [...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
                                  <label key={u.id} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={firstColOwnerFilter.includes(u.id)}
                                      onChange={() => setFirstColOwnerFilter(firstColOwnerFilter.includes(u.id) ? firstColOwnerFilter.filter(x => x !== u.id) : [...firstColOwnerFilter, u.id])}
                                      className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    {u.name || u.email}
                                  </label>
                                ))}
                                {!collapsed && section === 'Assignee' && [...orgUsers]
                                  .map(u => ({ u, count: panel1AssigneeCounts.get(u.id) || 0 }))
                                  .filter(({ u, count }) => count > 0 || firstColAssigneeFilter.includes(u.id))
                                  .sort((a, b) => (a.u.name || a.u.email).localeCompare(b.u.name || b.u.email))
                                  .map(({ u, count }) => (
                                    <label key={u.id} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={firstColAssigneeFilter.includes(u.id)}
                                        onChange={() => setFirstColAssigneeFilter(firstColAssigneeFilter.includes(u.id) ? firstColAssigneeFilter.filter(x => x !== u.id) : [...firstColAssigneeFilter, u.id])}
                                        className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                      />
                                      <span className="flex-1">{u.name || u.email}</span>
                                      <span className="text-gray-400">({count})</span>
                                    </label>
                                  ))}
                                {!collapsed && section === 'Period' && [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((p: Period) => (
                                  <label key={p.id} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={firstColPeriodFilter.includes(p.id)}
                                      onChange={() => setFirstColPeriodFilter(firstColPeriodFilter.includes(p.id) ? firstColPeriodFilter.filter(x => x !== p.id) : [...firstColPeriodFilter, p.id])}
                                      className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    {p.name}
                                  </label>
                                ))}
                              </div>
                            );
                          })}
                          {filterCount(firstColStatusFilter, firstColOwnerFilter, firstColAssigneeFilter, firstColPeriodFilter) > 0 && (
                            <button
                              onClick={() => { setFirstColStatusFilter([]); setFirstColOwnerFilter([]); setFirstColAssigneeFilter([]); setFirstColPeriodFilter([]); }}
                              className="w-full text-left px-3 py-1 text-xs text-blue-600 hover:bg-gray-50 border-t border-gray-100 sticky bottom-0 bg-white"
                            >
                              Clear all
                            </button>
                          )}
                        </div>
                        );
                      })()}
                    </div>
                    <div className="inline-flex border border-gray-300 rounded overflow-hidden">
                      <button
                        onClick={() => setListPlanCurrentView('table')}
                        className={`px-2 py-0.5 text-[10px] ${listPlanCurrentView === 'table' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        Table
                      </button>
                      <button
                        onClick={() => setListPlanCurrentView('cards')}
                        className={`px-2 py-0.5 text-[10px] border-l border-gray-300 ${listPlanCurrentView === 'cards' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        Cards
                      </button>
                      <button
                        onClick={() => setListPlanCurrentView('list')}
                        className={`px-2 py-0.5 text-[10px] border-l border-gray-300 ${listPlanCurrentView === 'list' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        List
                      </button>
                    </div>
                    {listPlanCurrentView === 'cards' && (
                      <button
                        onClick={() => setPanel1EditMode(v => !v)}
                        className={`px-2 py-0.5 text-[10px] border rounded ${panel1EditMode ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        {panel1EditMode ? 'View' : 'Edit'}
                      </button>
                    )}
                  </div>
                  {listPlanCurrentView === 'list' ? (
                    <div>
                      {sortedItems.map((item) => {
                        const obj = getObjective(item.objectiveId);
                        if (!obj) return null;
                        if (!passesFilters(obj, firstColStatusFilter, firstColOwnerFilter, firstColAssigneeFilter, firstColPeriodFilter)) return null;
                        const selected = planSelectedObjective?.id === obj.id;
                        const isExpanded = expandedListRowIds.has(obj.id);
                        return (
                          <div key={item.objectiveId}>
                            <div
                              onClick={() => togglePlanSelectedObjective(obj)}
                              draggable
                              onDragStart={(e) => { e.dataTransfer.setData('text/plain', `${selectedList.id}|${obj.id}`); e.dataTransfer.effectAllowed = 'move'; }}
                              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                              onDrop={(e) => { e.preventDefault(); const [lid, draggedId] = e.dataTransfer.getData('text/plain').split('|'); if (lid === selectedList.id && draggedId) reorderItemsInList(selectedList.id, draggedId, obj.id); }}
                              className={`group flex items-center gap-1 px-3 py-1 text-sm cursor-pointer border-b border-gray-100 ${selected ? 'bg-blue-50 text-blue-900' : 'hover:bg-gray-50 text-gray-800'}`}
                              title={obj.title}
                            >
                              <span className="text-gray-300 group-hover:text-gray-500 flex-shrink-0 cursor-grab active:cursor-grabbing" title="Drag to reorder">
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="9" cy="19" r="2" /><circle cx="15" cy="5" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="15" cy="19" r="2" /></svg>
                              </span>
                              <span className="truncate flex-1">{obj.title}</span>
                              <AddToPlanBookmark objectiveId={obj.id} size="sm" />
                              {listPlanColumns.length > 0 && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleListRowExpanded(obj.id); }}
                                  className="text-gray-400 hover:text-gray-700 flex-shrink-0 p-0.5"
                                  title={isExpanded ? 'Hide details' : 'Show details'}
                                >
                                  <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                              )}
                            </div>
                            {isExpanded && listPlanColumns.length > 0 && (
                              <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                                <div className="border border-gray-200 rounded p-2 bg-white">
                                  <div className="grid gap-x-3 gap-y-0.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                                    {listPlanColumns.map(col => (
                                      <div key={col} className="text-xs text-gray-600">
                                        <span className="text-gray-400">{COLUMN_LABELS[col]}: </span>
                                        <span className="text-gray-700">{cellValueForCard(obj, col)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : listPlanCurrentView === 'cards' ? (
                    <div className="p-2 space-y-2">
                      {sortedItems.map((item) => {
                        const obj = getObjective(item.objectiveId);
                        if (!obj) return null;
                        if (!passesFilters(obj, firstColStatusFilter, firstColOwnerFilter, firstColAssigneeFilter, firstColPeriodFilter)) return null;
                        const selected = planSelectedObjective?.id === obj.id;
                        return (
                          <div
                            key={item.objectiveId}
                            onClick={() => togglePlanSelectedObjective(obj)}
                            draggable
                            onDragStart={(e) => { e.dataTransfer.setData('text/plain', `${selectedList.id}|${obj.id}`); e.dataTransfer.effectAllowed = 'move'; }}
                            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const data = e.dataTransfer.getData('text/plain');
                              const [listId, draggedId] = data.split('|');
                              if (listId === selectedList.id && draggedId) {
                                reorderItemsInList(selectedList.id, draggedId, obj.id);
                              }
                            }}
                            className={`w-full text-left border rounded p-2 cursor-grab active:cursor-grabbing ${selected ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                          >
                            <div className="flex items-start gap-1">
                              <div className="text-sm font-medium text-gray-900 break-words flex-1 min-w-0" title={obj.title}>{obj.title}</div>
                              <ChildPlanBadges objectiveId={obj.id} />
                              <AddToPlanBookmark objectiveId={obj.id} size="sm" />
                              <JiraTicketButton obj={obj} />
                              <button
                                onClick={(e) => { e.stopPropagation(); if (cardEditingId === obj.id) cancelCardEdit(); else beginCardEdit(obj.id); }}
                                className={`p-1 rounded flex-shrink-0 ${cardEditingId === obj.id ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}
                                title={cardEditingId === obj.id ? 'Cancel edit' : 'Edit card'}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                            </div>
                            {listPlanColumns.length > 0 && (
                              <div className="mt-1 grid gap-x-3 gap-y-0.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }} onClick={(e) => e.stopPropagation()}>
                                {listPlanColumns.map(col => (
                                  <div key={col} className="text-xs text-gray-600">
                                    <span className="text-gray-400">{COLUMN_LABELS[col]}=</span>
                                    {panel1EditMode || cardEditingId === obj.id ? (
                                      <CardCellEditor obj={obj} col={col} draft={cardEditingId === obj.id ? cardDraft : undefined} setDraft={cardEditingId === obj.id ? (u) => setCardDraft(prev => ({ ...prev, ...u })) : undefined} />
                                    ) : (
                                      <span className="text-gray-700">{cellValueForCard(obj, col)}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {cardEditingId === obj.id && (
                              <div className="mt-2 flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); cancelCardEdit(); }}
                                  className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); commitCardEdit(obj.id); }}
                                  className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                                >
                                  OK
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={`overflow-x-auto ${resizingPlanCol ? 'select-none' : ''}`}>
                      <div className="min-w-max">
                        <div className="flex items-center bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
                          <div className="relative flex items-center px-2 py-2 flex-shrink-0" style={{ width: planColumnWidths.title, minWidth: 150 }}>
                            <div className="flex-1">{COLUMN_LABELS.title}</div>
                            <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handlePlanResizeStart('title', e)} />
                          </div>
                          {(Object.keys(COLUMN_LABELS) as ColumnKey[])
                            .filter(col => col !== 'title' && listPlanColumns.includes(col))
                            .map(col => (
                              <div key={col} className="relative flex items-center" style={{ width: planColumnWidths[col] }}>
                                <div className="px-1 py-2 flex-1">{COLUMN_LABELS[col]}</div>
                                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handlePlanResizeStart(col, e)} />
                              </div>
                            ))}
                        </div>
                        {sortedItems.map((item) => {
                          const obj = getObjective(item.objectiveId);
                          if (!obj) return null;
                          if (!passesFilters(obj, firstColStatusFilter, firstColOwnerFilter, firstColAssigneeFilter, firstColPeriodFilter)) return null;
                          const selected = planSelectedObjective?.id === obj.id;
                          return (
                            <div key={item.objectiveId} className={selected ? 'bg-blue-50' : ''}>
                              <CompactObjectiveCard
                                objective={obj}
                                depth={0}
                                visibleColumnsOverride={listPlanColumns}
                                defaultCollapsed
                                kebabActions
                                addToPlanBookmark
                                removeFromListId={selectedList.id}
                                reorderInList={{ listId: selectedList.id, onReorder: (d, t) => reorderItemsInList(selectedList.id, d, t) }}
                                filteredObjectiveIds={NO_CHILDREN_PLAN_LIST}
                                onTitleClick={() => togglePlanSelectedObjective(obj)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                )}
                {!planTopLevel && (
                <div
                  onMouseDown={() => {
                    draggingListPlanSep.current = 'left';
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';
                  }}
                  className="w-1 cursor-col-resize bg-gray-200 hover:bg-blue-400 active:bg-blue-500 flex-shrink-0 mx-1"
                  title="Drag to resize"
                />
                )}
                <div ref={rightStackRef} className="flex flex-col-reverse" style={{ width: `${planTopLevel ? 100 : 100 - listPlanLeftWidth}%`, height: '100%' }}>
                {showObjectiveTree && (
                <div className="min-w-0 border border-gray-200 rounded-lg overflow-auto bg-white" style={{ width: '100%', height: `${100 - listPlanRightTopHeight}%` }}>
                  {planTopLevel ? (
                    (() => {
                      const allRoots = orgObjectives.filter(o => !o.parentId).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.title.localeCompare(b.title));
                      const fc = filterCount(firstColStatusFilter, firstColOwnerFilter, firstColAssigneeFilter, firstColPeriodFilter);
                      const roots = topLevelFilterOn && fc > 0
                        ? allRoots.filter(o => passesFilters(o, firstColStatusFilter, firstColOwnerFilter, firstColAssigneeFilter, firstColPeriodFilter))
                        : allRoots;
                      return (
                        <>
                          <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
                            <span className="text-xs font-semibold text-gray-700 truncate flex-1">Objective Tree (Auto Filtered)</span>
                            <div className="inline-flex border border-gray-300 rounded overflow-hidden">
                              <button
                                onClick={() => setListPlanTreeView('table')}
                                className={`px-2 py-0.5 text-[10px] ${listPlanTreeView === 'table' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                              >
                                Table
                              </button>
                              <button
                                onClick={() => setListPlanTreeView('cards')}
                                className={`px-2 py-0.5 text-[10px] border-l border-gray-300 ${listPlanTreeView === 'cards' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                              >
                                Cards
                              </button>
                              <button
                                onClick={() => setListPlanTreeView('list')}
                                className={`px-2 py-0.5 text-[10px] border-l border-gray-300 ${listPlanTreeView === 'list' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                              >
                                List
                              </button>
                            </div>
                            <button
                              onClick={() => setTopLevelFilterOn(!topLevelFilterOn)}
                              className={`px-2 py-0.5 text-[10px] border rounded ${topLevelFilterOn ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
                              title="Toggle filter"
                            >
                              Filter{topLevelFilterOn ? ' on' : ' off'}{fc > 0 ? ` (${fc})` : ''}
                            </button>
                            {topLevelFilterOn && (
                              <div ref={firstColFilterRef} className="relative">
                                <button
                                  onClick={() => setShowFirstColFilter(!showFirstColFilter)}
                                  className="px-2 py-0.5 text-[10px] border border-gray-300 rounded bg-white text-gray-600 hover:bg-gray-50"
                                  title="Edit filter"
                                >
                                  Edit
                                </button>
                                {showFirstColFilter && (() => {
                                  const panel2AssigneeCounts = buildAssigneeCounts(allRoots);
                                  return (
                                  <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[200px] max-h-96 overflow-y-auto">
                                    {(['Status', 'Owner', 'Assignee', 'Period'] as const).map((section) => {
                                      const key = `first:${section}`;
                                      const collapsed = collapsedFilterSections.has(key);
                                      const count = section === 'Status' ? firstColStatusFilter.length : section === 'Owner' ? firstColOwnerFilter.length : section === 'Assignee' ? firstColAssigneeFilter.length : firstColPeriodFilter.length;
                                      return (
                                        <div key={section}>
                                          <button
                                            onClick={() => toggleFilterSection(key)}
                                            className="w-full flex items-center justify-between px-3 py-1 text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50 hover:bg-gray-100 border-t border-gray-100"
                                          >
                                            <span className="flex items-center gap-1">
                                              <span>{collapsed ? '▸' : '▾'}</span>
                                              {section}
                                              {count > 0 && <span className="ml-1 text-blue-600 normal-case">({count})</span>}
                                            </span>
                                          </button>
                                          {!collapsed && section === 'Status' && WORKFLOW_STATUS_OPTIONS.map((opt) => (
                                            <label key={opt.value} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                              <input
                                                type="checkbox"
                                                checked={firstColStatusFilter.includes(opt.value)}
                                                onChange={() => setFirstColStatusFilter(firstColStatusFilter.includes(opt.value) ? firstColStatusFilter.filter(s => s !== opt.value) : [...firstColStatusFilter, opt.value])}
                                                className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                              />
                                              {opt.label}
                                            </label>
                                          ))}
                                          {!collapsed && section === 'Owner' && [...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
                                            <label key={u.id} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                              <input
                                                type="checkbox"
                                                checked={firstColOwnerFilter.includes(u.id)}
                                                onChange={() => setFirstColOwnerFilter(firstColOwnerFilter.includes(u.id) ? firstColOwnerFilter.filter(x => x !== u.id) : [...firstColOwnerFilter, u.id])}
                                                className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                              />
                                              {u.name || u.email}
                                            </label>
                                          ))}
                                          {!collapsed && section === 'Assignee' && [...orgUsers]
                                            .map(u => ({ u, count: panel2AssigneeCounts.get(u.id) || 0 }))
                                            .filter(({ u, count }) => count > 0 || firstColAssigneeFilter.includes(u.id))
                                            .sort((a, b) => (a.u.name || a.u.email).localeCompare(b.u.name || b.u.email))
                                            .map(({ u, count }) => (
                                              <label key={u.id} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                                <input
                                                  type="checkbox"
                                                  checked={firstColAssigneeFilter.includes(u.id)}
                                                  onChange={() => setFirstColAssigneeFilter(firstColAssigneeFilter.includes(u.id) ? firstColAssigneeFilter.filter(x => x !== u.id) : [...firstColAssigneeFilter, u.id])}
                                                  className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                />
                                                <span className="flex-1">{u.name || u.email}</span>
                                                <span className="text-gray-400">({count})</span>
                                              </label>
                                            ))}
                                          {!collapsed && section === 'Period' && [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((p: Period) => (
                                            <label key={p.id} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                              <input
                                                type="checkbox"
                                                checked={firstColPeriodFilter.includes(p.id)}
                                                onChange={() => setFirstColPeriodFilter(firstColPeriodFilter.includes(p.id) ? firstColPeriodFilter.filter(x => x !== p.id) : [...firstColPeriodFilter, p.id])}
                                                className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                              />
                                              {p.name}
                                            </label>
                                          ))}
                                        </div>
                                      );
                                    })}
                                    {fc > 0 && (
                                      <button
                                        onClick={() => { setFirstColStatusFilter([]); setFirstColOwnerFilter([]); setFirstColAssigneeFilter([]); setFirstColPeriodFilter([]); }}
                                        className="w-full text-left px-3 py-1 text-xs text-blue-600 hover:bg-gray-50 border-t border-gray-100 sticky bottom-0 bg-white"
                                      >
                                        Clear all
                                      </button>
                                    )}
                                  </div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                          {roots.length === 0 ? (
                            <div className="p-6 text-center text-sm text-gray-400">No top-level objectives match the filter.</div>
                          ) : listPlanTreeView === 'list' ? (() => {
                            const renderTopLevelRow = (o: Objective, depth: number): React.ReactNode => {
                              const children = orgObjectives.filter(c => c.parentId === o.id);
                              const hasChildren = children.length > 0;
                              const isCollapsed = collapsedCardIds.has(o.id);
                              const isExpanded = expandedListRowIds.has(o.id);
                              return (
                                <div key={o.id}>
                                  <div
                                    onClick={() => togglePlanSelectedObjective(o)}
                                    style={{ paddingLeft: depth * 16 + 12 }}
                                    className={`flex items-center gap-1 py-1 pr-3 text-sm cursor-pointer border-b border-gray-100 ${planSelectedObjective?.id === o.id ? 'bg-blue-50 text-blue-900' : 'hover:bg-gray-50 text-gray-800'}`}
                                    title={o.title}
                                  >
                                    {hasChildren ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); toggleCardCollapsed(o.id); }}
                                        className="text-gray-400 hover:text-gray-700 flex-shrink-0"
                                        title={isCollapsed ? 'Show children' : 'Hide children'}
                                      >
                                        <svg className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                      </button>
                                    ) : (
                                      <span className="w-3 flex-shrink-0" />
                                    )}
                                    <span className="truncate flex-1">{o.title}</span>
                                    <ChildPlanBadges objectiveId={o.id} />
                                    <AddToPlanBookmark objectiveId={o.id} size="sm" />
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setQuickAddCardParentId(o.id); setQuickAddCardTitle(''); }}
                                      className="text-gray-400 hover:text-blue-600 flex-shrink-0 p-0.5"
                                      title="Add child"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                    </button>
                                    {listPlanColumns.length > 0 && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); toggleListRowExpanded(o.id); }}
                                        className="text-gray-400 hover:text-gray-700 flex-shrink-0 p-0.5"
                                        title={isExpanded ? 'Hide details' : 'Show details'}
                                      >
                                        <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                  {isExpanded && listPlanColumns.length > 0 && (
                                    <div style={{ paddingLeft: depth * 16 + 24 }} className="py-2 pr-3 border-b border-gray-100 bg-gray-50">
                                      <div className="border border-gray-200 rounded p-2 bg-white">
                                        <div className="grid gap-x-3 gap-y-0.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                                          {listPlanColumns.map(col => (
                                            <div key={col} className="text-xs text-gray-600">
                                              <span className="text-gray-400">{COLUMN_LABELS[col]}: </span>
                                              <span className="text-gray-700">{cellValueForCard(o, col)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                  {quickAddCardParentId === o.id && (
                                    <div style={{ paddingLeft: depth * 16 + 24 }} className="py-1 pr-3 bg-blue-50 border-b border-gray-100">
                                      <input
                                        type="text"
                                        autoFocus
                                        value={quickAddCardTitle}
                                        onChange={(e) => setQuickAddCardTitle(e.target.value)}
                                        onBlur={() => { if (!quickAddCardTitle.trim()) setQuickAddCardParentId(null); }}
                                        onKeyDown={async (e) => {
                                          if (e.key === 'Enter' && quickAddCardTitle.trim()) {
                                            await addObjective({
                                              title: quickAddCardTitle.trim(),
                                              level: o.level,
                                              parentId: o.id,
                                              periodId: o.periodId,
                                              workflowStatus: 'todo',
                                            }, { orgId, userEmail, shared: o.shared });
                                            setQuickAddCardTitle('');
                                          } else if (e.key === 'Escape') {
                                            setQuickAddCardParentId(null);
                                            setQuickAddCardTitle('');
                                          }
                                        }}
                                        placeholder="New child title (Enter to add, Esc to close)"
                                        className="w-full text-xs px-2 py-1 border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                      />
                                    </div>
                                  )}
                                  {hasChildren && !isCollapsed && children.map(c => renderTopLevelRow(c, depth + 1))}
                                </div>
                              );
                            };
                            return (
                              <div>
                                {roots.map(root => renderTopLevelRow(root, 0))}
                              </div>
                            );
                          })() : listPlanTreeView === 'cards' ? (
                            <div className="p-2 space-y-1">
                              {roots.map(root => renderObjectiveCard(root, 0))}
                            </div>
                          ) : (
                            <div className={`overflow-x-auto ${resizingPlanCol ? 'select-none' : ''}`}>
                              <div className="min-w-max">
                                <div className="flex items-center bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  <div className="relative flex items-center px-2 py-2 flex-shrink-0" style={{ width: planColumnWidths.title, minWidth: 150 }}>
                                    <div className="flex-1">{COLUMN_LABELS.title}</div>
                                    <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handlePlanResizeStart('title', e)} />
                                  </div>
                                  {(Object.keys(COLUMN_LABELS) as ColumnKey[])
                                    .filter(col => col !== 'title' && listPlanColumns.includes(col))
                                    .map(col => (
                                      <div key={col} className="relative flex items-center" style={{ width: planColumnWidths[col] }}>
                                        <div className="px-1 py-2 flex-1">{COLUMN_LABELS[col]}</div>
                                        <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handlePlanResizeStart(col, e)} />
                                      </div>
                                    ))}
                                </div>
                                {roots.map(root => (
                                  <CompactObjectiveCard
                                    key={root.id}
                                    objective={root}
                                    depth={0}
                                    visibleColumnsOverride={listPlanColumns}
                                    quickAddToListId={isReadOnlyList ? undefined : ((planTopLevel ? selectedList.id : planSelectedChildListId) || undefined)}
                                    kebabActions
                                addToPlanBookmark
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()
                  ) : planSelectedObjective ? (() => {
                    const treeFc = filterCount(treeStatusFilter, treeOwnerFilter, treeAssigneeFilter, treePeriodFilter) + (treeShowDoneArchived ? 0 : 1);
                    const doneArchivedSet: Set<WorkflowStatus> = new Set(['done', 'archived']);
                    const treeFilteredIds = (!treeShowDoneArchived || filterCount(treeStatusFilter, treeOwnerFilter, treeAssigneeFilter, treePeriodFilter) > 0)
                      ? new Set(orgObjectives.filter(o => {
                          if (!treeShowDoneArchived && doneArchivedSet.has(o.workflowStatus || 'todo')) return false;
                          return passesFilters(o, treeStatusFilter, treeOwnerFilter, treeAssigneeFilter, treePeriodFilter);
                        }).map(o => o.id))
                      : null;
                    const treePool: Objective[] = (() => {
                      const pool: Objective[] = [];
                      const seen = new Set<string>();
                      const walk = (id: string) => {
                        if (seen.has(id)) return;
                        seen.add(id);
                        const o = orgObjectives.find(x => x.id === id);
                        if (!o) return;
                        if (treeShowDoneArchived || !doneArchivedSet.has(o.workflowStatus || 'todo')) {
                          pool.push(o);
                        }
                        orgObjectives.filter(c => c.parentId === id).forEach(c => walk(c.id));
                      };
                      walk(planSelectedObjective.id);
                      return pool;
                    })();
                    const assigneeCounts = new Map<string, number>();
                    const ownerCounts = new Map<string, number>();
                    const periodCounts = new Map<string, number>();
                    for (const o of treePool) {
                      if (o.assigneeId) assigneeCounts.set(o.assigneeId, (assigneeCounts.get(o.assigneeId) || 0) + 1);
                      if (o.ownerId) ownerCounts.set(o.ownerId, (ownerCounts.get(o.ownerId) || 0) + 1);
                      if (o.periodId) periodCounts.set(o.periodId, (periodCounts.get(o.periodId) || 0) + 1);
                    }
                    return (
                    <>
                      <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
                        <span className="text-xs font-semibold text-gray-700 truncate flex-1">Objective Tree (Auto Filtered)</span>
                        <div className="inline-flex border border-gray-300 rounded overflow-hidden">
                          <button
                            onClick={() => setListPlanTreeView('table')}
                            className={`px-2 py-0.5 text-[10px] ${listPlanTreeView === 'table' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                          >
                            Table
                          </button>
                          <button
                            onClick={() => setListPlanTreeView('cards')}
                            className={`px-2 py-0.5 text-[10px] border-l border-gray-300 ${listPlanTreeView === 'cards' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                          >
                            Cards
                          </button>
                          <button
                            onClick={() => setListPlanTreeView('list')}
                            className={`px-2 py-0.5 text-[10px] border-l border-gray-300 ${listPlanTreeView === 'list' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                          >
                            List
                          </button>
                        </div>
                        <div ref={treeFilterRef} className="relative">
                          <button
                            onClick={() => setShowTreeFilter(!showTreeFilter)}
                            className="px-2 py-0.5 text-[10px] border border-gray-300 rounded bg-white text-gray-600 hover:bg-gray-50"
                            title="Filter the objective tree"
                          >
                            Filter{treeFc > 0 ? ` (${treeFc})` : ''}
                          </button>
                          {showTreeFilter && (
                            <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[200px] max-h-96 overflow-y-auto">
                              <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer border-b border-gray-100">
                                <input
                                  type="checkbox"
                                  checked={treeShowDoneArchived}
                                  onChange={() => setTreeShowDoneArchived(!treeShowDoneArchived)}
                                  className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                Show Done / Archived
                              </label>
                              {(['Status', 'Owner', 'Assignee', 'Period'] as const).map((section) => {
                                const key = `tree:${section}`;
                                const collapsed = collapsedFilterSections.has(key);
                                const count = section === 'Status' ? treeStatusFilter.length : section === 'Owner' ? treeOwnerFilter.length : section === 'Assignee' ? treeAssigneeFilter.length : treePeriodFilter.length;
                                return (
                                  <div key={section}>
                                    <button
                                      onClick={() => toggleFilterSection(key)}
                                      className="w-full flex items-center justify-between px-3 py-1 text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50 hover:bg-gray-100 border-t border-gray-100"
                                    >
                                      <span className="flex items-center gap-1">
                                        <span>{collapsed ? '▸' : '▾'}</span>
                                        {section}
                                        {count > 0 && <span className="ml-1 text-blue-600 normal-case">({count})</span>}
                                      </span>
                                    </button>
                                    {!collapsed && section === 'Status' && WORKFLOW_STATUS_OPTIONS.map((opt) => (
                                      <label key={opt.value} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={treeStatusFilter.includes(opt.value)}
                                          onChange={() => setTreeStatusFilter(treeStatusFilter.includes(opt.value) ? treeStatusFilter.filter(s => s !== opt.value) : [...treeStatusFilter, opt.value])}
                                          className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        {opt.label}
                                      </label>
                                    ))}
                                    {!collapsed && section === 'Owner' && [...orgUsers]
                                      .map(u => ({ u, count: ownerCounts.get(u.id) || 0 }))
                                      .filter(({ u, count }) => count > 0 || treeOwnerFilter.includes(u.id))
                                      .sort((a, b) => (a.u.name || a.u.email).localeCompare(b.u.name || b.u.email))
                                      .map(({ u, count }) => (
                                        <label key={u.id} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={treeOwnerFilter.includes(u.id)}
                                            onChange={() => setTreeOwnerFilter(treeOwnerFilter.includes(u.id) ? treeOwnerFilter.filter(x => x !== u.id) : [...treeOwnerFilter, u.id])}
                                            className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                          />
                                          <span className="flex-1">{u.name || u.email}</span>
                                          <span className="text-gray-400">({count})</span>
                                        </label>
                                      ))}
                                    {!collapsed && section === 'Assignee' && [...orgUsers]
                                      .map(u => ({ u, count: assigneeCounts.get(u.id) || 0 }))
                                      .filter(({ u, count }) => count > 0 || treeAssigneeFilter.includes(u.id))
                                      .sort((a, b) => (a.u.name || a.u.email).localeCompare(b.u.name || b.u.email))
                                      .map(({ u, count }) => (
                                        <label key={u.id} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={treeAssigneeFilter.includes(u.id)}
                                            onChange={() => setTreeAssigneeFilter(treeAssigneeFilter.includes(u.id) ? treeAssigneeFilter.filter(x => x !== u.id) : [...treeAssigneeFilter, u.id])}
                                            className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                          />
                                          <span className="flex-1">{u.name || u.email}</span>
                                          <span className="text-gray-400">({count})</span>
                                        </label>
                                      ))}
                                    {!collapsed && section === 'Period' && [...periods]
                                      .map(p => ({ p, count: periodCounts.get(p.id) || 0 }))
                                      .filter(({ p, count }) => count > 0 || treePeriodFilter.includes(p.id))
                                      .sort((a, b) => a.p.startDate.localeCompare(b.p.startDate))
                                      .map(({ p, count }) => (
                                        <label key={p.id} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={treePeriodFilter.includes(p.id)}
                                            onChange={() => setTreePeriodFilter(treePeriodFilter.includes(p.id) ? treePeriodFilter.filter(x => x !== p.id) : [...treePeriodFilter, p.id])}
                                            className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                          />
                                          <span className="flex-1">{p.name}</span>
                                          <span className="text-gray-400">({count})</span>
                                        </label>
                                      ))}
                                  </div>
                                );
                              })}
                              {treeFc > 0 && (
                                <button
                                  onClick={() => { setTreeStatusFilter([]); setTreeOwnerFilter([]); setTreeAssigneeFilter([]); setTreePeriodFilter([]); setTreeShowDoneArchived(false); }}
                                  className="w-full text-left px-3 py-1 text-xs text-blue-600 hover:bg-gray-50 border-t border-gray-100 sticky bottom-0 bg-white"
                                >
                                  Reset to defaults
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {listPlanTreeView === 'list' ? (() => {
                        const renderRow = (o: Objective, depth: number): React.ReactNode => {
                          const children = orgObjectives.filter(c => c.parentId === o.id && (!treeFilteredIds || treeFilteredIds.has(c.id)));
                          const hasChildren = children.length > 0;
                          const isCollapsed = depth === 0 ? collapsedCardIds.has(o.id) : !collapsedCardIds.has(o.id);
                          const isExpanded = expandedListRowIds.has(o.id);
                          return (
                            <div key={o.id}>
                              <div
                                onClick={() => setPlanSelectedObjective(o)}
                                style={{ paddingLeft: depth * 16 + 8 }}
                                className="flex items-center gap-1 py-1 pr-2 text-sm cursor-pointer hover:bg-gray-50 text-gray-800 border-b border-gray-100"
                                title={o.title}
                              >
                                {hasChildren ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleCardCollapsed(o.id); }}
                                    className="text-gray-400 hover:text-gray-700 flex-shrink-0"
                                    title={isCollapsed ? 'Show children' : 'Hide children'}
                                  >
                                    <svg className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                  </button>
                                ) : (
                                  <span className="w-3 flex-shrink-0" />
                                )}
                                <span className="truncate flex-1">{o.title}</span>
                                <ChildPlanBadges objectiveId={o.id} />
                                <AddToPlanBookmark objectiveId={o.id} size="sm" />
                                <button
                                  onClick={(e) => { e.stopPropagation(); setQuickAddCardParentId(o.id); setQuickAddCardTitle(''); }}
                                  className="text-gray-400 hover:text-blue-600 flex-shrink-0 p-0.5"
                                  title="Add child"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                </button>
                                {listPlanColumns.length > 0 && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleListRowExpanded(o.id); }}
                                    className="text-gray-400 hover:text-gray-700 flex-shrink-0 p-0.5"
                                    title={isExpanded ? 'Hide details' : 'Show details'}
                                  >
                                    <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                              {quickAddCardParentId === o.id && (
                                <div style={{ paddingLeft: depth * 16 + 24 }} className="py-1 pr-3 bg-blue-50 border-b border-gray-100">
                                  <input
                                    type="text"
                                    autoFocus
                                    value={quickAddCardTitle}
                                    onChange={(e) => setQuickAddCardTitle(e.target.value)}
                                    onBlur={() => { if (!quickAddCardTitle.trim()) setQuickAddCardParentId(null); }}
                                    onKeyDown={async (e) => {
                                      if (e.key === 'Enter' && quickAddCardTitle.trim()) {
                                        await addObjective({
                                          title: quickAddCardTitle.trim(),
                                          level: o.level,
                                          parentId: o.id,
                                          periodId: o.periodId,
                                          workflowStatus: 'todo',
                                        }, { orgId, userEmail, shared: o.shared });
                                        setQuickAddCardTitle('');
                                      } else if (e.key === 'Escape') {
                                        setQuickAddCardParentId(null);
                                        setQuickAddCardTitle('');
                                      }
                                    }}
                                    placeholder="New child title (Enter to add, Esc to close)"
                                    className="w-full text-xs px-2 py-1 border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  />
                                </div>
                              )}
                              {isExpanded && listPlanColumns.length > 0 && (
                                <div style={{ paddingLeft: depth * 16 + 24 }} className="py-2 pr-3 border-b border-gray-100 bg-gray-50">
                                  <div className="border border-gray-200 rounded p-2 bg-white">
                                    <div className="grid gap-x-3 gap-y-0.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                                      {listPlanColumns.map(col => (
                                        <div key={col} className="text-xs text-gray-600">
                                          <span className="text-gray-400">{COLUMN_LABELS[col]}: </span>
                                          <span className="text-gray-700">{cellValueForCard(o, col)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )}
                              {hasChildren && !isCollapsed && children.map(c => renderRow(c, depth + 1))}
                            </div>
                          );
                        };
                        return (
                          <div>
                            {renderRow(planSelectedObjective, 0)}
                          </div>
                        );
                      })() : listPlanTreeView === 'cards' ? (() => {
                        const renderCard = (obj: Objective, depth: number): React.ReactNode => {
                          const children = orgObjectives.filter(o => o.parentId === obj.id && (!treeFilteredIds || treeFilteredIds.has(o.id)));
                          const hasChildren = children.length > 0;
                          const isCollapsed = depth === 0 ? collapsedCardIds.has(obj.id) : !collapsedCardIds.has(obj.id);
                          // depth 0 expanded by default; deeper levels collapsed by default;
                          // collapsedCardIds tracks the deviation from default.
                          return (
                            <div key={obj.id} style={{ marginLeft: depth * 16 }}>
                              <div className="group border border-gray-200 rounded p-2 bg-white">
                                <div className="flex items-center gap-1">
                                  {hasChildren ? (
                                    <button
                                      onClick={() => toggleCardCollapsed(obj.id)}
                                      className="text-gray-400 hover:text-gray-700 flex-shrink-0"
                                      title={isCollapsed ? 'Show children' : 'Hide children'}
                                    >
                                      <svg className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                      </svg>
                                    </button>
                                  ) : (
                                    <span className="w-3 flex-shrink-0" />
                                  )}
                                  <div className="text-sm font-medium text-gray-900 break-words flex-1 min-w-0" title={obj.title}>{obj.title}</div>
                                  <ChildPlanBadges objectiveId={obj.id} />
                                  <AddToPlanBookmark objectiveId={obj.id} size="sm" />
                                  <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => setPlanSelectedObjective(obj)}
                                      className="p-0.5 text-gray-400 hover:text-blue-600 rounded"
                                      title="Focus on this objective"
                                    >
                                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                                        <circle cx="12" cy="12" r="5" fill="currentColor" />
                                      </svg>
                                    </button>
                                    <button
                                      onClick={() => { setQuickAddCardParentId(obj.id); setQuickAddCardTitle(''); }}
                                      className="p-0.5 text-gray-400 hover:text-blue-600 rounded"
                                      title="Add child"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                      </svg>
                                    </button>
                                    {obj.link?.url && (
                                      <a
                                        href={obj.link.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-0.5 text-blue-500 hover:text-blue-700 rounded"
                                        title={obj.link.description || obj.link.url}
                                      >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                        </svg>
                                      </a>
                                    )}
                                    <button
                                      onClick={() => setEditingCardObjective(obj)}
                                      className="p-0.5 text-gray-400 hover:text-blue-600 rounded"
                                      title="Edit"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                    </button>
                                    <button
                                      onClick={() => cloneObjective(obj.id, { orgId, userEmail, shared: obj.shared })}
                                      className="p-0.5 text-gray-400 hover:text-blue-500 rounded"
                                      title="Clone"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                      </svg>
                                    </button>
                                    <button
                                      onClick={() => { if (window.confirm(`Delete "${obj.title}"?`)) deleteObjective(obj.id); }}
                                      className="p-0.5 text-gray-400 hover:text-red-600 rounded"
                                      title="Delete"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                                {listPlanColumns.length > 0 && (
                                  <div className="mt-1 grid gap-x-3 gap-y-0.5 pl-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                                    {listPlanColumns.map(col => (
                                      <div key={col} className="text-xs text-gray-600">
                                        <span className="text-gray-400">{COLUMN_LABELS[col]}=</span>
                                        <span className="text-gray-700">{cellValueForCard(obj, col)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {quickAddCardParentId === obj.id && (
                                  <div className="mt-2 pl-4">
                                    <input
                                      type="text"
                                      autoFocus
                                      value={quickAddCardTitle}
                                      onChange={(e) => setQuickAddCardTitle(e.target.value)}
                                      onBlur={() => { if (!quickAddCardTitle.trim()) setQuickAddCardParentId(null); }}
                                      onKeyDown={async (e) => {
                                        if (e.key === 'Enter' && quickAddCardTitle.trim()) {
                                          await addObjective({
                                            title: quickAddCardTitle.trim(),
                                            level: obj.level,
                                            parentId: obj.id,
                                            periodId: obj.periodId,
                                            workflowStatus: 'todo',
                                          }, { orgId, userEmail, shared: obj.shared });
                                          setQuickAddCardTitle('');
                                        } else if (e.key === 'Escape') {
                                          setQuickAddCardParentId(null);
                                          setQuickAddCardTitle('');
                                        }
                                      }}
                                      placeholder="New child title (Enter to add, Esc to close)"
                                      className="w-full text-xs px-2 py-1 border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                  </div>
                                )}
                              </div>
                              {hasChildren && !isCollapsed && (
                                <div className="mt-1 space-y-1">
                                  {children.map(child => renderCard(child, depth + 1))}
                                </div>
                              )}
                            </div>
                          );
                        };
                        return (
                          <div className="p-2 space-y-1">
                            {renderCard(planSelectedObjective, 0)}
                          </div>
                        );
                      })() : (
                        <div className={`overflow-x-auto ${resizingPlanCol ? 'select-none' : ''}`}>
                          <div className="min-w-max">
                            <div className="flex items-center bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
                              <div className="relative flex items-center px-2 py-2 flex-shrink-0" style={{ width: planColumnWidths.title, minWidth: 150 }}>
                                <div className="flex-1">{COLUMN_LABELS.title}</div>
                                <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handlePlanResizeStart('title', e)} />
                              </div>
                              {(Object.keys(COLUMN_LABELS) as ColumnKey[])
                                .filter(col => col !== 'title' && listPlanColumns.includes(col))
                                .map(col => (
                                  <div key={col} className="relative flex items-center" style={{ width: planColumnWidths[col] }}>
                                    <div className="px-1 py-2 flex-1">{COLUMN_LABELS[col]}</div>
                                    <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handlePlanResizeStart(col, e)} />
                                  </div>
                                ))}
                            </div>
                            <CompactObjectiveCard
                              key={planSelectedObjective.id}
                              objective={planSelectedObjective}
                              depth={0}
                              visibleColumnsOverride={listPlanColumns}
                              quickAddToListId={isReadOnlyList ? undefined : ((planTopLevel ? selectedList.id : planSelectedChildListId) || undefined)}
                              filteredObjectiveIds={treeFilteredIds || undefined}
                              kebabActions
                                addToPlanBookmark
                            />
                          </div>
                        </div>
                      )}
                    </>
                    );
                  })() : (
                    <div className="p-6 text-center text-sm text-gray-400">
                      Pick an item on the left to see its objective tree.
                    </div>
                  )}
                </div>
                )}
                {showObjectiveTree && (
                <div
                  onMouseDown={() => {
                    draggingListPlanSep.current = 'horiz';
                    document.body.style.cursor = 'row-resize';
                    document.body.style.userSelect = 'none';
                  }}
                  className="h-1 cursor-row-resize bg-gray-200 hover:bg-blue-400 active:bg-blue-500 flex-shrink-0 my-1 w-full"
                  title="Drag to resize"
                />
                )}
                <div className="border border-gray-200 rounded-lg overflow-y-auto bg-white flex flex-col" style={{ width: '100%', height: showObjectiveTree ? `${listPlanRightTopHeight}%` : '100%' }}>
                  {(planTopLevel || planSelectedChildListId) ? (() => {
                    const child = planTopLevel ? selectedList : lists.find(l => l.id === planSelectedChildListId);
                    if (!child) {
                      return <div className="p-3 text-xs text-gray-400 italic">List not found.</div>;
                    }
                    const selectedSubtreeIds: Set<string> | null = planSelectedObjective ? (() => {
                      const ids = new Set<string>([planSelectedObjective.id]);
                      let added = true;
                      while (added) {
                        added = false;
                        for (const o of orgObjectives) {
                          if (o.parentId && ids.has(o.parentId) && !ids.has(o.id)) {
                            ids.add(o.id);
                            added = true;
                          }
                        }
                      }
                      return ids;
                    })() : null;
                    const passesSelection = (objId: string) => !selectedSubtreeIds || selectedSubtreeIds.has(objId);
                    return (
                      <>
                        <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
                          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: child.color || '#6b7280' }} />
                          <span className="text-xs font-semibold text-gray-700 truncate flex-1" title={child.name}>Child Plan ({child.name})</span>
                          {(() => {
                            const total = (child.items || []).reduce((sum, it) => { const o = getObjective(it.objectiveId); return sum + (o?.valuePoints ?? 0); }, 0);
                            return <span className="text-[10px] text-gray-500 flex-shrink-0" title="Total VP across items in this child plan">Total VP: <span className="font-semibold text-gray-700">{total}</span></span>;
                          })()}
                          <div ref={thirdColFilterRef} className="relative">
                            <button
                              onClick={() => setShowThirdColFilter(!showThirdColFilter)}
                              className="px-2 py-0.5 text-[10px] border border-gray-300 rounded bg-white text-gray-600 hover:bg-gray-50"
                              title="Filter"
                            >
                              Filter{filterCount(thirdColStatusFilter, thirdColOwnerFilter, thirdColAssigneeFilter, thirdColPeriodFilter) > 0 ? ` (${filterCount(thirdColStatusFilter, thirdColOwnerFilter, thirdColAssigneeFilter, thirdColPeriodFilter)})` : ''}
                            </button>
                            {showThirdColFilter && (() => {
                              const panel3Objs = child.items.map(it => getObjective(it.objectiveId)).filter((o): o is Objective => !!o);
                              const panel3AssigneeCounts = buildAssigneeCounts(panel3Objs);
                              return (
                              <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[200px] max-h-96 overflow-y-auto">
                                {(['Status', 'Owner', 'Assignee', 'Period'] as const).map((section) => {
                                  const key = `third:${section}`;
                                  const collapsed = collapsedFilterSections.has(key);
                                  const count = section === 'Status' ? thirdColStatusFilter.length : section === 'Owner' ? thirdColOwnerFilter.length : section === 'Assignee' ? thirdColAssigneeFilter.length : thirdColPeriodFilter.length;
                                  return (
                                    <div key={section}>
                                      <button
                                        onClick={() => toggleFilterSection(key)}
                                        className="w-full flex items-center justify-between px-3 py-1 text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50 hover:bg-gray-100 border-t border-gray-100"
                                      >
                                        <span className="flex items-center gap-1">
                                          <span>{collapsed ? '▸' : '▾'}</span>
                                          {section}
                                          {count > 0 && <span className="ml-1 text-blue-600 normal-case">({count})</span>}
                                        </span>
                                      </button>
                                      {!collapsed && section === 'Status' && WORKFLOW_STATUS_OPTIONS.map((opt) => (
                                        <label key={opt.value} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={thirdColStatusFilter.includes(opt.value)}
                                            onChange={() => setThirdColStatusFilter(thirdColStatusFilter.includes(opt.value) ? thirdColStatusFilter.filter(s => s !== opt.value) : [...thirdColStatusFilter, opt.value])}
                                            className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                          />
                                          {opt.label}
                                        </label>
                                      ))}
                                      {!collapsed && section === 'Owner' && [...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
                                        <label key={u.id} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={thirdColOwnerFilter.includes(u.id)}
                                            onChange={() => setThirdColOwnerFilter(thirdColOwnerFilter.includes(u.id) ? thirdColOwnerFilter.filter(x => x !== u.id) : [...thirdColOwnerFilter, u.id])}
                                            className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                          />
                                          {u.name || u.email}
                                        </label>
                                      ))}
                                      {!collapsed && section === 'Assignee' && [...orgUsers]
                                        .map(u => ({ u, count: panel3AssigneeCounts.get(u.id) || 0 }))
                                        .filter(({ u, count }) => count > 0 || thirdColAssigneeFilter.includes(u.id))
                                        .sort((a, b) => (a.u.name || a.u.email).localeCompare(b.u.name || b.u.email))
                                        .map(({ u, count }) => (
                                          <label key={u.id} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                            <input
                                              type="checkbox"
                                              checked={thirdColAssigneeFilter.includes(u.id)}
                                              onChange={() => setThirdColAssigneeFilter(thirdColAssigneeFilter.includes(u.id) ? thirdColAssigneeFilter.filter(x => x !== u.id) : [...thirdColAssigneeFilter, u.id])}
                                              className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span className="flex-1">{u.name || u.email}</span>
                                            <span className="text-gray-400">({count})</span>
                                          </label>
                                        ))}
                                      {!collapsed && section === 'Period' && [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((p: Period) => (
                                        <label key={p.id} className="flex items-center gap-2 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={thirdColPeriodFilter.includes(p.id)}
                                            onChange={() => setThirdColPeriodFilter(thirdColPeriodFilter.includes(p.id) ? thirdColPeriodFilter.filter(x => x !== p.id) : [...thirdColPeriodFilter, p.id])}
                                            className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                          />
                                          {p.name}
                                        </label>
                                      ))}
                                    </div>
                                  );
                                })}
                                {filterCount(thirdColStatusFilter, thirdColOwnerFilter, thirdColAssigneeFilter, thirdColPeriodFilter) > 0 && (
                                  <button
                                    onClick={() => { setThirdColStatusFilter([]); setThirdColOwnerFilter([]); setThirdColAssigneeFilter([]); setThirdColPeriodFilter([]); }}
                                    className="w-full text-left px-3 py-1 text-xs text-blue-600 hover:bg-gray-50 border-t border-gray-100 sticky bottom-0 bg-white"
                                  >
                                    Clear all
                                  </button>
                                )}
                              </div>
                              );
                            })()}
                          </div>
                          <div className="inline-flex border border-gray-300 rounded overflow-hidden">
                            <button
                              onClick={() => setListPlanChildView('table')}
                              className={`px-2 py-0.5 text-[10px] ${listPlanChildView === 'table' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                            >
                              Table
                            </button>
                            <button
                              onClick={() => setListPlanChildView('cards')}
                              className={`px-2 py-0.5 text-[10px] border-l border-gray-300 ${listPlanChildView === 'cards' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                            >
                              Cards
                            </button>
                            <button
                              onClick={() => setListPlanChildView('list')}
                              className={`px-2 py-0.5 text-[10px] border-l border-gray-300 ${listPlanChildView === 'list' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                            >
                              List
                            </button>
                          </div>
                          {listPlanChildView === 'cards' && (
                            <button
                              onClick={() => setPanel3EditMode(v => !v)}
                              className={`px-2 py-0.5 text-[10px] border rounded ${panel3EditMode ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
                            >
                              {panel3EditMode ? 'View' : 'Edit'}
                            </button>
                          )}
                        </div>
                        {child.items.length === 0 ? (
                          <div className="p-3 text-xs text-gray-400 italic">No items in this child list yet.</div>
                        ) : listPlanChildView === 'list' ? (
                          <div>
                            {child.items.slice().sort((a, b) => a.order - b.order).map(item => {
                              const obj = getObjective(item.objectiveId);
                              if (!obj) return null;
                              if (!passesFilters(obj, thirdColStatusFilter, thirdColOwnerFilter, thirdColAssigneeFilter, thirdColPeriodFilter)) return null;
                              if (!passesSelection(obj.id)) return null;
                              const isExpanded = expandedListRowIds.has(obj.id);
                              return (
                                <div key={item.objectiveId}>
                                  <div
                                    onClick={() => showPathInTree(obj.id)}
                                    draggable
                                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', `${child.id}|${obj.id}`); e.dataTransfer.effectAllowed = 'move'; }}
                                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                                    onDrop={(e) => { e.preventDefault(); const [lid, draggedId] = e.dataTransfer.getData('text/plain').split('|'); if (lid === child.id && draggedId) reorderItemsInList(child.id, draggedId, obj.id); }}
                                    className="group flex items-center gap-1 px-3 py-1 text-sm cursor-pointer border-b border-gray-100 hover:bg-gray-50 text-gray-800"
                                    title={obj.title}
                                  >
                                    <span className="text-gray-300 group-hover:text-gray-500 flex-shrink-0 cursor-grab active:cursor-grabbing" title="Drag to reorder">
                                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="9" cy="19" r="2" /><circle cx="15" cy="5" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="15" cy="19" r="2" /></svg>
                                    </span>
                                    <span className="truncate flex-1">{obj.title}</span>
                                    <AddToPlanBookmark objectiveId={obj.id} size="sm" />
                                    {listPlanColumns.length > 0 && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); toggleListRowExpanded(obj.id); }}
                                        className="text-gray-400 hover:text-gray-700 flex-shrink-0 p-0.5"
                                        title={isExpanded ? 'Hide details' : 'Show details'}
                                      >
                                        <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                  {isExpanded && listPlanColumns.length > 0 && (
                                    <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                                      <div className="border border-gray-200 rounded p-2 bg-white">
                                        <div className="grid gap-x-3 gap-y-0.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                                          {listPlanColumns.map(col => (
                                            <div key={col} className="text-xs text-gray-600">
                                              <span className="text-gray-400">{COLUMN_LABELS[col]}: </span>
                                              <span className="text-gray-700">{cellValueForCard(obj, col)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : listPlanChildView === 'cards' ? (
                          <div className="p-2 space-y-2">
                            {child.items.slice().sort((a, b) => a.order - b.order).map(item => {
                              const obj = getObjective(item.objectiveId);
                              if (!obj) return null;
                              if (!passesFilters(obj, thirdColStatusFilter, thirdColOwnerFilter, thirdColAssigneeFilter, thirdColPeriodFilter)) return null;
                              if (!passesSelection(obj.id)) return null;
                              return (
                                <div
                                  key={item.objectiveId}
                                  draggable
                                  onClick={() => showPathInTree(obj.id)}
                                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', `${child.id}|${obj.id}`); e.dataTransfer.effectAllowed = 'move'; }}
                                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    const data = e.dataTransfer.getData('text/plain');
                                    const [listId, draggedId] = data.split('|');
                                    if (listId === child.id && draggedId) {
                                      reorderItemsInList(child.id, draggedId, obj.id);
                                    }
                                  }}
                                  className="group relative border border-gray-200 rounded p-2 bg-white hover:bg-gray-50 cursor-pointer"
                                >
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => showPathInTree(obj.id)}
                                      className="flex-1 min-w-0 text-left text-sm font-medium text-gray-900 break-words whitespace-normal"
                                      title="Show path in the middle pane"
                                    >
                                      {obj.title}
                                    </button>
                                    <div onClick={(e) => e.stopPropagation()}>
                                      <AddToPlanBookmark objectiveId={obj.id} size="sm" />
                                    </div>
                                    <div onClick={(e) => e.stopPropagation()}>
                                      <JiraTicketButton obj={obj} />
                                    </div>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); if (cardEditingId === obj.id) cancelCardEdit(); else beginCardEdit(obj.id); }}
                                      className={`p-1 rounded flex-shrink-0 ${cardEditingId === obj.id ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}
                                      title={cardEditingId === obj.id ? 'Cancel edit' : 'Edit card'}
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                    </button>
                                    <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                      {obj.link?.url && (
                                        <a
                                          href={obj.link.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="p-0.5 text-blue-500 hover:text-blue-700 rounded"
                                          title={obj.link.description || obj.link.url}
                                        >
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                          </svg>
                                        </a>
                                      )}
                                      <button
                                        onClick={() => setEditingCardObjective(obj)}
                                        className="p-0.5 text-gray-400 hover:text-blue-600 rounded"
                                        title="Edit"
                                      >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                      </button>
                                      <button
                                        onClick={() => cloneObjective(obj.id, { orgId, userEmail, shared: obj.shared })}
                                        className="p-0.5 text-gray-400 hover:text-blue-500 rounded"
                                        title="Clone"
                                      >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                      </button>
                                      <button
                                        onClick={() => removeItemFromList(child.id, obj.id)}
                                        className="p-0.5 text-gray-400 hover:text-red-600 rounded"
                                        title="Remove from this child list"
                                      >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                  {listPlanColumns.length > 0 && (
                                    <div className="mt-1 grid gap-x-3 gap-y-0.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }} onClick={(e) => e.stopPropagation()}>
                                      {listPlanColumns.map(col => (
                                        <div key={col} className="text-xs text-gray-600">
                                          <span className="text-gray-400">{COLUMN_LABELS[col]}=</span>
                                          {panel3EditMode || cardEditingId === obj.id ? (
                                            <CardCellEditor obj={obj} col={col} draft={cardEditingId === obj.id ? cardDraft : undefined} setDraft={cardEditingId === obj.id ? (u) => setCardDraft(prev => ({ ...prev, ...u })) : undefined} />
                                          ) : (
                                            <span className="text-gray-700">{cellValueForCard(obj, col)}</span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {cardEditingId === obj.id && (
                                    <div className="mt-2 flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); cancelCardEdit(); }}
                                        className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); commitCardEdit(obj.id); }}
                                        className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                                      >
                                        OK
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className={`overflow-x-auto ${resizingPlanCol ? 'select-none' : ''}`}>
                            <div className="min-w-max">
                              <div className="flex items-center bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
                                <div className="relative flex items-center px-2 py-2 flex-shrink-0" style={{ width: planColumnWidths.title, minWidth: 150 }}>
                                  <div className="flex-1">{COLUMN_LABELS.title}</div>
                                  <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handlePlanResizeStart('title', e)} />
                                </div>
                                {(Object.keys(COLUMN_LABELS) as ColumnKey[])
                                  .filter(col => col !== 'title' && listPlanColumns.includes(col))
                                  .map(col => (
                                    <div key={col} className="relative flex items-center" style={{ width: planColumnWidths[col] }}>
                                      <div className="px-1 py-2 flex-1">{COLUMN_LABELS[col]}</div>
                                      <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize bg-gray-300 hover:bg-blue-400 hover:w-1 z-10" onMouseDown={(e) => handlePlanResizeStart(col, e)} />
                                    </div>
                                  ))}
                              </div>
                              {child.items.slice().sort((a, b) => a.order - b.order).map(item => {
                                const obj = getObjective(item.objectiveId);
                                if (!obj) return null;
                                if (!passesFilters(obj, thirdColStatusFilter, thirdColOwnerFilter, thirdColAssigneeFilter, thirdColPeriodFilter)) return null;
                                if (!passesSelection(obj.id)) return null;
                                return (
                                  <CompactObjectiveCard
                                    key={item.objectiveId}
                                    objective={obj}
                                    depth={0}
                                    visibleColumnsOverride={listPlanColumns}
                                    defaultCollapsed
                                    kebabActions
                                    addToPlanBookmark
                                    removeFromListId={child.id}
                                    reorderInList={{ listId: child.id, onReorder: (d, t) => reorderItemsInList(child.id, d, t) }}
                                    filteredObjectiveIds={NO_CHILDREN_PLAN_LIST}
                                    onTitleClick={(o) => showPathInTree(o.id)}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })() : (
                    <div className="p-3 text-xs text-gray-400 text-center">
                      Pick a child list from the toolbar to see its contents.
                    </div>
                  )}
                </div>
                </div>
              </div>
              <div
                onMouseDown={(e) => {
                  heightDragRef.current = { startY: e.clientY, startH: listPlanTotalHeight };
                  document.body.style.cursor = 'row-resize';
                  document.body.style.userSelect = 'none';
                }}
                className="h-2 cursor-row-resize bg-gray-200 hover:bg-blue-400 active:bg-blue-500 rounded mt-1"
                title="Drag to resize the Plan view height"
              />
              </>
            ) : sortedItems.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p>No items in this list</p>
                <p className="text-sm mt-1">Add items from the Objectives page using the bookmark icon</p>
              </div>
            ) : (
              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="w-8 py-2"></th>
                    <th className="w-8 py-2 text-xs font-medium text-gray-500 text-left">#</th>
                    <th className="py-2 pl-2 text-xs font-medium text-gray-500 text-left relative" style={{ width: columnWidths.name }}>
                      Name
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group"
                        onMouseDown={(e) => handleResizeStart('name', e)}
                      >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-300 group-hover:bg-blue-400" />
                      </div>
                    </th>
                    <th className="py-2 pl-3 text-xs font-medium text-gray-500 text-left relative" style={{ width: columnWidths.parent }}>
                      Parent
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group"
                        onMouseDown={(e) => handleResizeStart('parent', e)}
                      >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-300 group-hover:bg-blue-400" />
                      </div>
                    </th>
                    <th className="py-2 pl-3 text-xs font-medium text-gray-500 text-left relative" style={{ width: columnWidths.owner }}>
                      Owner
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group"
                        onMouseDown={(e) => handleResizeStart('owner', e)}
                      >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-300 group-hover:bg-blue-400" />
                      </div>
                    </th>
                    <th className="py-2 pl-3 text-xs font-medium text-gray-500 text-left relative" style={{ width: columnWidths.assignee }}>
                      Assignee
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group"
                        onMouseDown={(e) => handleResizeStart('assignee', e)}
                      >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-300 group-hover:bg-blue-400" />
                      </div>
                    </th>
                    <th className="py-2 pl-3 text-xs font-medium text-gray-500 text-left relative" style={{ width: columnWidths.status }}>
                      Status
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group"
                        onMouseDown={(e) => handleResizeStart('status', e)}
                      >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-300 group-hover:bg-blue-400" />
                      </div>
                    </th>
                    <th className="w-8 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item, index) => {
                    const objective = getObjective(item.objectiveId);
                    if (!objective) return null;
                    if (!filteredObjectiveIdSet.has(objective.id)) return null;
                    const parentObjective = objective.parentId ? getObjective(objective.parentId) : null;
                    const directChildren = getDirectChildren(objective.id);
                    const hasChildren = directChildren.length > 0;
                    const isExpanded = expandedRowIds.has(objective.id);

                    return (
                      <Fragment key={item.objectiveId}>
                      <tr
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.objectiveId)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, item.objectiveId)}
                        onDragEnd={handleDragEnd}
                        className={`border-b border-gray-100 hover:bg-gray-50 cursor-move ${
                          draggedItemId === item.objectiveId ? 'opacity-50' : ''
                        }`}
                      >
                        <td className="py-2 px-1">
                          <div className="text-gray-400 cursor-grab active:cursor-grabbing">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                            </svg>
                          </div>
                        </td>
                        <td className="py-2 text-xs text-gray-400">{index + 1}</td>
                        <td className="py-2 pl-2 pr-4 overflow-hidden" style={{ width: columnWidths.name }}>
                          <div className="flex items-center gap-1">
                            {hasChildren ? (
                              <button
                                onClick={() => toggleExpandRow(objective.id)}
                                className="p-0.5 text-gray-400 hover:text-gray-700 flex-shrink-0"
                                title={isExpanded ? 'Collapse' : 'Expand children'}
                              >
                                <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                            ) : (
                              <span className="w-4 flex-shrink-0" />
                            )}
                            <button
                              onClick={() => handleNavigateToObjective(objective.id)}
                              className="text-sm text-blue-600 hover:text-blue-800 hover:underline truncate text-left flex-1 min-w-0"
                              title={`Go to ${objective.title}`}
                            >
                              {objective.title}
                            </button>
                          </div>
                        </td>
                        <td className="py-2 pl-3 pr-4 overflow-hidden" style={{ width: columnWidths.parent }}>
                          {parentObjective ? (
                            <div className="flex items-center gap-1 min-w-0">
                              <button
                                onClick={() => handleNavigateToObjective(parentObjective.id)}
                                className="text-sm text-blue-600 hover:text-blue-800 hover:underline truncate text-left flex-1 min-w-0"
                                title={`Go to ${parentObjective.title}`}
                              >
                                {parentObjective.title}
                              </button>
                              {selectedListId && !selectedList?.items.some(i => i.objectiveId === parentObjective.id) && (
                                <button
                                  onClick={() => addItemToList(selectedListId, parentObjective.id)}
                                  className="p-0.5 text-gray-400 hover:text-blue-600 flex-shrink-0"
                                  title={`Add "${parentObjective.title}" to this list`}
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-500 truncate block">-</span>
                          )}
                        </td>
                        <td className="py-2 pl-3 pr-4 overflow-hidden" style={{ width: columnWidths.owner }}>
                          <span className="text-sm text-gray-500 truncate block">{getUserName(objective.ownerId)}</span>
                        </td>
                        <td className="py-2 pl-3 pr-4 overflow-hidden" style={{ width: columnWidths.assignee }}>
                          <span className="text-sm text-gray-500 truncate block">{getUserName(objective.assigneeId)}</span>
                        </td>
                        <td className="py-2 pl-3 pr-4 overflow-hidden" style={{ width: columnWidths.status }}>
                          {editingStatusObjId === objective.id ? (
                            <select
                              autoFocus
                              value={objective.workflowStatus || 'todo'}
                              onChange={(e) => handleStatusChange(objective.id, e.target.value as WorkflowStatus, objective.workflowStatus)}
                              onBlur={() => setEditingStatusObjId(null)}
                              className="w-full text-sm px-1 py-0.5 border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                              {WORKFLOW_STATUS_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          ) : (
                            <button
                              onClick={() => setEditingStatusObjId(objective.id)}
                              className="w-full text-left text-sm text-gray-500 truncate block hover:bg-gray-100 px-1 py-0.5 rounded"
                              title="Click to edit status"
                            >
                              {WORKFLOW_STATUS_LABELS[objective.workflowStatus || 'todo']}
                            </button>
                          )}
                        </td>
                        <td className="py-2 px-1">
                          <button
                            onClick={() => handleRemoveItem(item.objectiveId)}
                            className="p-1 text-gray-400 hover:text-red-600"
                            title="Remove from list"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                      {isExpanded && directChildren.map(child => (
                        <tr key={`${item.objectiveId}-child-${child.id}`} className="border-b border-gray-100 bg-gray-50/50">
                          <td className="py-1.5 px-1"></td>
                          <td className="py-1.5"></td>
                          <td className="py-1.5 pl-2 pr-4 overflow-hidden" style={{ width: columnWidths.name }}>
                            <div className="flex items-center gap-1 pl-5">
                              <svg className="w-3 h-3 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <button
                                onClick={() => handleNavigateToObjective(child.id)}
                                className="text-sm text-blue-600 hover:text-blue-800 hover:underline truncate text-left flex-1 min-w-0"
                                title={`Go to ${child.title}`}
                              >
                                {child.title}
                              </button>
                            </div>
                          </td>
                          <td className="py-1.5 pl-3 pr-4 overflow-hidden" style={{ width: columnWidths.parent }}>
                            <span className="text-sm text-gray-400 truncate block">{objective.title}</span>
                          </td>
                          <td className="py-1.5 pl-3 pr-4 overflow-hidden" style={{ width: columnWidths.owner }}>
                            <span className="text-sm text-gray-500 truncate block">{getUserName(child.ownerId)}</span>
                          </td>
                          <td className="py-1.5 pl-3 pr-4 overflow-hidden" style={{ width: columnWidths.assignee }}>
                            <span className="text-sm text-gray-500 truncate block">{getUserName(child.assigneeId)}</span>
                          </td>
                          <td className="py-1.5 pl-3 pr-4 overflow-hidden" style={{ width: columnWidths.status }}>
                            {editingStatusObjId === child.id ? (
                              <select
                                autoFocus
                                value={child.workflowStatus || 'todo'}
                                onChange={(e) => handleStatusChange(child.id, e.target.value as WorkflowStatus, child.workflowStatus)}
                                onBlur={() => setEditingStatusObjId(null)}
                                className="w-full text-sm px-1 py-0.5 border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                              >
                                {WORKFLOW_STATUS_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            ) : (
                              <button
                                onClick={() => setEditingStatusObjId(child.id)}
                                className="w-full text-left text-sm text-gray-500 truncate block hover:bg-gray-100 px-1 py-0.5 rounded"
                                title="Click to edit status"
                              >
                                {WORKFLOW_STATUS_LABELS[child.workflowStatus || 'todo']}
                              </button>
                            )}
                          </td>
                          <td className="py-1.5 px-1"></td>
                        </tr>
                      ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              <p className="text-lg font-medium">Select a list</p>
              <p className="text-sm mt-1">Choose a list from the sidebar or create a new one</p>
            </div>
          </div>
        )}
      </div>

      <SlidePane
        isOpen={editingCardObjective !== null}
        onClose={() => setEditingCardObjective(null)}
        title="Edit Objective"
        width="lg"
      >
        {editingCardObjective && (
          <ObjectiveForm
            objective={editingCardObjective}
            onClose={() => setEditingCardObjective(null)}
          />
        )}
      </SlidePane>
      {showCreateChildPlan && selectedList && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Create child plan</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-gray-200 rounded-md p-3 bg-gray-50 space-y-2">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Parent plan</div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">Name</div>
                  <div className="text-sm text-gray-800 break-words">{selectedList.name}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">Owner</div>
                  <div className="text-sm text-gray-800">{orgUsers.find(u => u.id === selectedList.ownerId)?.name || orgUsers.find(u => u.id === selectedList.ownerId)?.email || selectedList.ownerId || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">Period</div>
                  <div className="text-sm text-gray-800">{periods.find(p => p.id === selectedList.periodId)?.name || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">Level</div>
                  <div className="text-sm text-gray-800 capitalize">{selectedList.level || '—'}</div>
                </div>
              </div>
              <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                <input
                  type="text"
                  value={newChildPlanName}
                  onChange={(e) => setNewChildPlanName(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Owner</label>
                <select
                  value={newChildPlanOwnerId}
                  onChange={(e) => setNewChildPlanOwnerId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">— Pick an owner —</option>
                  {[...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Period</label>
                <select
                  value={newChildPlanPeriodId}
                  onChange={(e) => setNewChildPlanPeriodId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">— Pick a period —</option>
                  {renderGroupedPeriodOptions(periods)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Level</label>
                <select
                  value={newChildPlanLevel}
                  onChange={(e) => setNewChildPlanLevel(e.target.value as ObjectiveLevel | '')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">— Optional —</option>
                  <option value="company">Company</option>
                  <option value="team">Team</option>
                  <option value="individual">Individual</option>
                </select>
              </div>
              {newChildPlanError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{newChildPlanError}</div>
              )}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowCreateChildPlan(false)}
                disabled={creatingChildPlan}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const name = newChildPlanName.trim();
                  if (!name || !newChildPlanOwnerId || !newChildPlanPeriodId) {
                    setNewChildPlanError('Name, Owner, and Period are required.');
                    return;
                  }
                  setCreatingChildPlan(true);
                  setNewChildPlanError(null);
                  try {
                    const result = await createList(name, undefined, selectedList.id, {
                      ownerId: newChildPlanOwnerId,
                      periodId: newChildPlanPeriodId,
                      level: newChildPlanLevel || undefined,
                    });
                    if (result && typeof result === 'object' && 'error' in result) {
                      setNewChildPlanError(result.error);
                      return;
                    }
                    if (result && typeof result === 'object' && 'id' in result) {
                      setPlanSelectedChildListId(result.id);
                    }
                    setShowCreateChildPlan(false);
                  } finally {
                    setCreatingChildPlan(false);
                  }
                }}
                disabled={creatingChildPlan || !newChildPlanName.trim() || !newChildPlanOwnerId || !newChildPlanPeriodId}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {creatingChildPlan ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
