import { create } from 'zustand';
import type { Objective, KeyResult, Team, Period, Tag, OKRState, ObjectiveHistoryEntry, FieldChange } from '../types';
import { storage } from '../utils/storage';
import { generateId, calculateObjectiveProgress, determineStatus, calculateKeyResultProgress } from '../utils/calculations';

interface CreateContext {
  orgId: string;
  userEmail: string;
  shared?: boolean; // defaults to true if not provided
}

interface OKRActions {
  // Objectives
  addObjective: (objective: Omit<Objective, 'id' | 'orgId' | 'createdBy' | 'shared' | 'progress' | 'status' | 'createdAt' | 'updatedAt' | 'history'>, ctx: CreateContext) => void;
  updateObjective: (id: string, updates: Partial<Objective>, userEmail: string) => void;
  deleteObjective: (id: string) => void;

  // Key Results
  addKeyResult: (keyResult: Omit<KeyResult, 'id' | 'orgId' | 'createdBy' | 'shared' | 'progress' | 'createdAt' | 'updatedAt'>, ctx: CreateContext) => void;
  updateKeyResult: (id: string, updates: Partial<KeyResult>) => void;
  deleteKeyResult: (id: string) => void;

  // Teams
  addTeam: (team: Omit<Team, 'id' | 'orgId' | 'createdBy' | 'shared'>, ctx: CreateContext) => void;
  updateTeam: (id: string, updates: Partial<Team>) => void;
  deleteTeam: (id: string) => void;

  // Periods
  addPeriod: (period: Omit<Period, 'id' | 'orgId' | 'createdBy' | 'shared'>, ctx: CreateContext) => void;
  updatePeriod: (id: string, updates: Partial<Period>) => void;
  deletePeriod: (id: string) => void;
  setActivePeriod: (id: string | null) => void;

  // Tags
  addTag: (tag: Omit<Tag, 'id' | 'orgId' | 'createdBy' | 'shared'>, ctx: CreateContext) => void;
  updateTag: (id: string, updates: Partial<Tag>) => void;
  deleteTag: (id: string) => void;
  setFilterTags: (tagIds: string[]) => void;
  toggleFilterTag: (tagId: string) => void;

  // Filters
  setFilterTeams: (teamIds: string[]) => void;
  toggleFilterTeam: (teamId: string) => void;
  clearAllFilters: () => void;

  // Allowed Domains
  addAllowedDomain: (domain: string) => void;
  deleteAllowedDomain: (domain: string) => void;

  // Backup & Restore
  exportData: () => BackupData;
  importData: (data: BackupData) => void;

  // Utilities
  recalculateProgress: () => void;
}

export interface BackupData {
  version: number;
  exportedAt: string;
  objectives: Objective[];
  keyResults: KeyResult[];
  teams: Team[];
  periods: Period[];
  tags: Tag[];
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
      updatedAt: new Date().toISOString(),
    };
  });

  return {
    ...state,
    objectives: updatedObjectives,
    keyResults: updatedKeyResults,
  };
};

