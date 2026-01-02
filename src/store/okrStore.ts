import { create } from 'zustand';
import type { Objective, KeyResult, Team, Period, Tag, OKRState } from '../types';
import { storage } from '../utils/storage';
import { generateId, calculateObjectiveProgress, determineStatus, calculateKeyResultProgress } from '../utils/calculations';

interface OKRActions {
  // Objectives
  addObjective: (objective: Omit<Objective, 'id' | 'progress' | 'status' | 'createdAt' | 'updatedAt'>) => void;
  updateObjective: (id: string, updates: Partial<Objective>) => void;
  deleteObjective: (id: string) => void;

  // Key Results
  addKeyResult: (keyResult: Omit<KeyResult, 'id' | 'progress' | 'createdAt' | 'updatedAt'>) => void;
  updateKeyResult: (id: string, updates: Partial<KeyResult>) => void;
  deleteKeyResult: (id: string) => void;

  // Teams
  addTeam: (team: Omit<Team, 'id'>) => void;
  updateTeam: (id: string, updates: Partial<Team>) => void;
  deleteTeam: (id: string) => void;

  // Periods
  addPeriod: (period: Omit<Period, 'id'>) => void;
  updatePeriod: (id: string, updates: Partial<Period>) => void;
  deletePeriod: (id: string) => void;
  setActivePeriod: (id: string | null) => void;

  // Tags
  addTag: (tag: Omit<Tag, 'id'>) => void;
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
  const updatedKeyResults = state.keyResults.map(kr => ({
    ...kr,
    progress: calculateKeyResultProgress(kr),
  }));

