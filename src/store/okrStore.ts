import { create } from 'zustand';
import type { Objective, KeyResult, Team, Period, Tag, OKRState, ObjectiveHistoryEntry, FieldChange, FilterOperator, ObjectiveType, NextStepDateFilter, ObjectiveLevel, SavedView, SavedViewFilters, WorkflowStatus, List } from '../types';
import { api } from '../utils/api';
import { generateId, calculateObjectiveProgress, determineStatus, calculateKeyResultProgress } from '../utils/calculations';

const API_URL = import.meta.env.VITE_API_URL || '';

// Local storage for filter state only
const FILTER_STORAGE_KEY = 'okr-lite-filters';

function loadFilterState() {
  try {
    const data = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!data) return { activePeriodId: null, filterTagIds: [], filterTeamIds: [], filterTypes: [] as ObjectiveType[], filterTypeNotSet: false, filterOwnerIds: [], filterOwnerOperator: 'equals' as FilterOperator, filterAssigneeIds: [], filterAssigneeOperator: 'equals' as FilterOperator, filterAssigneeNotSet: false, filterNextStepDate: null as NextStepDateFilter | null, filterLevels: [] as ObjectiveLevel[], filterObjectiveId: null as string | null, filterWorkflowStatuses: [] as WorkflowStatus[], filterKeyResultsOnly: false, filterListId: null as string | null, filterListShowChildren: false };
    const parsed = JSON.parse(data);
    return {
      activePeriodId: parsed.activePeriodId || null,
      filterTagIds: parsed.filterTagIds || [],
      filterTeamIds: parsed.filterTeamIds || [],
      filterTypes: (parsed.filterTypes || []) as ObjectiveType[],
      filterTypeNotSet: parsed.filterTypeNotSet || false,
      filterOwnerIds: parsed.filterOwnerIds || [],
      filterOwnerOperator: (parsed.filterOwnerOperator || 'equals') as FilterOperator,
      filterAssigneeIds: parsed.filterAssigneeIds || [],
      filterAssigneeOperator: (parsed.filterAssigneeOperator || 'equals') as FilterOperator,
      filterAssigneeNotSet: parsed.filterAssigneeNotSet || false,
      filterNextStepDate: (parsed.filterNextStepDate || null) as NextStepDateFilter | null,
      filterLevels: (parsed.filterLevels || []) as ObjectiveLevel[],
      filterObjectiveId: (parsed.filterObjectiveId || null) as string | null,
      filterWorkflowStatuses: (parsed.filterWorkflowStatuses || []) as WorkflowStatus[],
      filterKeyResultsOnly: parsed.filterKeyResultsOnly || false,
      filterListId: (parsed.filterListId || null) as string | null,
      filterListShowChildren: parsed.filterListShowChildren || false,
    };
  } catch {
    return { activePeriodId: null, filterTagIds: [], filterTeamIds: [], filterTypes: [] as ObjectiveType[], filterTypeNotSet: false, filterOwnerIds: [], filterOwnerOperator: 'equals' as FilterOperator, filterAssigneeIds: [], filterAssigneeOperator: 'equals' as FilterOperator, filterAssigneeNotSet: false, filterNextStepDate: null as NextStepDateFilter | null, filterLevels: [] as ObjectiveLevel[], filterObjectiveId: null as string | null, filterWorkflowStatuses: [] as WorkflowStatus[], filterKeyResultsOnly: false, filterListId: null as string | null, filterListShowChildren: false };
  }
}

interface FilterState {
  activePeriodId: string | null;
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
  filterListId: string | null;
  filterListShowChildren: boolean;
}

