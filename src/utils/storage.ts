import type { OKRState } from '../types';

const STORAGE_KEY = 'okr-lite-data';

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
  filterOwnerIds: [],
  filterOwnerOperator: 'equals',
  filterAssigneeIds: [],
  filterAssigneeOperator: 'equals',
};

export const storage = {
  load(): OKRState {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return defaultState;
      return { ...defaultState, ...JSON.parse(data) };
    } catch {
      return defaultState;
    }
  },

  save(state: OKRState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
    }
  },

  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
  },
};