export const useOKRStore = create<OKRStore>((set, get) => ({
  ...storage.load(),

  addObjective: (objective, ctx) => {
    const now = new Date().toISOString();
    const objectiveId = generateId();
    const state = get();

    // Helper to resolve IDs to names
    const getPeriodName = (id: string) => state.periods.find(p => p.id === id)?.name || id;
    const getTeamName = (id: string) => state.teams.find(t => t.id === id)?.name || id;
    const getObjectiveTitle = (id: string) => state.objectives.find(o => o.id === id)?.title || id;

    // Create initial history entry for creation
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

    const newObjective: Objective = {
      ...objective,
      id: objectiveId,
      orgId: ctx.orgId,
      createdBy: ctx.userEmail,
      shared: ctx.shared ?? true,
      progress: 0,
      status: 'behind',
      createdAt: now,
      updatedAt: now,
      history: [initialHistory],
    };

    set((state: OKRStore) => {
      const newState = { ...state, objectives: [...state.objectives, newObjective] };
      storage.save(newState);
      return newState;
    });
  },

  updateObjective: (id: string, updates: Partial<Objective>, userEmail: string) => {
    set((state: OKRStore) => {
      const now = new Date().toISOString();
      const existingObj = state.objectives.find((obj: Objective) => obj.id === id);
      if (!existingObj) return state;

      // Helper to resolve IDs to names
      const getPeriodName = (id: string | undefined) => id ? state.periods.find(p => p.id === id)?.name || id : undefined;
      const getTeamName = (id: string | undefined) => id ? state.teams.find(t => t.id === id)?.name || id : undefined;
      const getTagNames = (ids: string[] | undefined) => ids ? ids.map(id => state.tags.find(t => t.id === id)?.name || id).join(', ') : undefined;
      const getObjectiveTitle = (id: string | undefined) => id ? state.objectives.find(o => o.id === id)?.title || id : undefined;

      // Track which fields changed (excluding system fields)
      const changes: FieldChange[] = [];

      // Check each trackable field and resolve IDs to names
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

      // Only add history entry if there are actual changes
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

      const newState = {
        ...state,
        objectives: state.objectives.map((obj: Objective) =>
          obj.id === id ? { ...obj, ...updates, updatedAt: now, history: updatedHistory } : obj
        ),
      };
      const recalculated = recalculateAllProgress(newState);
      storage.save(recalculated);
      return recalculated;
    });
  },

  deleteObjective: (id: string) => {
    set((state: OKRStore) => {
      // Also delete child objectives and their key results
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
      const recalculated = recalculateAllProgress(newState);
      storage.save(recalculated);
      return recalculated;
    });
  },

  addKeyResult: (keyResult, ctx) => {
    const now = new Date().toISOString();
    const progress = keyResult.targetValue > 0
      ? Math.round((keyResult.currentValue / keyResult.targetValue) * 100)
      : 0;

    const newKeyResult: KeyResult = {
      ...keyResult,
      id: generateId(),
      orgId: ctx.orgId,
      createdBy: ctx.userEmail,
      shared: ctx.shared ?? true,
      progress,
      createdAt: now,
      updatedAt: now,
    };

    set((state: OKRStore) => {
      const newState = { ...state, keyResults: [...state.keyResults, newKeyResult] };
      const recalculated = recalculateAllProgress(newState);
      storage.save(recalculated);
      return recalculated;
    });
  },

  updateKeyResult: (id: string, updates: Partial<KeyResult>) => {
    set((state: OKRStore) => {
      const newState = {
        ...state,
        keyResults: state.keyResults.map((kr: KeyResult) =>
          kr.id === id ? { ...kr, ...updates, updatedAt: new Date().toISOString() } : kr
        ),
      };
      const recalculated = recalculateAllProgress(newState);
      storage.save(recalculated);
      return recalculated;
    });
  },

  deleteKeyResult: (id: string) => {
    set((state: OKRStore) => {
      const newState = {
        ...state,
        keyResults: state.keyResults.filter((kr: KeyResult) => kr.id !== id),
      };
      const recalculated = recalculateAllProgress(newState);
      storage.save(recalculated);
      return recalculated;
    });
  },

  addTeam: (team, ctx) => {
    const newTeam: Team = { ...team, id: generateId(), orgId: ctx.orgId, createdBy: ctx.userEmail, shared: ctx.shared ?? true };
    set((state: OKRStore) => {
      const newState = { ...state, teams: [...state.teams, newTeam] };
      storage.save(newState);
      return newState;
    });
  },

  updateTeam: (id: string, updates: Partial<Team>) => {
    set((state: OKRStore) => {
      const newState = {
        ...state,
        teams: state.teams.map((team: Team) => (team.id === id ? { ...team, ...updates } : team)),
      };
      storage.save(newState);
      return newState;
    });
  },

  deleteTeam: (id: string) => {
    set((state: OKRStore) => {
      const newState = {
        ...state,
        teams: state.teams.filter((team: Team) => team.id !== id),
      };
      storage.save(newState);
      return newState;
    });
  },

  addPeriod: (period, ctx) => {
    const newPeriod: Period = { ...period, id: generateId(), orgId: ctx.orgId, createdBy: ctx.userEmail, shared: ctx.shared ?? true };
    set((state: OKRStore) => {
      const newState = { ...state, periods: [...state.periods, newPeriod] };
      storage.save(newState);
      return newState;
    });
  },

  updatePeriod: (id: string, updates: Partial<Period>) => {
    set((state: OKRStore) => {
      const newState = {
        ...state,
        periods: state.periods.map((period: Period) => (period.id === id ? { ...period, ...updates } : period)),
      };
      storage.save(newState);
      return newState;
    });
  },

  deletePeriod: (id: string) => {
    set((state: OKRStore) => {
      const newState = {
        ...state,
        periods: state.periods.filter((period: Period) => period.id !== id),
        activePeriodId: state.activePeriodId === id ? null : state.activePeriodId,
      };
      storage.save(newState);
      return newState;
    });
  },

  setActivePeriod: (id: string | null) => {
    set((state: OKRStore) => {
      const newState = { ...state, activePeriodId: id };
      storage.save(newState);
      return newState;
    });
  },

  addTag: (tag, ctx) => {
    const newTag: Tag = { ...tag, id: generateId(), orgId: ctx.orgId, createdBy: ctx.userEmail, shared: ctx.shared ?? true };
    set((state: OKRStore) => {
      const newState = { ...state, tags: [...state.tags, newTag] };
      storage.save(newState);
      return newState;
    });
  },

  updateTag: (id: string, updates: Partial<Tag>) => {
    set((state: OKRStore) => {
      const newState = {
        ...state,
        tags: state.tags.map((tag: Tag) => (tag.id === id ? { ...tag, ...updates } : tag)),
      };
      storage.save(newState);
      return newState;
    });
  },

  deleteTag: (id: string) => {
    set((state: OKRStore) => {
      // Remove tag from all objectives that have it
      const updatedObjectives = state.objectives.map((obj: Objective) => ({
        ...obj,
        tagIds: obj.tagIds?.filter((tagId: string) => tagId !== id),
      }));
      const newState = {
        ...state,
        tags: state.tags.filter((tag: Tag) => tag.id !== id),
        objectives: updatedObjectives,
        filterTagIds: state.filterTagIds.filter((tagId: string) => tagId !== id),
      };
      storage.save(newState);
      return newState;
    });
  },

  setFilterTags: (tagIds: string[]) => {
    set((state: OKRStore) => {
      const newState = { ...state, filterTagIds: tagIds };
      storage.save(newState);
      return newState;
    });
  },

  toggleFilterTag: (tagId: string) => {
    set((state: OKRStore) => {
      const filterTagIds = state.filterTagIds.includes(tagId)
        ? state.filterTagIds.filter((id: string) => id !== tagId)
        : [...state.filterTagIds, tagId];
      const newState = { ...state, filterTagIds };
      storage.save(newState);
      return newState;
    });
  },

  setFilterTeams: (teamIds: string[]) => {
    set((state: OKRStore) => {
      const newState = { ...state, filterTeamIds: teamIds };
      storage.save(newState);
      return newState;
    });
  },

  toggleFilterTeam: (teamId: string) => {
    set((state: OKRStore) => {
      const filterTeamIds = state.filterTeamIds.includes(teamId)
        ? state.filterTeamIds.filter((id: string) => id !== teamId)
        : [...state.filterTeamIds, teamId];
      const newState = { ...state, filterTeamIds };
      storage.save(newState);
      return newState;
    });
  },

  clearAllFilters: () => {
    set((state: OKRStore) => {
      const newState = {
        ...state,
        activePeriodId: null,
        filterTagIds: [],
        filterTeamIds: [],
      };
      storage.save(newState);
      return newState;
    });
  },

  recalculateProgress: () => {
    set((state: OKRStore) => {
      const recalculated = recalculateAllProgress(state);
      storage.save(recalculated);
      return recalculated;
    });
  },

  addAllowedDomain: (domain: string) => {
    set((state: OKRStore) => {
      // Normalize domain (lowercase, trim)
      const normalizedDomain = domain.toLowerCase().trim();
      if (!normalizedDomain || state.allowedDomains.includes(normalizedDomain)) {
        return state;
      }
      const newState = {
        ...state,
        allowedDomains: [...state.allowedDomains, normalizedDomain],
      };
      storage.save(newState);
      return newState;
    });
  },

  deleteAllowedDomain: (domain: string) => {
    set((state: OKRStore) => {
      const newState = {
        ...state,
        allowedDomains: state.allowedDomains.filter((d: string) => d !== domain),
      };
      storage.save(newState);
      return newState;
    });
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
        // Reset filters
        activePeriodId: null,
        filterTagIds: [],
        filterTeamIds: [],
      };
      const recalculated = recalculateAllProgress(newState);
      storage.save(recalculated);
      return recalculated;
    });
  },
}));