  const updatedObjectives = state.objectives.map(obj => {
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

  addObjective: (objective) => {
    const now = new Date().toISOString();
    const newObjective: Objective = {
      ...objective,
      id: generateId(),
      progress: 0,
      status: 'behind',
      createdAt: now,
      updatedAt: now,
    };

    set((state) => {
      const newState = { ...state, objectives: [...state.objectives, newObjective] };
      storage.save(newState);
      return newState;
    });
  },

  updateObjective: (id, updates) => {
    set((state) => {
      const newState = {
        ...state,
        objectives: state.objectives.map((obj) =>
          obj.id === id ? { ...obj, ...updates, updatedAt: new Date().toISOString() } : obj
        ),
      };
      const recalculated = recalculateAllProgress(newState);
      storage.save(recalculated);
      return recalculated;
    });
  },

  deleteObjective: (id) => {
    set((state) => {
      // Also delete child objectives and their key results
      const objectivesToDelete = new Set<string>();
      const findChildren = (parentId: string) => {
        objectivesToDelete.add(parentId);
        state.objectives.filter(o => o.parentId === parentId).forEach(child => findChildren(child.id));
      };
      findChildren(id);

      const newState = {
        ...state,
        objectives: state.objectives.filter((obj) => !objectivesToDelete.has(obj.id)),
        keyResults: state.keyResults.filter((kr) => !objectivesToDelete.has(kr.objectiveId)),
      };
      const recalculated = recalculateAllProgress(newState);
      storage.save(recalculated);
      return recalculated;
    });
  },

  addKeyResult: (keyResult) => {
    const now = new Date().toISOString();
    const progress = keyResult.targetValue > 0
      ? Math.round((keyResult.currentValue / keyResult.targetValue) * 100)
      : 0;

    const newKeyResult: KeyResult = {
      ...keyResult,
      id: generateId(),
      progress,
      createdAt: now,
      updatedAt: now,
    };

    set((state) => {
      const newState = { ...state, keyResults: [...state.keyResults, newKeyResult] };
      const recalculated = recalculateAllProgress(newState);
      storage.save(recalculated);
      return recalculated;
    });
  },

  updateKeyResult: (id, updates) => {
    set((state) => {
      const newState = {
        ...state,
        keyResults: state.keyResults.map((kr) =>
          kr.id === id ? { ...kr, ...updates, updatedAt: new Date().toISOString() } : kr
        ),
      };
      const recalculated = recalculateAllProgress(newState);
      storage.save(recalculated);
      return recalculated;
    });
  },

  deleteKeyResult: (id) => {
    set((state) => {
      const newState = {
        ...state,
        keyResults: state.keyResults.filter((kr) => kr.id !== id),
      };
      const recalculated = recalculateAllProgress(newState);
      storage.save(recalculated);
      return recalculated;
    });
  },

  addTeam: (team) => {
    const newTeam: Team = { ...team, id: generateId() };
    set((state) => {
      const newState = { ...state, teams: [...state.teams, newTeam] };
      storage.save(newState);
      return newState;
    });
  },

  updateTeam: (id, updates) => {
    set((state) => {
      const newState = {
        ...state,
        teams: state.teams.map((team) => (team.id === id ? { ...team, ...updates } : team)),
      };
      storage.save(newState);
      return newState;
    });
  },

  deleteTeam: (id) => {
    set((state) => {
      const newState = {
        ...state,
        teams: state.teams.filter((team) => team.id !== id),
      };
      storage.save(newState);
      return newState;
    });
  },

  addPeriod: (period) => {
    const newPeriod: Period = { ...period, id: generateId() };
    set((state) => {
      const newState = { ...state, periods: [...state.periods, newPeriod] };
      storage.save(newState);
      return newState;
    });
  },

  updatePeriod: (id, updates) => {
    set((state) => {
      const newState = {
        ...state,
        periods: state.periods.map((period) => (period.id === id ? { ...period, ...updates } : period)),
      };
      storage.save(newState);
      return newState;
    });
  },

  deletePeriod: (id) => {
    set((state) => {
      const newState = {
        ...state,
        periods: state.periods.filter((period) => period.id !== id),
        activePeriodId: state.activePeriodId === id ? null : state.activePeriodId,
      };
      storage.save(newState);
      return newState;
    });
  },

  setActivePeriod: (id) => {
    set((state) => {
      const newState = { ...state, activePeriodId: id };
      storage.save(newState);
      return newState;
    });
  },

  addTag: (tag) => {
    const newTag: Tag = { ...tag, id: generateId() };
    set((state) => {
      const newState = { ...state, tags: [...state.tags, newTag] };
      storage.save(newState);
      return newState;
    });
  },

  updateTag: (id, updates) => {
    set((state) => {
      const newState = {
        ...state,
        tags: state.tags.map((tag) => (tag.id === id ? { ...tag, ...updates } : tag)),
      };
      storage.save(newState);
      return newState;
    });
  },

  deleteTag: (id) => {
    set((state) => {
      // Remove tag from all objectives that have it
      const updatedObjectives = state.objectives.map((obj) => ({
        ...obj,
        tagIds: obj.tagIds?.filter((tagId) => tagId !== id),
      }));
      const newState = {
        ...state,
        tags: state.tags.filter((tag) => tag.id !== id),
        objectives: updatedObjectives,
        filterTagIds: state.filterTagIds.filter((tagId) => tagId !== id),
      };
      storage.save(newState);
      return newState;
    });
  },

  setFilterTags: (tagIds) => {
    set((state) => {
      const newState = { ...state, filterTagIds: tagIds };
      storage.save(newState);
      return newState;
    });
  },

  toggleFilterTag: (tagId) => {
    set((state) => {
      const filterTagIds = state.filterTagIds.includes(tagId)
        ? state.filterTagIds.filter((id) => id !== tagId)
        : [...state.filterTagIds, tagId];
      const newState = { ...state, filterTagIds };
      storage.save(newState);
      return newState;
    });
  },

  setFilterTeams: (teamIds) => {
    set((state) => {
      const newState = { ...state, filterTeamIds: teamIds };
      storage.save(newState);
      return newState;
    });
  },

  toggleFilterTeam: (teamId) => {
    set((state) => {
      const filterTeamIds = state.filterTeamIds.includes(teamId)
        ? state.filterTeamIds.filter((id) => id !== teamId)
        : [...state.filterTeamIds, teamId];
      const newState = { ...state, filterTeamIds };
      storage.save(newState);
      return newState;
    });
  },

  clearAllFilters: () => {
    set((state) => {
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
    set((state) => {
      const recalculated = recalculateAllProgress(state);
      storage.save(recalculated);
      return recalculated;
    });
  },

  addAllowedDomain: (domain) => {
    set((state) => {
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

  deleteAllowedDomain: (domain) => {
    set((state) => {
      const newState = {
        ...state,
        allowedDomains: state.allowedDomains.filter((d) => d !== domain),
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

  importData: (data) => {
    set((state) => {
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

