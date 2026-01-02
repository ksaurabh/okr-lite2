import type { Objective, KeyResult, Team, Period, Tag } from '../types';

const API_URL = import.meta.env.VITE_API_URL || '';

async function fetchWithCredentials(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

export const api = {
  // Fetch all OKR data for the organization
  async fetchOKRData(): Promise<{
    objectives: Objective[];
    keyResults: KeyResult[];
    teams: Team[];
    periods: Period[];
    tags: Tag[];
  }> {
    return fetchWithCredentials(`${API_URL}/api/okr-data`);
  },

  // Objectives
  async createObjective(objective: Omit<Objective, 'id' | 'orgId' | 'createdBy' | 'progress' | 'status' | 'createdAt' | 'updatedAt'>): Promise<Objective> {
    return fetchWithCredentials(`${API_URL}/api/objectives`, {
      method: 'POST',
      body: JSON.stringify(objective),
    });
  },

  async updateObjective(id: string, updates: Partial<Objective>): Promise<Objective> {
    return fetchWithCredentials(`${API_URL}/api/objectives/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async deleteObjective(id: string): Promise<void> {
    return fetchWithCredentials(`${API_URL}/api/objectives/${id}`, {
      method: 'DELETE',
    });
  },

  // Key Results
  async createKeyResult(keyResult: Omit<KeyResult, 'id' | 'orgId' | 'createdBy' | 'createdAt' | 'updatedAt'>): Promise<KeyResult> {
    return fetchWithCredentials(`${API_URL}/api/key-results`, {
      method: 'POST',
      body: JSON.stringify(keyResult),
    });
  },

  async updateKeyResult(id: string, updates: Partial<KeyResult>): Promise<KeyResult> {
    return fetchWithCredentials(`${API_URL}/api/key-results/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async deleteKeyResult(id: string): Promise<void> {
    return fetchWithCredentials(`${API_URL}/api/key-results/${id}`, {
      method: 'DELETE',
    });
  },

  // Teams
  async createTeam(team: Omit<Team, 'id' | 'orgId' | 'createdBy'>): Promise<Team> {
    return fetchWithCredentials(`${API_URL}/api/teams`, {
      method: 'POST',
      body: JSON.stringify(team),
    });
  },

  async updateTeam(id: string, updates: Partial<Team>): Promise<Team> {
    return fetchWithCredentials(`${API_URL}/api/teams/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async deleteTeam(id: string): Promise<void> {
    return fetchWithCredentials(`${API_URL}/api/teams/${id}`, {
      method: 'DELETE',
    });
  },

  // Periods
  async createPeriod(period: Omit<Period, 'id' | 'orgId' | 'createdBy'>): Promise<Period> {
    return fetchWithCredentials(`${API_URL}/api/periods`, {
      method: 'POST',
      body: JSON.stringify(period),
    });
  },

  async updatePeriod(id: string, updates: Partial<Period>): Promise<Period> {
    return fetchWithCredentials(`${API_URL}/api/periods/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async deletePeriod(id: string): Promise<void> {
    return fetchWithCredentials(`${API_URL}/api/periods/${id}`, {
      method: 'DELETE',
    });
  },

  // Tags
  async createTag(tag: Omit<Tag, 'id' | 'orgId' | 'createdBy'>): Promise<Tag> {
    return fetchWithCredentials(`${API_URL}/api/tags`, {
      method: 'POST',
      body: JSON.stringify(tag),
    });
  },

  async updateTag(id: string, updates: Partial<Tag>): Promise<Tag> {
    return fetchWithCredentials(`${API_URL}/api/tags/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async deleteTag(id: string): Promise<void> {
    return fetchWithCredentials(`${API_URL}/api/tags/${id}`, {
      method: 'DELETE',
    });
  },
};