function saveFilterState(state: FilterState) {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save filter state:', error);
  }
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
  setActivePeriod: (id: string | null) => void;

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
  filterWorkflowStatuses: WorkflowStatus[];
  toggleFilterWorkflowStatus: (status: WorkflowStatus) => void;
  filterKeyResultsOnly: boolean;
  toggleFilterKeyResultsOnly: () => void;
  filterListId: string | null;
  filterListShowChildren: boolean;
  setFilterList: (listId: string | null) => void;
  toggleFilterListShowChildren: () => void;
  clearAllFilters: () => void;

  // Allowed Domains (legacy - kept for compatibility)
  addAllowedDomain: (domain: string) => void;
  deleteAllowedDomain: (domain: string) => void;

  // Backup & Restore
  exportData: () => BackupData;
  importData: (data: BackupData) => void;

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

  // Lists
  lists: List[];
  fetchLists: () => Promise<void>;
  createList: (name: string, color?: string) => Promise<List | null>;
  deleteList: (listId: string) => Promise<void>;
  renameList: (listId: string, newName: string) => Promise<void>;
  updateListColor: (listId: string, color: string) => Promise<void>;
  addItemToList: (listId: string, objectiveId: string) => Promise<void>;
  removeItemFromList: (listId: string, objectiveId: string) => Promise<void>;
  reorderListItems: (listId: string, items: { objectiveId: string; order: number }[]) => Promise<void>;
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
  activePeriodId: null,
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
  filterWorkflowStatuses: [] as WorkflowStatus[],
  filterKeyResultsOnly: false,
  filterListId: null,
  filterListShowChildren: false,
};

