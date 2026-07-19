import { create } from 'zustand';
import type { Objective, KeyResult, Team, Period, Tag, OKRState, ObjectiveHistoryEntry, FieldChange, FilterOperator, ObjectiveType, NextStepDateFilter, ObjectiveLevel, SavedView, SavedViewFilters, WorkflowStatus, List } from '../types';
import { api } from '../utils/api';
import { generateId, calculateObjectiveProgress, determineStatus, calculateKeyResultProgress } from '../utils/calculations';

const API_URL = import.meta.env.VITE_API_URL || '';

// Filter state is persisted on the server via user preferences. The store
// initializes filters to defaults; fetchUserPreferences then hydrates them
// from the server once auth resolves.
function loadFilterState() {
  return {
    filterPeriodIds: [] as string[],
    filterTagIds: [] as string[],
    filterTeamIds: [] as string[],
    filterTypes: [] as ObjectiveType[],
    filterTypeNotSet: false,
    filterOwnerIds: [] as string[],
    filterOwnerOperator: 'equals' as FilterOperator,
    filterAssigneeIds: [] as string[],
    filterAssigneeOperator: 'equals' as FilterOperator,
    filterAssigneeNotSet: false,
    filterNextStepDate: null as NextStepDateFilter | null,
    filterLevels: [] as ObjectiveLevel[],
    filterObjectiveId: null as string | null,
    filterWorkflowStatuses: [] as WorkflowStatus[],
    filterKeyResultsOnly: false,
    filterListIds: [] as string[],
    filterListShowChildren: false,
  };
}

interface FilterState {
  filterPeriodIds: string[];
  filterTagIds: string[];
  filterTeamIds: string[];
  filterTypes: ObjectiveType[];
  filterTypeNotSet: boolean;
  filterOwnerIds: string[];
  filterOwnerOperator: FilterOperator;
  filterAssigneeIds: string[];
  filterAssigneeOperator: FilterOperator;
  filterAssigneeNotSet: boolean;
  filterNextStepDate: NextStepDateFilter | null;
  filterLevels: ObjectiveLevel[];
  filterObjectiveId: string | null;
  filterWorkflowStatuses: WorkflowStatus[];
  filterKeyResultsOnly: boolean;
  filterListIds: string[];
  filterListShowChildren: boolean;
}

let filterSaveTimer: ReturnType<typeof setTimeout> | null = null;
function saveFilterState(state: FilterState) {
  if (filterSaveTimer) clearTimeout(filterSaveTimer);
  filterSaveTimer = setTimeout(() => {
    fetch(`${API_URL}/api/users/me/preferences`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { filters: state } }),
    }).catch((err) => console.error('Failed to save filter state:', err));
  }, 250);
}

interface CreateContext {
  orgId: string;
  userEmail: string;
  shared?: boolean;
}

interface OKRActions {
  // Data fetching
  fetchData: () => Promise<void>;
  isLoading: boolean;
  error: string | null;

  // Objectives
  addObjective: (objective: Omit<Objective, 'id' | 'orgId' | 'createdBy' | 'shared' | 'progress' | 'status' | 'createdAt' | 'updatedAt' | 'history'>, ctx: CreateContext) => Promise<void>;
  updateObjective: (id: string, updates: Partial<Objective>, userEmail: string) => Promise<void>;
  deleteObjective: (id: string) => Promise<void>;

  cloneObjective: (id: string, ctx: CreateContext) => Promise<void>;

  // Key Results
  addKeyResult: (keyResult: Omit<KeyResult, 'id' | 'orgId' | 'createdBy' | 'shared' | 'progress' | 'createdAt' | 'updatedAt'>, ctx: CreateContext) => Promise<void>;
  updateKeyResult: (id: string, updates: Partial<KeyResult>) => Promise<void>;
  deleteKeyResult: (id: string) => Promise<void>;

  // Teams
  addTeam: (team: Omit<Team, 'id' | 'orgId' | 'createdBy' | 'shared'>, ctx: CreateContext) => Promise<void>;
  updateTeam: (id: string, updates: Partial<Team>) => Promise<void>;
  deleteTeam: (id: string) => Promise<void>;

  // Periods
  addPeriod: (period: Omit<Period, 'id' | 'orgId' | 'createdBy' | 'shared'>, ctx: CreateContext) => Promise<void>;
  updatePeriod: (id: string, updates: Partial<Period>) => Promise<void>;
  deletePeriod: (id: string) => Promise<void>;
  toggleFilterPeriod: (id: string) => void;
  clearFilterPeriods: () => void;

  // Tags
  addTag: (tag: Omit<Tag, 'id' | 'orgId' | 'createdBy' | 'shared'>, ctx: CreateContext) => Promise<void>;
  updateTag: (id: string, updates: Partial<Tag>) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
  setFilterTags: (tagIds: string[]) => void;
  toggleFilterTag: (tagId: string) => void;

  // Filters
  setFilterTeams: (teamIds: string[]) => void;
  toggleFilterTeam: (teamId: string) => void;
  filterTypes: ObjectiveType[];
  filterTypeNotSet: boolean;
  toggleFilterType: (type: ObjectiveType) => void;
  toggleFilterTypeNotSet: () => void;
  setFilterOwners: (ownerIds: string[]) => void;
  toggleFilterOwner: (ownerId: string) => void;
  setFilterOwnerOperator: (operator: FilterOperator) => void;
  setFilterAssignees: (assigneeIds: string[]) => void;
  toggleFilterAssignee: (assigneeId: string) => void;
  setFilterAssigneeOperator: (operator: FilterOperator) => void;
  filterAssigneeNotSet: boolean;
  toggleFilterAssigneeNotSet: () => void;
  setFilterNextStepDate: (filter: NextStepDateFilter | null) => void;
  toggleFilterLevel: (level: ObjectiveLevel) => void;
  setFilterObjective: (objectiveId: string | null) => void;
  setFilterRootObjective: (objectiveId: string | null) => void;
  showListMembership: boolean;
  setShowListMembership: (v: boolean) => void;
  listMembershipListId: string | null;
  setListMembershipListId: (id: string | null) => void;
  filterWorkflowStatuses: WorkflowStatus[];
  toggleFilterWorkflowStatus: (status: WorkflowStatus) => void;
  filterKeyResultsOnly: boolean;
  toggleFilterKeyResultsOnly: () => void;
  filterListIds: string[];
  filterListShowChildren: boolean;
  toggleFilterList: (listId: string) => void;
  clearFilterLists: () => void;
  toggleFilterListShowChildren: () => void;
  openChildrenOnly: boolean;
  setOpenChildrenOnly: (value: boolean) => void;
  clearAllFilters: () => void;

  // Allowed Domains (legacy - kept for compatibility)
  addAllowedDomain: (domain: string) => void;
  deleteAllowedDomain: (domain: string) => void;

  // Backup & Restore
  exportData: () => BackupData;
  importData: (data: BackupData) => Promise<void>;

  // Utilities
  recalculateProgress: () => void;

  // User Preferences
  editorWidth: number | undefined;
  setEditorWidth: (width: number) => Promise<void>;
  columnWidths: ColumnWidths;
  setColumnWidths: (widths: Partial<ColumnWidths>) => Promise<void>;
  visibleColumns: ColumnKey[];
  setVisibleColumns: (columns: ColumnKey[]) => Promise<void>;
  toggleColumnVisibility: (column: ColumnKey) => Promise<void>;
  evergreenOverdueColumns: ColumnKey[];
  setEvergreenOverdueColumns: (columns: ColumnKey[]) => Promise<void>;
  toggleEvergreenOverdueColumn: (column: ColumnKey) => Promise<void>;
  evergreenOverdueStatuses: WorkflowStatus[];
  setEvergreenOverdueStatuses: (statuses: WorkflowStatus[]) => Promise<void>;
  evergreenOverduePeriodIds: string[];
  setEvergreenOverduePeriodIds: (ids: string[]) => Promise<void>;
  evergreenOverdueViewMode: 'tree' | 'table';
  setEvergreenOverdueViewMode: (mode: 'tree' | 'table') => Promise<void>;
  listViewModes: Record<string, 'list' | 'plan'>;
  setListViewMode: (listId: string, mode: 'list' | 'plan') => Promise<void>;
  listPlanColumns: ColumnKey[];
  setListPlanColumns: (columns: ColumnKey[]) => Promise<void>;
  toggleListPlanColumn: (column: ColumnKey) => Promise<void>;
  listPlanChildView: 'table' | 'cards' | 'list';
  setListPlanChildView: (mode: 'table' | 'cards' | 'list') => Promise<void>;
  listPlanTreeView: 'table' | 'cards' | 'list';
  setListPlanTreeView: (mode: 'table' | 'cards' | 'list') => Promise<void>;
  listPlanCurrentView: 'table' | 'cards' | 'list';
  setListPlanCurrentView: (mode: 'table' | 'cards' | 'list') => Promise<void>;
  objectiveViewMode: 'explore' | 'plan';
  setObjectiveViewMode: (mode: 'explore' | 'plan') => Promise<void>;
  planViewColumns: ColumnKey[];
  setPlanViewColumns: (columns: ColumnKey[]) => Promise<void>;
  togglePlanViewColumn: (column: ColumnKey) => Promise<void>;
  planTreeColumns: ColumnKey[];
  setPlanTreeColumns: (columns: ColumnKey[]) => Promise<void>;
  togglePlanTreeColumn: (column: ColumnKey) => Promise<void>;
  planFilters: import('../types').PlanFilters;
  setPlanFilters: (filters: import('../types').PlanFilters) => void;
  plans: import('../types').PlanDef[];
  activePlanId: string | null;
  lastSelectedPlanId: string | null;
  addPlan: (name: string) => Promise<void>;
  deletePlan: (id: string) => Promise<void>;
  applyPlan: (id: string) => void;
  reorderPlanItems: (id: string, orderedIds: string[]) => Promise<void>;
  togglePlanReplacement: (planId: string, objectiveId: string) => Promise<void>;
  togglePlanExclusion: (planId: string, objectiveId: string) => Promise<void>;
  togglePlanHideChildren: (planId: string, objectiveId: string) => Promise<void>;
  updatePlanFilters: (planId: string) => Promise<void>;
  savePlanVersion: (planId: string, itemIds: string[]) => Promise<void>;
  highlightObjectiveId: string | null;
  setHighlightObjectiveId: (id: string | null) => void;
  forcedExpandedIds: string[] | null;
  setForcedExpandedIds: (ids: string[] | null) => void;
  planFocusListId: string | null;
  setPlanFocusListId: (id: string | null) => void;
  fetchUserPreferences: () => Promise<void>;

