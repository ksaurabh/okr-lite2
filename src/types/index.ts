export type ObjectiveLevel = 'company' | 'team' | 'individual';
export type ObjectiveStatus = 'on-track' | 'at-risk' | 'behind';

export interface Objective {
  id: string;
  title: string;
  description?: string;
  level: ObjectiveLevel;
  parentId?: string;
  teamId?: string;
  ownerId?: string;
  tagIds?: string[];
  progress: number;
  status: ObjectiveStatus;
  periodId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface KeyResult {
  id: string;
  objectiveId: string;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface Team {
  id: string;
  name: string;
  parentId?: string;
}

export type PeriodType = 'quarter' | 'month' | 'week';

export interface Period {
  id: string;
  name: string;
  type: PeriodType;
  parentId?: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface OKRState {
  objectives: Objective[];
  keyResults: KeyResult[];
  teams: Team[];
  periods: Period[];
  tags: Tag[];
  allowedDomains: string[];
  activePeriodId: string | null;
  filterTagIds: string[];
  filterTeamIds: string[];
}

// Organization types
export type AdminInviteStatus = 'pending' | 'accepted';

export interface OrganizationAdmin {
  email: string;
  inviteToken: string;
  inviteCreatedAt: string;
  status: AdminInviteStatus;
  acceptedAt?: string;
}

export interface Organization {
  id: string;
  name: string;
  domain: string;
  admins: OrganizationAdmin[];
  createdAt: string;
  updatedAt: string;
}