export const useOKRStore = create<OKRStore>((set, get) => ({
  ...defaultState,
  ...loadFilterState(),
  isLoading: false,
  error: null,
  editorWidth: undefined,
  columnWidths: DEFAULT_COLUMN_WIDTHS,
  visibleColumns: DEFAULT_VISIBLE_COLUMNS,
  savedViews: [],
  activeViewId: null,
  lists: [],

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

    // Track changes
    const changes: FieldChange[] = [];

    if ('title' in updates && updates.title !== existingObj.title) {
      changes.push({ field: 'title', oldValue: existingObj.title, newValue: updates.title });
    }
    if ('description' in updates && updates.description !== existingObj.description) {
      changes.push({ field: 'description', oldValue: existingObj.description || '(empty)', newValue: updates.description || '(empty)' });
    }
    if ('level' in updates && updates.level !== existingObj.level) {
      changes.push({ field: 'level', oldValue: existingObj.level, newValue: updates.level });
    }
    if ('periodId' in updates && updates.periodId !== existingObj.periodId) {
      changes.push({ field: 'period', oldValue: getPeriodName(existingObj.periodId), newValue: getPeriodName(updates.periodId) });
    }
    if ('teamId' in updates && updates.teamId !== existingObj.teamId) {
      changes.push({ field: 'team', oldValue: getTeamName(existingObj.teamId) || '(none)', newValue: getTeamName(updates.teamId) || '(none)' });
    }
    if ('tagIds' in updates && JSON.stringify(updates.tagIds) !== JSON.stringify(existingObj.tagIds)) {
      changes.push({ field: 'tags', oldValue: getTagNames(existingObj.tagIds) || '(none)', newValue: getTagNames(updates.tagIds) || '(none)' });
    }
    if ('parentId' in updates && updates.parentId !== existingObj.parentId) {
      changes.push({ field: 'parent', oldValue: getObjectiveTitle(existingObj.parentId) || '(none)', newValue: getObjectiveTitle(updates.parentId) || '(none)' });
    }
    if ('shared' in updates && updates.shared !== existingObj.shared) {
      changes.push({ field: 'visibility', oldValue: existingObj.shared ? 'Shared' : 'Private', newValue: updates.shared ? 'Shared' : 'Private' });
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

    try {
      const updatedObjective = await api.updateObjective(id, { ...updates, history: updatedHistory });
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
          activePeriodId: state.activePeriodId === id ? null : state.activePeriodId,
        };
        saveFilterState({ activePeriodId: newState.activePeriodId, filterTagIds: newState.filterTagIds, filterTeamIds: newState.filterTeamIds, filterTypes: newState.filterTypes, filterTypeNotSet: newState.filterTypeNotSet, filterOwnerIds: newState.filterOwnerIds, filterOwnerOperator: newState.filterOwnerOperator, filterAssigneeIds: newState.filterAssigneeIds, filterAssigneeOperator: newState.filterAssigneeOperator, filterNextStepDate: newState.filterNextStepDate, filterLevels: newState.filterLevels, filterObjectiveId: newState.filterObjectiveId, filterWorkflowStatuses: newState.filterWorkflowStatuses });
        return newState;
      });
    } catch (error) {
      console.error('Failed to delete period:', error);
      throw error;
    }
  },

  setActivePeriod: (id: string | null) => {
    set((state: OKRStore) => {
      const newState = { ...state, activePeriodId: id };
      saveFilterState({ activePeriodId: id, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return newState;
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
        saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: newFilterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
        return newState;
      });
    } catch (error) {
      console.error('Failed to delete tag:', error);
      throw error;
    }
  },

  setFilterTags: (tagIds: string[]) => {
    set((state: OKRStore) => {
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: tagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterTagIds: tagIds };
    });
  },

  toggleFilterTag: (tagId: string) => {
    set((state: OKRStore) => {
      const filterTagIds = state.filterTagIds.includes(tagId)
        ? state.filterTagIds.filter((id: string) => id !== tagId)
        : [...state.filterTagIds, tagId];
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterTagIds };
    });
  },

  setFilterTeams: (teamIds: string[]) => {
    set((state: OKRStore) => {
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: teamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterTeamIds: teamIds };
    });
  },

  toggleFilterTeam: (teamId: string) => {
    set((state: OKRStore) => {
      const filterTeamIds = state.filterTeamIds.includes(teamId)
        ? state.filterTeamIds.filter((id: string) => id !== teamId)
        : [...state.filterTeamIds, teamId];
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterTeamIds };
    });
  },

  toggleFilterType: (type: ObjectiveType) => {
    set((state: OKRStore) => {
      const filterTypes = state.filterTypes.includes(type)
        ? state.filterTypes.filter((t: ObjectiveType) => t !== type)
        : [...state.filterTypes, type];
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterTypes };
    });
  },

  toggleFilterTypeNotSet: () => {
    set((state: OKRStore) => {
      const filterTypeNotSet = !state.filterTypeNotSet;
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterTypeNotSet };
    });
  },

  setFilterOwners: (ownerIds: string[]) => {
    set((state: OKRStore) => {
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: ownerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterOwnerIds: ownerIds };
    });
  },

  toggleFilterOwner: (ownerId: string) => {
    set((state: OKRStore) => {
      const filterOwnerIds = state.filterOwnerIds.includes(ownerId)
        ? state.filterOwnerIds.filter((id: string) => id !== ownerId)
        : [...state.filterOwnerIds, ownerId];
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterOwnerIds };
    });
  },

  setFilterOwnerOperator: (operator: FilterOperator) => {
    set((state: OKRStore) => {
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: operator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterOwnerOperator: operator };
    });
  },

  setFilterAssignees: (assigneeIds: string[]) => {
    set((state: OKRStore) => {
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: assigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterAssigneeIds: assigneeIds };
    });
  },

  toggleFilterAssignee: (assigneeId: string) => {
    set((state: OKRStore) => {
      const filterAssigneeIds = state.filterAssigneeIds.includes(assigneeId)
        ? state.filterAssigneeIds.filter((id: string) => id !== assigneeId)
        : [...state.filterAssigneeIds, assigneeId];
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterAssigneeIds };
    });
  },

  setFilterAssigneeOperator: (operator: FilterOperator) => {
    set((state: OKRStore) => {
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: operator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterAssigneeOperator: operator };
    });
  },

  toggleFilterAssigneeNotSet: () => {
    set((state: OKRStore) => {
      const filterAssigneeNotSet = !state.filterAssigneeNotSet;
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterAssigneeNotSet };
    });
  },

  setFilterNextStepDate: (filter: NextStepDateFilter | null) => {
    set((state: OKRStore) => {
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: filter, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterNextStepDate: filter };
    });
  },

  toggleFilterLevel: (level: ObjectiveLevel) => {
    set((state: OKRStore) => {
      const filterLevels = state.filterLevels.includes(level)
        ? state.filterLevels.filter((l: ObjectiveLevel) => l !== level)
        : [...state.filterLevels, level];
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterLevels };
    });
  },

  setFilterObjective: (objectiveId: string | null) => {
    set((state: OKRStore) => {
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: objectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses });
      return { ...state, filterObjectiveId: objectiveId };
    });
  },

  toggleFilterWorkflowStatus: (status: WorkflowStatus) => {
    set((state: OKRStore) => {
      const filterWorkflowStatuses = state.filterWorkflowStatuses.includes(status)
        ? state.filterWorkflowStatuses.filter((s: WorkflowStatus) => s !== status)
        : [...state.filterWorkflowStatuses, status];
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses, filterKeyResultsOnly: state.filterKeyResultsOnly, filterListId: state.filterListId, filterListShowChildren: state.filterListShowChildren });
      return { ...state, filterWorkflowStatuses };
    });
  },

  toggleFilterKeyResultsOnly: () => {
    set((state: OKRStore) => {
      const filterKeyResultsOnly = !state.filterKeyResultsOnly;
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses, filterKeyResultsOnly, filterListId: state.filterListId, filterListShowChildren: state.filterListShowChildren });
      return { ...state, filterKeyResultsOnly };
    });
  },

  setFilterList: (listId: string | null) => {
    set((state: OKRStore) => {
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses, filterKeyResultsOnly: state.filterKeyResultsOnly, filterListId: listId, filterListShowChildren: state.filterListShowChildren });
      return { ...state, filterListId: listId };
    });
  },

  toggleFilterListShowChildren: () => {
    set((state: OKRStore) => {
      const filterListShowChildren = !state.filterListShowChildren;
      saveFilterState({ activePeriodId: state.activePeriodId, filterTagIds: state.filterTagIds, filterTeamIds: state.filterTeamIds, filterTypes: state.filterTypes, filterTypeNotSet: state.filterTypeNotSet, filterOwnerIds: state.filterOwnerIds, filterOwnerOperator: state.filterOwnerOperator, filterAssigneeIds: state.filterAssigneeIds, filterAssigneeOperator: state.filterAssigneeOperator, filterAssigneeNotSet: state.filterAssigneeNotSet, filterNextStepDate: state.filterNextStepDate, filterLevels: state.filterLevels, filterObjectiveId: state.filterObjectiveId, filterWorkflowStatuses: state.filterWorkflowStatuses, filterKeyResultsOnly: state.filterKeyResultsOnly, filterListId: state.filterListId, filterListShowChildren });
      return { ...state, filterListShowChildren };
    });
  },

  clearAllFilters: () => {
    set((state: OKRStore) => {
      saveFilterState({ activePeriodId: null, filterTagIds: [], filterTeamIds: [], filterTypes: [], filterTypeNotSet: false, filterOwnerIds: [], filterOwnerOperator: 'equals', filterAssigneeIds: [], filterAssigneeOperator: 'equals', filterAssigneeNotSet: false, filterNextStepDate: null, filterLevels: [], filterObjectiveId: null, filterWorkflowStatuses: [], filterKeyResultsOnly: false, filterListId: null, filterListShowChildren: false });
      return {
        ...state,
        activePeriodId: null,
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
        filterWorkflowStatuses: [],
        filterKeyResultsOnly: false,
        filterListId: null,
        filterListShowChildren: false,
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
    };
  },

  importData: (data: BackupData) => {
    set((state: OKRStore) => {
      const newState = {
        ...state,
        objectives: data.objectives || [],
        keyResults: data.keyResults || [],
        teams: data.teams || [],
        periods: data.periods || [],
        tags: data.tags || [],
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
        if (Object.keys(updates).length > 0) {
          set(updates);
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
      activePeriodId: state.activePeriodId,
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
      activePeriodId: state.activePeriodId,
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
      activePeriodId: filters.activePeriodId,
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
      visibleColumns: view.visibleColumns?.length ? view.visibleColumns as ColumnKey[] : DEFAULT_VISIBLE_COLUMNS,
      columnWidths: view.columnWidths ? { ...DEFAULT_COLUMN_WIDTHS, ...view.columnWidths } : DEFAULT_COLUMN_WIDTHS,
      activeViewId: viewId,
    };

    set(newState);
    saveFilterState({
      activePeriodId: newState.activePeriodId,
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

  createList: async (name: string, color?: string) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, color: color || '#6b7280' }),
      });

      if (response.ok) {
        const data = await response.json();
        set({ lists: data.lists });
        return data.list;
      }
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

  reorderListItems: async (listId: string, items: { objectiveId: string; order: number }[]) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/lists/${listId}/reorder`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ items }),
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