  // Saved Views
  savedViews: SavedView[];
  activeViewId: string | null;
  fetchViews: () => Promise<void>;
  createView: (name: string, isDefault?: boolean) => Promise<SavedView | null>;
  updateView: (viewId: string) => Promise<void>;
  deleteView: (viewId: string) => Promise<void>;
  applyView: (viewId: string) => void;
  setDefaultView: (viewId: string) => Promise<void>;
  clearActiveView: () => void;
  renameView: (viewId: string, newName: string) => Promise<void>;
  toggleViewStarred: (viewId: string) => Promise<void>;

  // Lists
  lists: List[];
  sharedPlans: List[];
  fetchSharedPlans: () => Promise<void>;
  fetchLists: () => Promise<void>;
  createList: (name: string, color?: string, parentId?: string, meta?: { ownerId?: string; periodId?: string; level?: import('../types').ObjectiveLevel; shared?: boolean }) => Promise<List | { error: string } | null>;
  setListShared: (listId: string, shared: boolean) => Promise<void>;
  setListLevel: (listId: string, level: import('../types').ObjectiveLevel | '') => Promise<void>;
  setListStatus: (listId: string, status: string) => Promise<void>;
  saveListScorecard: (listId: string, scorecard: import('../types').PlanScorecard | null) => Promise<void>;
  setListOwner: (listId: string, ownerId: string) => Promise<void>;
  setListPeriod: (listId: string, periodId: string) => Promise<void>;
  deleteList: (listId: string) => Promise<void>;
  renameList: (listId: string, newName: string) => Promise<void>;
  updateListColor: (listId: string, color: string) => Promise<void>;
  updateListParent: (listId: string, parentId: string | null) => Promise<void>;
  addItemToList: (listId: string, objectiveId: string) => Promise<void>;
  removeItemFromList: (listId: string, objectiveId: string) => Promise<void>;
  reorderListItems: (listId: string, items: { objectiveId: string; order: number }[], movedObjectiveId?: string) => Promise<void>;
}

export interface ColumnWidths {
  title: number;
  level: number;
  type: number;
  workflowStatus: number;
  keyResult: number;
  parent: number;
  team: number;
  owner: number;
  assignee: number;
  period: number;
  nextStepDate: number;
  nextStep: number;
  storyPoints: number;
  valuePoints: number;
  tags: number;
  progress: number;
  resolved: number;
}

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  title: 300,       // min width for title
  level: 96,        // w-24
  type: 96,         // w-24
  workflowStatus: 112, // w-28
  keyResult: 56,    // w-14
  parent: 144,      // w-36
  team: 112,        // w-28
  owner: 112,       // w-28
  assignee: 112,    // w-28
  period: 112,      // w-28
  nextStepDate: 96, // w-24
  nextStep: 160,    // w-40
  storyPoints: 56,  // w-14
  valuePoints: 56,  // w-14
  tags: 160,        // w-40
  progress: 56,     // w-14
  resolved: 96,     // w-24
};

export type ColumnKey = keyof ColumnWidths;

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  title: 'Objective',
  level: 'Level',
  type: 'Type',
  workflowStatus: 'Status',
  keyResult: 'KR',
  parent: 'Parent',
  team: 'Team',
  owner: 'Owner',
  assignee: 'Assignee',
  period: 'Period',
  nextStepDate: 'Next Date',
  nextStep: 'Next Step',
  storyPoints: 'SP',
  valuePoints: 'VP',
  tags: 'Tags',
  progress: 'Progress',
  resolved: 'Resolved',
};

export const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = [
  'title', 'level', 'type', 'workflowStatus', 'keyResult', 'parent', 'team', 'owner', 'assignee',
  'period', 'nextStepDate', 'nextStep', 'storyPoints', 'valuePoints', 'tags', 'progress'
];

export interface BackupUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  domain: string;
  organizationId: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastLoginAt: string;
}

export interface BackupOrganization {
  id: string;
  name: string;
  domain: string;
  admins: Array<{
    email: string;
    status: 'pending' | 'accepted';
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface BackupData {
  version: number;
  exportedAt: string;
  objectives: Objective[];
  keyResults: KeyResult[];
  teams: Team[];
  periods: Period[];
  tags: Tag[];
  lists?: List[];
  plans?: import('../types').PlanDef[];
  users?: BackupUser[];
  organizations?: BackupOrganization[];
}

export type OKRStore = OKRState & OKRActions;

const recalculateAllProgress = (state: OKRState): OKRState => {
  const updatedKeyResults = state.keyResults.map((kr: KeyResult) => ({
    ...kr,
    progress: calculateKeyResultProgress(kr),
  }));

  const updatedObjectives = state.objectives.map((obj: Objective) => {
    const progress = calculateObjectiveProgress(obj, updatedKeyResults, state.objectives);
    return {
      ...obj,
      progress,
      status: determineStatus(progress),
    };
  });

  return {
    ...state,
    objectives: updatedObjectives,
    keyResults: updatedKeyResults,
  };
};

const defaultState: OKRState = {
  objectives: [],
  keyResults: [],
  teams: [],
  periods: [],
  tags: [],
  allowedDomains: [],
  filterPeriodIds: [],
  filterTagIds: [],
  filterTeamIds: [],
  filterTypes: [] as ObjectiveType[],
  filterTypeNotSet: false,
  filterOwnerIds: [],
  filterOwnerOperator: 'equals',
  filterAssigneeIds: [],
  filterAssigneeOperator: 'equals',
  filterAssigneeNotSet: false,
  filterNextStepDate: null,
  filterLevels: [] as ObjectiveLevel[],
  filterObjectiveId: null,
  filterRootObjectiveId: null,
  showListMembership: false,
  listMembershipListId: null,
  filterWorkflowStatuses: [] as WorkflowStatus[],
  filterKeyResultsOnly: false,
  filterListIds: [],
  filterListShowChildren: false,
  openChildrenOnly: false,
};

export const useOKRStore = create<OKRStore>((set, get) => ({
  ...defaultState,
  ...loadFilterState(),
  isLoading: false,
  error: null,
  editorWidth: undefined,
  columnWidths: DEFAULT_COLUMN_WIDTHS,
  visibleColumns: DEFAULT_VISIBLE_COLUMNS,
  evergreenOverdueColumns: ['workflowStatus', 'owner', 'nextStepDate'] as ColumnKey[],
  evergreenOverdueStatuses: [] as WorkflowStatus[],
  evergreenOverduePeriodIds: [] as string[],
  evergreenOverdueViewMode: 'tree' as 'tree' | 'table',
  listViewModes: {} as Record<string, 'list' | 'plan'>,
  listPlanColumns: ['workflowStatus', 'owner', 'period'] as ColumnKey[],
  listPlanChildView: 'cards' as 'table' | 'cards' | 'list',
  listPlanTreeView: 'cards' as 'table' | 'cards' | 'list',
  listPlanCurrentView: 'cards' as 'table' | 'cards' | 'list',
  objectiveViewMode: 'explore' as 'explore' | 'plan',
  planViewColumns: ['level', 'period', 'workflowStatus', 'type', 'team', 'owner'] as ColumnKey[],
  planTreeColumns: ['level', 'period', 'workflowStatus', 'type', 'team', 'owner'] as ColumnKey[],
  planFilters: { ownerId: '', periodId: '', level: '', statuses: [] as WorkflowStatus[], types: [] as ObjectiveType[] } as import('../types').PlanFilters,
  plans: [] as import('../types').PlanDef[],
  activePlanId: null as string | null,
  lastSelectedPlanId: null as string | null,
  highlightObjectiveId: null as string | null,
  forcedExpandedIds: null as string[] | null,
  planFocusListId: null as string | null,
  savedViews: [],
  activeViewId: null,
  lists: [],
  sharedPlans: [],

  fetchData: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.fetchOKRData();
      const recalculated = recalculateAllProgress({
        ...get(),
        objectives: data.objectives,
        keyResults: data.keyResults,
        teams: data.teams,
        periods: data.periods,
        tags: data.tags,
      });
      set({ ...recalculated, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  addObjective: async (objective, ctx) => {
    const state = get();
    const now = new Date().toISOString();

    // Helper to resolve IDs to names
    const getPeriodName = (id: string) => state.periods.find(p => p.id === id)?.name || id;
    const getTeamName = (id: string) => state.teams.find(t => t.id === id)?.name || id;
    const getObjectiveTitle = (id: string) => state.objectives.find(o => o.id === id)?.title || id;

    // Create initial history entry
    const initialHistory: ObjectiveHistoryEntry = {
      id: generateId(),
      timestamp: now,
      userEmail: ctx.userEmail,
      action: 'created',
      changes: [
        { field: 'title', oldValue: undefined, newValue: objective.title },
        { field: 'level', oldValue: undefined, newValue: objective.level },
        { field: 'period', oldValue: undefined, newValue: getPeriodName(objective.periodId) },
        ...(objective.description ? [{ field: 'description', oldValue: undefined, newValue: objective.description }] : []),
        ...(objective.teamId ? [{ field: 'team', oldValue: undefined, newValue: getTeamName(objective.teamId) }] : []),
        ...(objective.parentId ? [{ field: 'parent', oldValue: undefined, newValue: getObjectiveTitle(objective.parentId) }] : []),
      ],
    };

    try {
      const newObjective = await api.createObjective({
        ...objective,
        shared: ctx.shared ?? true,
        history: [initialHistory],
      });
      set((state: OKRStore) => ({
        ...state,
        objectives: [...state.objectives, newObjective],
      }));
    } catch (error) {
      console.error('Failed to add objective:', error);
      throw error;
    }
  },

  updateObjective: async (id: string, updates: Partial<Objective>, userEmail: string) => {
    const state = get();
    const now = new Date().toISOString();
    const existingObj = state.objectives.find((obj: Objective) => obj.id === id);
    if (!existingObj) return;

    // Helper to resolve IDs to names
    const getPeriodName = (id: string | undefined) => id ? state.periods.find(p => p.id === id)?.name || id : undefined;
    const getTeamName = (id: string | undefined) => id ? state.teams.find(t => t.id === id)?.name || id : undefined;
    const getTagNames = (ids: string[] | undefined) => ids ? ids.map(id => state.tags.find(t => t.id === id)?.name || id).join(', ') : undefined;
    const getObjectiveTitle = (id: string | undefined) => id ? state.objectives.find(o => o.id === id)?.title || id : undefined;

    // Track changes - helper to normalize empty/undefined values
    const normalize = (val: unknown) => val === '' || val === null ? undefined : val;
    const normalizeArray = (val: unknown[] | undefined) => !val || val.length === 0 ? undefined : val;
    const changes: FieldChange[] = [];

    const getUserDisplay = (id: string | undefined) => id;

    if ('title' in updates && normalize(updates.title) !== normalize(existingObj.title)) {
      changes.push({ field: 'title', oldValue: existingObj.title, newValue: updates.title, oldRaw: existingObj.title, newRaw: updates.title });
    }
    if ('description' in updates && normalize(updates.description) !== normalize(existingObj.description)) {
      changes.push({ field: 'description', oldValue: existingObj.description || '(empty)', newValue: updates.description || '(empty)', oldRaw: existingObj.description, newRaw: updates.description });
    }
    if ('level' in updates && normalize(updates.level) !== normalize(existingObj.level)) {
      changes.push({ field: 'level', oldValue: existingObj.level, newValue: updates.level, oldRaw: existingObj.level, newRaw: updates.level });
    }
    if ('type' in updates && normalize(updates.type) !== normalize(existingObj.type)) {
      changes.push({ field: 'type', oldValue: existingObj.type || '(none)', newValue: updates.type || '(none)', oldRaw: existingObj.type, newRaw: updates.type });
    }
    if ('periodId' in updates && normalize(updates.periodId) !== normalize(existingObj.periodId)) {
      changes.push({ field: 'period', oldValue: getPeriodName(existingObj.periodId), newValue: getPeriodName(updates.periodId), oldRaw: existingObj.periodId, newRaw: updates.periodId });
    }
    if ('teamId' in updates && normalize(updates.teamId) !== normalize(existingObj.teamId)) {
      changes.push({ field: 'team', oldValue: getTeamName(existingObj.teamId) || '(none)', newValue: getTeamName(updates.teamId) || '(none)', oldRaw: existingObj.teamId, newRaw: updates.teamId });
    }
    if ('tagIds' in updates && JSON.stringify(normalizeArray(updates.tagIds)) !== JSON.stringify(normalizeArray(existingObj.tagIds))) {
      changes.push({ field: 'tags', oldValue: getTagNames(existingObj.tagIds) || '(none)', newValue: getTagNames(updates.tagIds) || '(none)', oldRaw: existingObj.tagIds, newRaw: updates.tagIds });
    }
    if ('parentId' in updates && normalize(updates.parentId) !== normalize(existingObj.parentId)) {
      changes.push({ field: 'parent', oldValue: getObjectiveTitle(existingObj.parentId) || '(none)', newValue: getObjectiveTitle(updates.parentId) || '(none)', oldRaw: existingObj.parentId, newRaw: updates.parentId });
    }
    if ('shared' in updates && updates.shared !== existingObj.shared) {
      changes.push({ field: 'visibility', oldValue: existingObj.shared ? 'Shared' : 'Private', newValue: updates.shared ? 'Shared' : 'Private', oldRaw: existingObj.shared, newRaw: updates.shared });
    }
    if ('ownerId' in updates && normalize(updates.ownerId) !== normalize(existingObj.ownerId)) {
      changes.push({ field: 'owner', oldValue: getUserDisplay(existingObj.ownerId) || '(none)', newValue: getUserDisplay(updates.ownerId) || '(none)', oldRaw: existingObj.ownerId, newRaw: updates.ownerId });
    }
    if ('assigneeId' in updates && normalize(updates.assigneeId) !== normalize(existingObj.assigneeId)) {
      changes.push({ field: 'assignee', oldValue: getUserDisplay(existingObj.assigneeId) || '(none)', newValue: getUserDisplay(updates.assigneeId) || '(none)', oldRaw: existingObj.assigneeId, newRaw: updates.assigneeId });
    }
    if ('resolvedAt' in updates && normalize(updates.resolvedAt) !== normalize(existingObj.resolvedAt)) {
      changes.push({ field: 'resolved', oldValue: existingObj.resolvedAt || '(none)', newValue: updates.resolvedAt || '(none)', oldRaw: existingObj.resolvedAt, newRaw: updates.resolvedAt });
    }
    if ('workflowStatus' in updates && normalize(updates.workflowStatus) !== normalize(existingObj.workflowStatus)) {
      changes.push({ field: 'status', oldValue: existingObj.workflowStatus || '(none)', newValue: updates.workflowStatus || '(none)', oldRaw: existingObj.workflowStatus, newRaw: updates.workflowStatus });
    }
    if ('nextStepDate' in updates && normalize(updates.nextStepDate) !== normalize(existingObj.nextStepDate)) {
      changes.push({ field: 'nextStepDate', oldValue: existingObj.nextStepDate || '(none)', newValue: updates.nextStepDate || '(none)', oldRaw: existingObj.nextStepDate, newRaw: updates.nextStepDate });
    }
    if ('nextStep' in updates && normalize(updates.nextStep) !== normalize(existingObj.nextStep)) {
      changes.push({ field: 'nextStep', oldValue: existingObj.nextStep || '(empty)', newValue: updates.nextStep || '(empty)', oldRaw: existingObj.nextStep, newRaw: updates.nextStep });
    }
    if ('storyPoints' in updates && normalize(updates.storyPoints) !== normalize(existingObj.storyPoints)) {
      changes.push({ field: 'storyPoints', oldValue: existingObj.storyPoints, newValue: updates.storyPoints, oldRaw: existingObj.storyPoints, newRaw: updates.storyPoints });
    }
    if ('valuePoints' in updates && normalize(updates.valuePoints) !== normalize(existingObj.valuePoints)) {
      changes.push({ field: 'valuePoints', oldValue: existingObj.valuePoints, newValue: updates.valuePoints, oldRaw: existingObj.valuePoints, newRaw: updates.valuePoints });
    }
    if ('isKeyResult' in updates && !!updates.isKeyResult !== !!existingObj.isKeyResult) {
      changes.push({ field: 'isKeyResult', oldValue: existingObj.isKeyResult ? 'Yes' : 'No', newValue: updates.isKeyResult ? 'Yes' : 'No', oldRaw: !!existingObj.isKeyResult, newRaw: !!updates.isKeyResult });
    }
    if ('link' in updates && JSON.stringify(updates.link || null) !== JSON.stringify(existingObj.link || null)) {
      const fmtLink = (l: typeof existingObj.link) => l ? (l.description ? `${l.description} (${l.url})` : l.url) : '(none)';
      changes.push({ field: 'link', oldValue: fmtLink(existingObj.link), newValue: fmtLink(updates.link), oldRaw: existingObj.link, newRaw: updates.link });
    }

    // Add history entry if there are changes
    let updatedHistory = existingObj.history || [];
    if (changes.length > 0) {
      const historyEntry: ObjectiveHistoryEntry = {
        id: generateId(),
        timestamp: now,
        userEmail,
        action: 'updated',
        changes,
      };
      updatedHistory = [...updatedHistory, historyEntry];
    }

    // Auto-set resolvedAt when workflow status changes to/from done (only if not manually set)
    let resolvedAtUpdate: { resolvedAt?: string } = {};
    if (!('resolvedAt' in updates) && 'workflowStatus' in updates && updates.workflowStatus !== existingObj.workflowStatus) {
      if (updates.workflowStatus === 'done') {
        // Set resolvedAt to today's date (YYYY-MM-DD format)
        resolvedAtUpdate = { resolvedAt: now.split('T')[0] };
      } else if (existingObj.workflowStatus === 'done') {
        // Clear resolvedAt when moving away from done
        resolvedAtUpdate = { resolvedAt: undefined };
      }
    }

    try {
      const updatedObjective = await api.updateObjective(id, { ...updates, ...resolvedAtUpdate, history: updatedHistory });
      set((state: OKRStore) => {
        const newState = {
          ...state,
          objectives: state.objectives.map((obj: Objective) =>
            obj.id === id ? updatedObjective : obj
          ),
        };
        return recalculateAllProgress(newState);
      });
    } catch (error) {
      console.error('Failed to update objective:', error);
      throw error;
    }
  },

  deleteObjective: async (id: string) => {
    try {
      await api.deleteObjective(id);
      set((state: OKRStore) => {
        // Also delete child objectives locally
        const objectivesToDelete = new Set<string>();
        const findChildren = (parentId: string) => {
          objectivesToDelete.add(parentId);
          state.objectives.filter((o: Objective) => o.parentId === parentId).forEach((child: Objective) => findChildren(child.id));
        };
        findChildren(id);

        const newState = {
          ...state,
          objectives: state.objectives.filter((obj: Objective) => !objectivesToDelete.has(obj.id)),
          keyResults: state.keyResults.filter((kr: KeyResult) => !objectivesToDelete.has(kr.objectiveId)),
        };
        return recalculateAllProgress(newState);
      });
    } catch (error) {
      console.error('Failed to delete objective:', error);
      throw error;
    }
  },

  cloneObjective: async (id: string, ctx: CreateContext) => {
    const state = get();
    const objective = state.objectives.find((o: Objective) => o.id === id);
    if (!objective) return;

    await get().addObjective(
      {
        title: `${objective.title} (cloned)`,
        description: objective.description,
        level: objective.level,
        type: objective.type,
        parentId: objective.parentId,
        teamId: objective.teamId,
        ownerId: objective.ownerId,
        assigneeId: objective.assigneeId,
        tagIds: objective.tagIds ? [...objective.tagIds] : [],
        nextStepDate: objective.nextStepDate,
        nextStep: objective.nextStep,
        storyPoints: objective.storyPoints,
        valuePoints: objective.valuePoints,
        link: objective.link,
        sortOrder: objective.sortOrder,
        progressUpdates: [],
        isKeyResult: objective.isKeyResult,
        workflowStatus: objective.workflowStatus,
        periodId: objective.periodId,
      },
      ctx
    );
  },

  addKeyResult: async (keyResult, ctx) => {
    const progress = keyResult.targetValue > 0
      ? Math.round((keyResult.currentValue / keyResult.targetValue) * 100)
      : 0;

    try {
      const newKeyResult = await api.createKeyResult({
        ...keyResult,
        shared: ctx.shared ?? true,
        progress,
      });
      set((state: OKRStore) => {
        const newState = { ...state, keyResults: [...state.keyResults, newKeyResult] };
        return recalculateAllProgress(newState);
      });
    } catch (error) {
      console.error('Failed to add key result:', error);
      throw error;
    }
  },

  updateKeyResult: async (id: string, updates: Partial<KeyResult>) => {
    try {
      const updatedKeyResult = await api.updateKeyResult(id, updates);
      set((state: OKRStore) => {
        const newState = {
          ...state,
          keyResults: state.keyResults.map((kr: KeyResult) =>
            kr.id === id ? updatedKeyResult : kr
          ),
        };
        return recalculateAllProgress(newState);
      });
    } catch (error) {
      console.error('Failed to update key result:', error);
      throw error;
    }
  },

  deleteKeyResult: async (id: string) => {
    try {
      await api.deleteKeyResult(id);
      set((state: OKRStore) => {
        const newState = {
          ...state,
          keyResults: state.keyResults.filter((kr: KeyResult) => kr.id !== id),
        };
        return recalculateAllProgress(newState);
      });
    } catch (error) {
      console.error('Failed to delete key result:', error);
      throw error;
    }
  },

  addTeam: async (team, ctx) => {
    try {
      const newTeam = await api.createTeam({ ...team, shared: ctx.shared ?? true });
      set((state: OKRStore) => ({
        ...state,
        teams: [...state.teams, newTeam],
      }));
    } catch (error) {
      console.error('Failed to add team:', error);
      throw error;
    }
  },

  updateTeam: async (id: string, updates: Partial<Team>) => {
    try {
      const updatedTeam = await api.updateTeam(id, updates);
      set((state: OKRStore) => ({
        ...state,
        teams: state.teams.map((team: Team) => (team.id === id ? updatedTeam : team)),
      }));
    } catch (error) {
      console.error('Failed to update team:', error);
      throw error;
    }
  },

  deleteTeam: async (id: string) => {
    try {
      await api.deleteTeam(id);
      set((state: OKRStore) => ({
        ...state,
        teams: state.teams.filter((team: Team) => team.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete team:', error);
      throw error;
    }
  },

  addPeriod: async (period, ctx) => {
    try {
      const newPeriod = await api.createPeriod({ ...period, shared: ctx.shared ?? true });
      set((state: OKRStore) => ({
        ...state,
        periods: [...state.periods, newPeriod],
      }));
    } catch (error) {
      console.error('Failed to add period:', error);
      throw error;
    }
  },

  updatePeriod: async (id: string, updates: Partial<Period>) => {
    try {
      const updatedPeriod = await api.updatePeriod(id, updates);
      set((state: OKRStore) => ({
        ...state,
        periods: state.periods.map((period: Period) => (period.id === id ? updatedPeriod : period)),
      }));
    } catch (error) {
      console.error('Failed to update period:', error);
      throw error;
    }
  },

  deletePeriod: async (id: string) => {
    try {
      await api.deletePeriod(id);
      set((state: OKRStore) => {
        const newState = {
          ...state,
          periods: state.periods.filter((period: Period) => period.id !== id),
          filterPeriodIds: state.filterPeriodIds.filter((pid: string) => pid !== id),
        };
        saveFilterState({ filterPeriodIds: newState.filterPeriodIds, filterTagIds: newState.filterTagIds, filterTeamIds: newState.filterTeamIds, filterTypes: newState.filterTypes, filterTypeNotSet: newState.filterTypeNotSet, filterOwnerIds: newState.filterOwnerIds, filterOwnerOperator: newState.filterOwnerOperator, filterAssigneeIds: newState.filterAssigneeIds, filterAssigneeOperator: newState.filterAssigneeOperator, filterNextStepDate: newState.filterNextStepDate, filterLevels: newState.filterLevels, filterObjectiveId: newState.filterObjectiveId, filterWorkflowStatuses: newState.filterWorkflowStatuses });
        return newState;
      });
    } catch (error) {
      console.error('Failed to delete period:', error);
      throw error;
    }
  },

  toggleFilterPeriod: (id: string) => {
    set((state: OKRStore) => {
      const filterPeriodIds = state.filterPeriodIds.includes(id)
        ? state.filterPeriodIds.filter((pid: string) => pid !== id)
        : [...state.filterPeriodIds, id];
      saveFilterState({ filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterPeriodIds };
    });
  },

  clearFilterPeriods: () => {
    set((state: OKRStore) => {
      saveFilterState({ filterPeriodIds: [], filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterPeriodIds: [] };
    });
  },

  addTag: async (tag, ctx) => {
    try {
      const newTag = await api.createTag({ ...tag, shared: ctx.shared ?? true });
      set((state: OKRStore) => ({
        ...state,
        tags: [...state.tags, newTag],
      }));
    } catch (error) {
      console.error('Failed to add tag:', error);
      throw error;
    }
  },

  updateTag: async (id: string, updates: Partial<Tag>) => {
    try {
      const updatedTag = await api.updateTag(id, updates);
      set((state: OKRStore) => ({
        ...state,
        tags: state.tags.map((tag: Tag) => (tag.id === id ? updatedTag : tag)),
      }));
    } catch (error) {
      console.error('Failed to update tag:', error);
      throw error;
    }
  },

  deleteTag: async (id: string) => {
    try {
      await api.deleteTag(id);
      set((state: OKRStore) => {
        const updatedObjectives = state.objectives.map((obj: Objective) => ({
          ...obj,
          tagIds: obj.tagIds?.filter((tagId: string) => tagId !== id),
        }));
        const newFilterTagIds = state.filterTagIds.filter((tagId: string) => tagId !== id);
        const newState = {
          ...state,
          tags: state.tags.filter((tag: Tag) => tag.id !== id),
          objectives: updatedObjectives,
          filterTagIds: newFilterTagIds,
        };
        saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: newFilterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
        return newState;
      });
    } catch (error) {
      console.error('Failed to delete tag:', error);
      throw error;
    }
  },

  setFilterTags: (tagIds: string[]) => {
    set((state: OKRStore) => {
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: tagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterTagIds: tagIds };
    });
  },

  toggleFilterTag: (tagId: string) => {
    set((state: OKRStore) => {
      const filterTagIds = state.filterTagIds.includes(tagId)
        ? state.filterTagIds.filter((id: string) => id !== tagId)
        : [...state.filterTagIds, tagId];
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterTagIds };
    });
  },

  setFilterTeams: (teamIds: string[]) => {
    set((state: OKRStore) => {
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: teamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterTeamIds: teamIds };
    });
  },

  toggleFilterTeam: (teamId: string) => {
    set((state: OKRStore) => {
      const filterTeamIds = state.filterTeamIds.includes(teamId)
        ? state.filterTeamIds.filter((id: string) => id !== teamId)
        : [...state.filterTeamIds, teamId];
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterTeamIds };
    });
  },

  toggleFilterType: (type: ObjectiveType) => {
    set((state: OKRStore) => {
      const filterTypes = state.filterTypes.includes(type)
        ? state.filterTypes.filter((t: ObjectiveType) => t !== type)
        : [...state.filterTypes, type];
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterTypes };
    });
  },

  toggleFilterTypeNotSet: () => {
    set((state: OKRStore) => {
      const filterTypeNotSet = !state.filterTypeNotSet;
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterTypeNotSet };
    });
  },

  setFilterOwners: (ownerIds: string[]) => {
    set((state: OKRStore) => {
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: ownerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterOwnerIds: ownerIds };
    });
  },

  toggleFilterOwner: (ownerId: string) => {
    set((state: OKRStore) => {
      const filterOwnerIds = state.filterOwnerIds.includes(ownerId)
        ? state.filterOwnerIds.filter((id: string) => id !== ownerId)
        : [...state.filterOwnerIds, ownerId];
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterOwnerIds };
    });
  },

  setFilterOwnerOperator: (operator: FilterOperator) => {
    set((state: OKRStore) => {
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: operator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterOwnerOperator: operator };
    });
  },

  setFilterAssignees: (assigneeIds: string[]) => {
    set((state: OKRStore) => {
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: assigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterAssigneeIds: assigneeIds };
    });
  },

  toggleFilterAssignee: (assigneeId: string) => {
    set((state: OKRStore) => {
      const filterAssigneeIds = state.filterAssigneeIds.includes(assigneeId)
        ? state.filterAssigneeIds.filter((id: string) => id !== assigneeId)
        : [...state.filterAssigneeIds, assigneeId];
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterAssigneeIds };
    });
  },

  setFilterAssigneeOperator: (operator: FilterOperator) => {
    set((state: OKRStore) => {
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: operator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterAssigneeOperator: operator };
    });
  },

  toggleFilterAssigneeNotSet: () => {
    set((state: OKRStore) => {
      const filterAssigneeNotSet = !state.filterAssigneeNotSet;
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterAssigneeNotSet };
    });
  },

  setFilterNextStepDate: (filter: NextStepDateFilter | null) => {
    set((state: OKRStore) => {
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: filter, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterNextStepDate: filter };
    });
  },

  toggleFilterLevel: (level: ObjectiveLevel) => {
    set((state: OKRStore) => {
      const filterLevels = state.filterLevels.includes(level)
        ? state.filterLevels.filter((l: ObjectiveLevel) => l !== level)
        : [...state.filterLevels, level];
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterLevels };
    });
  },

  setFilterObjective: (objectiveId: string | null) => {
    set((state: OKRStore) => {
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: objectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterObjectiveId: objectiveId };
    });
  },

  setFilterRootObjective: (objectiveId: string | null) => {
    set((state: OKRStore) => ({ ...state, filterRootObjectiveId: objectiveId }));
  },

  setShowListMembership: (v: boolean) => {
    set((state: OKRStore) => ({ ...state, showListMembership: v }));
  },

  setListMembershipListId: (id: string | null) => {
    set((state: OKRStore) => ({ ...state, listMembershipListId: id }));
  },

  toggleFilterWorkflowStatus: (status: WorkflowStatus) => {
    set((state: OKRStore) => {
      const filterWorkflowStatuses = state.filterWorkflowStatuses.includes(status)
        ? state.filterWorkflowStatuses.filter((s: WorkflowStatus) => s !== status)
        : [...state.filterWorkflowStatuses, status];
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses, filterKeyResultsOnly: state.filterKeyResultsOnly, filterListIds: state.filterListIds, filterListShowChildren: state.filterListShowChildren });
      return { ...state, filterWorkflowStatuses };
    });
  },

  toggleFilterKeyResultsOnly: () => {
    set((state: OKRStore) => {
      const filterKeyResultsOnly = !state.filterKeyResultsOnly;
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses, filterKeyResultsOnly, filterListIds: state.filterListIds, filterListShowChildren: state.filterListShowChildren });
      return { ...state, filterKeyResultsOnly };
    });
  },

  toggleFilterList: (listId: string) => {
    set((state: OKRStore) => {
      const filterListIds = state.filterListIds.includes(listId)
        ? state.filterListIds.filter(id => id !== listId)
        : [...state.filterListIds, listId];
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses, filterKeyResultsOnly: state.filterKeyResultsOnly, filterListIds, filterListShowChildren: state.filterListShowChildren });
      return { ...state, filterListIds };
    });
  },

  clearFilterLists: () => {
    set((state: OKRStore) => {
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses, filterKeyResultsOnly: state.filterKeyResultsOnly, filterListIds: [], filterListShowChildren: state.filterListShowChildren });
      return { ...state, filterListIds: [] };
    });
  },

  toggleFilterListShowChildren: () => {
    set((state: OKRStore) => {
      const filterListShowChildren = !state.filterListShowChildren;
      saveFilterState({ filterPeriodIds: state.filterPeriodIds, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses, filterKeyResultsOnly: state.filterKeyResultsOnly, filterListIds: state.filterListIds, filterListShowChildren });
      return { ...state, filterListShowChildren };
    });
  },

  setOpenChildrenOnly: (value: boolean) => {
    set({ openChildrenOnly: value });
  },

  clearAllFilters: () => {
    set((state: OKRStore) => {
      saveFilterState({ filterPeriodIds: [], filterTagIds: [], filterTeamIds: [], filterTypes: [], filterTypeNotSet: false, filterOwnerIds: [], filterOwnerOperator: 'equals', filterAssigneeIds: [], filterAssigneeOperator: 'equals', filterAssigneeNotSet: false, filterNextStepDate: null, filterLevels: [], filterObjectiveId: null, filterWorkflowStatuses: [], filterKeyResultsOnly: false, filterListIds: [], filterListShowChildren: false });
      return {
        ...state,
        filterPeriodIds: [],
        filterTagIds: [],
        filterTeamIds: [],
        filterTypes: [],
        filterTypeNotSet: false,
        filterOwnerIds: [],
        filterOwnerOperator: 'equals',
        filterAssigneeIds: [],
        filterAssigneeOperator: 'equals',
        filterAssigneeNotSet: false,
        filterNextStepDate: null,
        filterLevels: [],
        filterObjectiveId: null,
        filterRootObjectiveId: null,
        filterWorkflowStatuses: [],
        filterKeyResultsOnly: false,
        filterListIds: [],
        filterListShowChildren: false,
        openChildrenOnly: false,
      };
    });
  },

  recalculateProgress: () => {
    set((state: OKRStore) => recalculateAllProgress(state));
  },

  // Legacy domain functions - kept for compatibility but not used with server storage
  addAllowedDomain: (_domain: string) => {
    // No-op: domains are now managed on the server
  },

  deleteAllowedDomain: (_domain: string) => {
    // No-op: domains are now managed on the server
  },

  exportData: (): BackupData => {
    const state = get();
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      objectives: state.objectives,
      keyResults: state.keyResults,
      teams: state.teams,
      periods: state.periods,
      tags: state.tags,
      lists: state.lists,
      plans: state.plans,
    };
  },

  importData: async (data: BackupData) => {
    set((state: OKRStore) => {
      const newState = {
        ...state,
        objectives: data.objectives || [],
        keyResults: data.keyResults || [],
        teams: data.teams || [],
        periods: data.periods || [],
        tags: data.tags || [],
        lists: data.lists || [],
        activePeriodId: null,
        filterTagIds: [],
        filterTeamIds: [],
        filterTypes: [] as ObjectiveType[],
        filterTypeNotSet: false,
        filterOwnerIds: [],
        filterOwnerOperator: 'equals' as FilterOperator,
        filterAssigneeIds: [],
        filterAssigneeOperator: 'equals' as FilterOperator,
        filterNextStepDate: null,
        filterLevels: [] as ObjectiveLevel[],
        filterObjectiveId: null,
      };
      saveFilterState({ activePeriodId: null, filterTagIds: [], filterTeamIds: [], filterTypes: [], filterTypeNotSet: false, filterOwnerIds: [], filterOwnerOperator: 'equals', filterAssigneeIds: [], filterAssigneeOperator: 'equals', filterNextStepDate: null, filterLevels: [], filterObjectiveId: null, filterWorkflowStatuses: [] });
      return recalculateAllProgress(newState);
    });

    // Save lists to server
    if (data.lists && data.lists.length > 0) {
      try {
        await fetch(`${API_URL}/api/users/me/lists`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ lists: data.lists }),
        });
      } catch (err) {
        console.error('Failed to import lists:', err);
      }
    }

    // Restore plans (and clear last selected if absent in backup)
    if (data.plans !== undefined) {
      const plans = data.plans || [];
      set({ plans, activePlanId: null, lastSelectedPlanId: null });
      try {
        await fetch(`${API_URL}/api/users/me/preferences`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferences: { plans, lastSelectedPlanId: null } }),
        });
      } catch (err) {
        console.error('Failed to import plans:', err);
      }
    }
  },

  fetchUserPreferences: async () => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/preferences`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        const updates: Partial<OKRStore> = {};
        if (data.preferences?.editorWidth) {
          updates.editorWidth = data.preferences.editorWidth;
        }
        if (data.preferences?.columnWidths) {
          updates.columnWidths = { ...DEFAULT_COLUMN_WIDTHS, ...data.preferences.columnWidths };
        }
        if (data.preferences?.visibleColumns && Array.isArray(data.preferences.visibleColumns)) {
          updates.visibleColumns = data.preferences.visibleColumns;
        }
        if (data.preferences?.evergreenOverdueColumns && Array.isArray(data.preferences.evergreenOverdueColumns)) {
          updates.evergreenOverdueColumns = data.preferences.evergreenOverdueColumns;
        }
        if (data.preferences?.evergreenOverdueStatuses && Array.isArray(data.preferences.evergreenOverdueStatuses)) {
          updates.evergreenOverdueStatuses = data.preferences.evergreenOverdueStatuses;
        }
        if (data.preferences?.evergreenOverduePeriodIds && Array.isArray(data.preferences.evergreenOverduePeriodIds)) {
          updates.evergreenOverduePeriodIds = data.preferences.evergreenOverduePeriodIds;
        }
        if (data.preferences?.evergreenOverdueViewMode === 'tree' || data.preferences?.evergreenOverdueViewMode === 'table') {
          updates.evergreenOverdueViewMode = data.preferences.evergreenOverdueViewMode;
        }
        if (data.preferences?.listViewModes && typeof data.preferences.listViewModes === 'object') {
          updates.listViewModes = data.preferences.listViewModes;
        }
        if (data.preferences?.listPlanColumns && Array.isArray(data.preferences.listPlanColumns)) {
          updates.listPlanColumns = data.preferences.listPlanColumns;
        }
        if (['table', 'cards', 'list'].includes(data.preferences?.listPlanChildView)) {
          updates.listPlanChildView = data.preferences.listPlanChildView;
        }
        if (['table', 'cards', 'list'].includes(data.preferences?.listPlanTreeView)) {
          updates.listPlanTreeView = data.preferences.listPlanTreeView;
        }
        if (['table', 'cards', 'list'].includes(data.preferences?.listPlanCurrentView)) {
          updates.listPlanCurrentView = data.preferences.listPlanCurrentView;
        }
        if (data.preferences?.objectiveViewMode === 'explore' || data.preferences?.objectiveViewMode === 'plan') {
          updates.objectiveViewMode = data.preferences.objectiveViewMode;
        }
        if (data.preferences?.planViewColumns && Array.isArray(data.preferences.planViewColumns)) {
          updates.planViewColumns = data.preferences.planViewColumns;
        }
        if (data.preferences?.planTreeColumns && Array.isArray(data.preferences.planTreeColumns)) {
          updates.planTreeColumns = data.preferences.planTreeColumns;
        }
        if (data.preferences?.plans && Array.isArray(data.preferences.plans)) {
          updates.plans = data.preferences.plans;
        }
        if (typeof data.preferences?.lastSelectedPlanId === 'string' || data.preferences?.lastSelectedPlanId === null) {
          updates.lastSelectedPlanId = data.preferences.lastSelectedPlanId;
        }
        const savedFilters = data.preferences?.filters;
        if (savedFilters && typeof savedFilters === 'object') {
          if (Array.isArray(savedFilters.filterPeriodIds)) updates.filterPeriodIds = savedFilters.filterPeriodIds;
          if (Array.isArray(savedFilters.filterTagIds)) updates.filterTagIds = savedFilters.filterTagIds;
          if (Array.isArray(savedFilters.filterTeamIds)) updates.filterTeamIds = savedFilters.filterTeamIds;
          if (Array.isArray(savedFilters.filterTypes)) updates.filterTypes = savedFilters.filterTypes;
          if (typeof savedFilters.filterTypeNotSet === 'boolean') updates.filterTypeNotSet = savedFilters.filterTypeNotSet;
          if (Array.isArray(savedFilters.filterOwnerIds)) updates.filterOwnerIds = savedFilters.filterOwnerIds;
          if (savedFilters.filterOwnerOperator === 'equals' || savedFilters.filterOwnerOperator === 'not_equals') updates.filterOwnerOperator = savedFilters.filterOwnerOperator;
          if (Array.isArray(savedFilters.filterAssigneeIds)) updates.filterAssigneeIds = savedFilters.filterAssigneeIds;
          if (savedFilters.filterAssigneeOperator === 'equals' || savedFilters.filterAssigneeOperator === 'not_equals') updates.filterAssigneeOperator = savedFilters.filterAssigneeOperator;
          if (typeof savedFilters.filterAssigneeNotSet === 'boolean') updates.filterAssigneeNotSet = savedFilters.filterAssigneeNotSet;
          if (savedFilters.filterNextStepDate === null || typeof savedFilters.filterNextStepDate === 'string') updates.filterNextStepDate = savedFilters.filterNextStepDate;
          if (Array.isArray(savedFilters.filterLevels)) updates.filterLevels = savedFilters.filterLevels;
          if (savedFilters.filterObjectiveId === null || typeof savedFilters.filterObjectiveId === 'string') updates.filterObjectiveId = savedFilters.filterObjectiveId;
          if (Array.isArray(savedFilters.filterWorkflowStatuses)) updates.filterWorkflowStatuses = savedFilters.filterWorkflowStatuses;
          if (typeof savedFilters.filterKeyResultsOnly === 'boolean') updates.filterKeyResultsOnly = savedFilters.filterKeyResultsOnly;
          if (Array.isArray(savedFilters.filterListIds)) updates.filterListIds = savedFilters.filterListIds;
          if (typeof savedFilters.filterListShowChildren === 'boolean') updates.filterListShowChildren = savedFilters.filterListShowChildren;
        }
        if (Object.keys(updates).length > 0) {
          set(updates);
        }
        // Auto-apply the last selected plan so its filters are restored.
        const after = get();
        if (after.lastSelectedPlanId && !after.activePlanId) {
          const plan = after.plans.find(p => p.id === after.lastSelectedPlanId);
          if (plan) {
            set({ planFilters: { ...plan.filters }, activePlanId: plan.id });
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch user preferences:', err);
    }
  },

  setEditorWidth: async (width: number) => {
    set({ editorWidth: width });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          preferences: { editorWidth: width },
        }),
      });
    } catch (err) {
      console.error('Failed to save editor width preference:', err);
    }
  },

  setColumnWidths: async (widths: Partial<ColumnWidths>) => {
    const state = get();
    const newColumnWidths = { ...state.columnWidths, ...widths };
    set({ columnWidths: newColumnWidths });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          preferences: { columnWidths: newColumnWidths },
        }),
      });
    } catch (err) {
      console.error('Failed to save column widths preference:', err);
    }
  },

  setVisibleColumns: async (columns: ColumnKey[]) => {
    set({ visibleColumns: columns });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          preferences: { visibleColumns: columns },
        }),
      });
    } catch (err) {
      console.error('Failed to save visible columns preference:', err);
    }
  },

  toggleColumnVisibility: async (column: ColumnKey) => {
    const state = get();
    // Title column cannot be hidden
    if (column === 'title') return;

    const newVisibleColumns = state.visibleColumns.includes(column)
      ? state.visibleColumns.filter(c => c !== column)
      : [...state.visibleColumns, column];

    set({ visibleColumns: newVisibleColumns });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          preferences: { visibleColumns: newVisibleColumns },
        }),
      });
    } catch (err) {
      console.error('Failed to save visible columns preference:', err);
    }
  },

  setEvergreenOverdueColumns: async (columns: ColumnKey[]) => {
    set({ evergreenOverdueColumns: columns });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { evergreenOverdueColumns: columns } }),
      });
    } catch (err) {
      console.error('Failed to save evergreen overdue columns preference:', err);
    }
  },

  setEvergreenOverdueStatuses: async (statuses: WorkflowStatus[]) => {
    set({ evergreenOverdueStatuses: statuses });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { evergreenOverdueStatuses: statuses } }),
      });
    } catch (err) {
      console.error('Failed to save evergreen overdue statuses preference:', err);
    }
  },

  setEvergreenOverdueViewMode: async (mode) => {
    set({ evergreenOverdueViewMode: mode });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { evergreenOverdueViewMode: mode } }),
      });
    } catch (err) {
      console.error('Failed to save evergreen overdue view mode preference:', err);
    }
  },

  setListViewMode: async (listId, mode) => {
    const state = get();
    const listViewModes = { ...state.listViewModes, [listId]: mode };
    set({ listViewModes });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { listViewModes } }),
      });
    } catch (err) {
      console.error('Failed to save list view mode preference:', err);
    }
  },

  setListPlanColumns: async (columns) => {
    set({ listPlanColumns: columns });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { listPlanColumns: columns } }),
      });
    } catch (err) {
      console.error('Failed to save list plan columns preference:', err);
    }
  },

  setListPlanChildView: async (mode) => {
    set({ listPlanChildView: mode });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { listPlanChildView: mode } }),
      });
    } catch (err) {
      console.error('Failed to save list plan child view preference:', err);
    }
  },

  setListPlanTreeView: async (mode) => {
    set({ listPlanTreeView: mode });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { listPlanTreeView: mode } }),
      });
    } catch (err) {
      console.error('Failed to save list plan tree view preference:', err);
    }
  },

  setListPlanCurrentView: async (mode) => {
    set({ listPlanCurrentView: mode });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { listPlanCurrentView: mode } }),
      });
    } catch (err) {
      console.error('Failed to save list plan current view preference:', err);
    }
  },

  toggleListPlanColumn: async (column) => {
    const state = get();
    if (column === 'title') return;
    const next = state.listPlanColumns.includes(column)
      ? state.listPlanColumns.filter(c => c !== column)
      : [...state.listPlanColumns, column];
    set({ listPlanColumns: next });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { listPlanColumns: next } }),
      });
    } catch (err) {
      console.error('Failed to save list plan columns preference:', err);
    }
  },

  setEvergreenOverduePeriodIds: async (ids) => {
    set({ evergreenOverduePeriodIds: ids });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { evergreenOverduePeriodIds: ids } }),
      });
    } catch (err) {
      console.error('Failed to save evergreen overdue periods preference:', err);
    }
  },

  toggleEvergreenOverdueColumn: async (column: ColumnKey) => {
    const state = get();
    if (column === 'title') return;
    const next = state.evergreenOverdueColumns.includes(column)
      ? state.evergreenOverdueColumns.filter(c => c !== column)
      : [...state.evergreenOverdueColumns, column];
    set({ evergreenOverdueColumns: next });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { evergreenOverdueColumns: next } }),
      });
    } catch (err) {
      console.error('Failed to save evergreen overdue columns preference:', err);
    }
  },

  setObjectiveViewMode: async (mode) => {
    set({ objectiveViewMode: mode });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { objectiveViewMode: mode } }),
      });
    } catch (err) {
      console.error('Failed to save objective view mode preference:', err);
    }
  },

  setPlanViewColumns: async (columns: ColumnKey[]) => {
    set({ planViewColumns: columns });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { planViewColumns: columns } }),
      });
    } catch (err) {
      console.error('Failed to save plan view columns preference:', err);
    }
  },

  togglePlanViewColumn: async (column: ColumnKey) => {
    const state = get();
    if (column === 'title') return;
    const next = state.planViewColumns.includes(column)
      ? state.planViewColumns.filter(c => c !== column)
      : [...state.planViewColumns, column];
    set({ planViewColumns: next });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { planViewColumns: next } }),
      });
    } catch (err) {
      console.error('Failed to save plan view columns preference:', err);
    }
  },

  setPlanTreeColumns: async (columns) => {
    set({ planTreeColumns: columns });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { planTreeColumns: columns } }),
      });
    } catch (err) {
      console.error('Failed to save plan tree columns preference:', err);
    }
  },

  togglePlanTreeColumn: async (column) => {
    const state = get();
    if (column === 'title') return;
    const next = state.planTreeColumns.includes(column)
      ? state.planTreeColumns.filter(c => c !== column)
      : [...state.planTreeColumns, column];
    set({ planTreeColumns: next });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { planTreeColumns: next } }),
      });
    } catch (err) {
      console.error('Failed to save plan tree columns preference:', err);
    }
  },

  setPlanFilters: (filters) => {
    set({ planFilters: filters });
  },

  addPlan: async (name) => {
    const state = get();
    const trimmed = name.trim();
    if (!trimmed) return;
    const newPlan = {
      id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: trimmed,
      filters: { ...state.planFilters },
    };
    const plans = [...state.plans, newPlan];
    set({ plans, activePlanId: newPlan.id, lastSelectedPlanId: newPlan.id });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { plans, lastSelectedPlanId: newPlan.id } }),
      });
    } catch (err) {
      console.error('Failed to save plan:', err);
    }
  },

  deletePlan: async (id) => {
    const state = get();
    const plans = state.plans.filter(p => p.id !== id);
    const newLast = state.lastSelectedPlanId === id ? null : state.lastSelectedPlanId;
    set({
      plans,
      activePlanId: state.activePlanId === id ? null : state.activePlanId,
      lastSelectedPlanId: newLast,
    });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { plans, lastSelectedPlanId: newLast } }),
      });
    } catch (err) {
      console.error('Failed to delete plan:', err);
    }
  },

  applyPlan: (id) => {
    const state = get();
    const plan = state.plans.find(p => p.id === id);
    if (!plan) return;
    set({ planFilters: { ...plan.filters }, activePlanId: id, lastSelectedPlanId: id });
    fetch(`${API_URL}/api/users/me/preferences`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { lastSelectedPlanId: id } }),
    }).catch(err => console.error('Failed to save last selected plan:', err));
  },

  setHighlightObjectiveId: (id) => {
    set({ highlightObjectiveId: id });
  },

  setForcedExpandedIds: (ids) => {
    set({ forcedExpandedIds: ids });
  },

  setPlanFocusListId: (id) => {
    set({ planFocusListId: id });
  },

  savePlanVersion: async (planId, itemIds) => {
    const state = get();
    const newVersion = {
      id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      itemIds,
    };
    const plans = state.plans.map(p =>
      p.id === planId ? { ...p, versions: [...(p.versions || []), newVersion] } : p
    );
    set({ plans });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { plans } }),
      });
    } catch (err) {
      console.error('Failed to save plan version:', err);
    }
  },

  updatePlanFilters: async (planId) => {
    const state = get();
    const plans = state.plans.map(p => p.id === planId ? { ...p, filters: { ...state.planFilters } } : p);
    set({ plans, activePlanId: planId, lastSelectedPlanId: planId });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { plans, lastSelectedPlanId: planId } }),
      });
    } catch (err) {
      console.error('Failed to update plan filters:', err);
    }
  },

  togglePlanHideChildren: async (planId, objectiveId) => {
    const state = get();
    const plans = state.plans.map(p => {
      if (p.id !== planId) return p;
      const current = p.hiddenChildrenOf || [];
      const hiddenChildrenOf = current.includes(objectiveId)
        ? current.filter(x => x !== objectiveId)
        : [...current, objectiveId];
      return { ...p, hiddenChildrenOf };
    });
    set({ plans });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { plans } }),
      });
    } catch (err) {
      console.error('Failed to save plan hide-children:', err);
    }
  },

  togglePlanExclusion: async (planId, objectiveId) => {
    const state = get();
    const plans = state.plans.map(p => {
      if (p.id !== planId) return p;
      const current = p.exclusions || [];
      const exclusions = current.includes(objectiveId)
        ? current.filter(x => x !== objectiveId)
        : [...current, objectiveId];
      return { ...p, exclusions };
    });
    set({ plans });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { plans } }),
      });
    } catch (err) {
      console.error('Failed to save plan exclusion:', err);
    }
  },

  togglePlanReplacement: async (planId, objectiveId) => {
    const state = get();
    const plans = state.plans.map(p => {
      if (p.id !== planId) return p;
      const current = p.replacements || [];
      const replacements = current.includes(objectiveId)
        ? current.filter(x => x !== objectiveId)
        : [...current, objectiveId];
      return { ...p, replacements };
    });
    set({ plans });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { plans } }),
      });
    } catch (err) {
      console.error('Failed to save plan replacement:', err);
    }
  },

  reorderPlanItems: async (id, orderedIds) => {
    const state = get();
    const ranks: Record<string, number> = {};
    orderedIds.forEach((oid, i) => { ranks[oid] = i + 1; });
    const plans = state.plans.map(p => p.id === id ? { ...p, ranks } : p);
    set({ plans });
    try {
      await fetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { plans } }),
      });
    } catch (err) {
      console.error('Failed to save plan ranks:', err);
    }
  },

  // Saved Views
  fetchViews: async () => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/views`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        console.log('fetchViews response:', data);
        const views = Array.isArray(data.views) ? data.views : [];
        console.log('Setting savedViews from fetchViews:', views);
        set({ savedViews: views });

        // Auto-apply default view if one exists and no view is active
        const state = get();
        if (!state.activeViewId) {
          const defaultView = views.find((v: SavedView) => v.isDefault);
          if (defaultView) {
            get().applyView(defaultView.id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch views:', err);
    }
  },

  createView: async (name: string, isDefault: boolean = false) => {
    const state = get();

    // Capture current filter state
    const filters: SavedViewFilters = {
      filterPeriodIds: state.filterPeriodIds,
      filterTagIds: state.filterTagIds,
      filterTeamIds: state.filterTeamIds,
      filterTypes: state.filterTypes,
      filterTypeNotSet: state.filterTypeNotSet,
      filterOwnerIds: state.filterOwnerIds,
      filterOwnerOperator: state.filterOwnerOperator,
      filterAssigneeIds: state.filterAssigneeIds,
      filterAssigneeOperator: state.filterAssigneeOperator,
      filterNextStepDate: state.filterNextStepDate,
      filterLevels: state.filterLevels,
      filterObjectiveId: state.filterObjectiveId,
      openChildrenOnly: state.openChildrenOnly,
    };

    try {
      const response = await fetch(`${API_URL}/api/users/me/views`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          isDefault,
          filters,
          visibleColumns: state.visibleColumns,
          columnWidths: state.columnWidths,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log('createView response:', data);
        const newViewId = data.view?.id;
        const newViews = Array.isArray(data.views) ? data.views : [];
        console.log('Setting savedViews:', newViews, 'activeViewId:', newViewId);
        set({
          savedViews: newViews,
          activeViewId: newViewId || null,
        });
        return data.view;
      } else {
        console.error('Failed to create view, response not ok:', response.status);
      }
    } catch (err) {
      console.error('Failed to create view:', err);
    }
    return null;
  },

  updateView: async (viewId: string) => {
    const state = get();

    // Capture current filter state
    const filters: SavedViewFilters = {
      filterPeriodIds: state.filterPeriodIds,
      filterTagIds: state.filterTagIds,
      filterTeamIds: state.filterTeamIds,
      filterTypes: state.filterTypes,
      filterTypeNotSet: state.filterTypeNotSet,
      filterOwnerIds: state.filterOwnerIds,
      filterOwnerOperator: state.filterOwnerOperator,
      filterAssigneeIds: state.filterAssigneeIds,
      filterAssigneeOperator: state.filterAssigneeOperator,
      filterNextStepDate: state.filterNextStepDate,
      filterLevels: state.filterLevels,
      filterObjectiveId: state.filterObjectiveId,
      openChildrenOnly: state.openChildrenOnly,
    };

    try {
      const response = await fetch(`${API_URL}/api/users/me/views/${viewId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters,
          visibleColumns: state.visibleColumns,
          columnWidths: state.columnWidths,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        set({ savedViews: data.views });
      }
    } catch (err) {
      console.error('Failed to update view:', err);
    }
  },

  deleteView: async (viewId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/views/${viewId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        const state = get();
        set({
          savedViews: data.views,
          // Clear active view if we deleted the current one
          activeViewId: state.activeViewId === viewId ? null : state.activeViewId,
        });
      }
    } catch (err) {
      console.error('Failed to delete view:', err);
    }
  },

  applyView: (viewId: string) => {
    const state = get();
    const view = state.savedViews.find(v => v.id === viewId);
    if (!view) return;

    const filters = view.filters;
    const newState = {
      filterPeriodIds: (filters.filterPeriodIds || []) as string[],
      filterTagIds: filters.filterTagIds || [],
      filterTeamIds: filters.filterTeamIds || [],
      filterTypes: (filters.filterTypes || []) as ObjectiveType[],
      filterTypeNotSet: filters.filterTypeNotSet || false,
      filterOwnerIds: filters.filterOwnerIds || [],
      filterOwnerOperator: (filters.filterOwnerOperator || 'equals') as FilterOperator,
      filterAssigneeIds: filters.filterAssigneeIds || [],
      filterAssigneeOperator: (filters.filterAssigneeOperator || 'equals') as FilterOperator,
      filterNextStepDate: filters.filterNextStepDate || null,
      filterLevels: (filters.filterLevels || []) as ObjectiveLevel[],
      filterObjectiveId: filters.filterObjectiveId || null,
      openChildrenOnly: filters.openChildrenOnly || false,
      visibleColumns: view.visibleColumns?.length ? view.visibleColumns as ColumnKey[] : DEFAULT_VISIBLE_COLUMNS,
      columnWidths: view.columnWidths ? { ...DEFAULT_COLUMN_WIDTHS, ...view.columnWidths } : DEFAULT_COLUMN_WIDTHS,
      activeViewId: viewId,
    };

    set(newState);
    saveFilterState({
      filterPeriodIds: newState.filterPeriodIds,
      filterTagIds: newState.filterTagIds,
      filterTeamIds: newState.filterTeamIds,
      filterTypes: newState.filterTypes,
      filterTypeNotSet: newState.filterTypeNotSet,
      filterOwnerIds: newState.filterOwnerIds,
      filterOwnerOperator: newState.filterOwnerOperator,
      filterAssigneeIds: newState.filterAssigneeIds,
      filterAssigneeOperator: newState.filterAssigneeOperator,
      filterNextStepDate: newState.filterNextStepDate,
      filterLevels: newState.filterLevels,
      filterObjectiveId: newState.filterObjectiveId,
      filterWorkflowStatuses: newState.filterWorkflowStatuses,
    });
  },

  setDefaultView: async (viewId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/views/${viewId}/default`, {
        method: 'PUT',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        set({ savedViews: data.views });
      }
    } catch (err) {
      console.error('Failed to set default view:', err);
    }
  },

  clearActiveView: () => {
    set({ activeViewId: null });
  },

  renameView: async (viewId: string, newName: string) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/views/${viewId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newName }),
      });

      if (response.ok) {
        const data = await response.json();
        set({ savedViews: data.views });
      }
    } catch (err) {
      console.error('Failed to rename view:', err);
    }
  },

  toggleViewStarred: async (viewId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/views/${viewId}/starred`, {
        method: 'PUT',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        set({ savedViews: data.views });
      }
    } catch (err) {
      console.error('Failed to toggle view starred:', err);
    }
  },

  // Lists
  fetchLists: async () => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        set({ lists: data.lists || [] });
      }
    } catch (err) {
      console.error('Failed to fetch lists:', err);
    }
  },

  fetchSharedPlans: async () => {
    try {
      const response = await fetch(`${API_URL}/api/org/shared-plans`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        set({ sharedPlans: data.lists || [] });
      }
    } catch (err) {
      console.error('Failed to fetch shared plans:', err);
    }
  },

  createList: async (name: string, color?: string, parentId?: string, meta?: { ownerId?: string; periodId?: string; level?: import('../types').ObjectiveLevel; shared?: boolean }) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, color: color || '#6b7280', parentId, ownerId: meta?.ownerId, periodId: meta?.periodId, level: meta?.level || undefined, shared: meta?.shared === true ? true : undefined }),
      });

      if (response.ok) {
        const data = await response.json();
        let list = data.list;
        let lists: List[] = data.lists || [];
        if (parentId && list && !list.parentId) {
          list = { ...list, parentId };
          lists = lists.map((l: List) => l.id === list.id ? list : l);
        }
        if (meta?.ownerId && list && !list.ownerId) {
          list = { ...list, ownerId: meta.ownerId };
          lists = lists.map((l: List) => l.id === list.id ? list : l);
        }
        if (meta?.periodId && list && !list.periodId) {
          list = { ...list, periodId: meta.periodId };
          lists = lists.map((l: List) => l.id === list.id ? list : l);
        }
        // Preserve any locally-known metadata (parentId, ownerId, periodId) for OTHER lists
        // in case the running server is on older code and strips those fields from the response.
        const prevById = new Map(get().lists.map(l => [l.id, l]));
        lists = lists.map((l: List) => {
          const prev = prevById.get(l.id);
          if (!prev) return l;
          return {
            ...l,
            parentId: l.parentId ?? prev.parentId,
            ownerId: l.ownerId ?? prev.ownerId,
            periodId: l.periodId ?? prev.periodId,
          };
        });
        set({ lists });
        return list;
      }
      const errData = await response.json().catch(() => ({}));
      return { error: errData.error || `Failed to create list (HTTP ${response.status})` };
    } catch (err) {
      console.error('Failed to create list:', err);
    }
    return null;
  },

  deleteList: async (listId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists/${listId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        set({ lists: data.lists });
      }
    } catch (err) {
      console.error('Failed to delete list:', err);
    }
  },

  renameList: async (listId: string, newName: string) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists/${listId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newName }),
      });

      if (response.ok) {
        const data = await response.json();
        set({ lists: data.lists });
      }
    } catch (err) {
      console.error('Failed to rename list:', err);
    }
  },

  updateListColor: async (listId: string, color: string) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists/${listId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ color }),
      });

      if (response.ok) {
        const data = await response.json();
        set({ lists: data.lists });
      }
    } catch (err) {
      console.error('Failed to update list color:', err);
    }
  },

  setListShared: async (listId, shared) => {
    const state = get();
    const lists = state.lists.map(l => l.id === listId
      ? (shared ? { ...l, shared: true } : (() => { const { shared: _drop, ...rest } = l as List & { shared?: boolean }; void _drop; return rest as List; })())
      : l
    );
    set({ lists });
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists/${listId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shared }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.lists) set({ lists: data.lists });
      }
    } catch (err) {
      console.error('Failed to update list sharing:', err);
    }
  },

  setListLevel: async (listId, level) => {
    const state = get();
    const lists = state.lists.map(l => l.id === listId
      ? (level ? { ...l, level } : (() => { const { level: _drop, ...rest } = l as List & { level?: import('../types').ObjectiveLevel }; void _drop; return rest as List; })())
      : l
    );
    set({ lists });
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists/${listId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: level || null }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.lists) set({ lists: data.lists });
      }
    } catch (err) {
      console.error('Failed to update list level:', err);
    }
  },

  setListStatus: async (listId, status) => {
    const state = get();
    set({ lists: state.lists.map(l => (l.id === listId ? { ...l, status } : l)) });
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists/${listId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.lists) set({ lists: data.lists });
      }
    } catch (err) {
      console.error('Failed to update list status:', err);
    }
  },

  saveListScorecard: async (listId, scorecard) => {
    const state = get();
    set({ lists: state.lists.map(l => l.id === listId
      ? (scorecard ? { ...l, scorecard } : (() => { const { scorecard: _drop, ...rest } = l as List & { scorecard?: import('../types').PlanScorecard }; void _drop; return rest as List; })())
      : l
    ) });
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists/${listId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scorecard: scorecard ?? null }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.lists) set({ lists: data.lists });
      }
    } catch (err) {
      console.error('Failed to save plan scorecard:', err);
    }
  },

  setListOwner: async (listId, ownerId) => {
    const state = get();
    const lists = state.lists.map(l => l.id === listId
      ? (ownerId ? { ...l, ownerId } : (() => { const { ownerId: _drop, ...rest } = l as List & { ownerId?: string }; void _drop; return rest as List; })())
      : l
    );
    set({ lists });
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists/${listId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: ownerId || null }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.lists) set({ lists: data.lists });
      }
    } catch (err) {
      console.error('Failed to update list owner:', err);
    }
  },

  setListPeriod: async (listId, periodId) => {
    const state = get();
    const lists = state.lists.map(l => l.id === listId
      ? (periodId ? { ...l, periodId } : (() => { const { periodId: _drop, ...rest } = l as List & { periodId?: string }; void _drop; return rest as List; })())
      : l
    );
    set({ lists });
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists/${listId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodId: periodId || null }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.lists) set({ lists: data.lists });
      }
    } catch (err) {
      console.error('Failed to update list period:', err);
    }
  },

  updateListParent: async (listId, parentId) => {
    // Optimistic local update so the UI updates even if the server is on older code.
    const state = get();
    const lists = state.lists.map(l => l.id === listId
      ? (parentId ? { ...l, parentId } : (() => { const { parentId: _drop, ...rest } = l as List & { parentId?: string }; void _drop; return rest as List; })())
      : l
    );
    set({ lists });
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists/${listId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: parentId || null }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.lists) set({ lists: data.lists });
      }
    } catch (err) {
      console.error('Failed to update list parent:', err);
    }
  },

  addItemToList: async (listId: string, objectiveId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists/${listId}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ objectiveId }),
      });

      if (response.ok) {
        const data = await response.json();
        set({ lists: data.lists });
      }
    } catch (err) {
      console.error('Failed to add item to list:', err);
    }
  },

  removeItemFromList: async (listId: string, objectiveId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists/${listId}/items/${objectiveId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        set({ lists: data.lists });
      }
    } catch (err) {
      console.error('Failed to remove item from list:', err);
    }
  },

  reorderListItems: async (listId: string, items: { objectiveId: string; order: number }[], movedObjectiveId?: string) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists/${listId}/reorder`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ items, movedObjectiveId }),
      });

      if (response.ok) {
        const data = await response.json();
        set({ lists: data.lists });
      }
    } catch (err) {
      console.error('Failed to reorder list items:', err);
    }
  },
}));
