export type ObjectiveLevel = 'company' | 'team' | 'individual';
export type ObjectiveStatus = 'on-track' | 'at-risk' | 'behind';
export type WorkflowStatus = 'todo' | 'backlog' | 'planning' | 'in_progress' | 'acceptance' | 'done' | 'archived';
export type ObjectiveType = 'initiative' | 'saga' | 'epic' | 'story' | 'subtask';
export type NextStepDateFilter = 'not_set' | 'last_7d' | 'last_30d' | 'past' | 'today' | 'next_7d' | 'next_30d' | 'future';

export interface FieldChange {
  field: string;
  oldValue: string | number | boolean | undefined;
  newValue: string | number | boolean | undefined;
  oldRaw?: unknown;
  newRaw?: unknown;
}

export interface ObjectiveHistoryEntry {
  id: string;
  timestamp: string;
  userEmail: string;
  action: 'created' | 'updated';
  changes: FieldChange[];
}

export interface ObjectiveLink {
  url: string;
  description?: string;
}

export interface ProgressUpdate {
  id: string;
  text: string;
  createdAt: string;
  createdBy: string;
}

export interface Objective {
  id: string;
  orgId: string;
  createdBy: string;
  shared: boolean;
  title: string;
  description?: string;
  level: ObjectiveLevel;
  type?: ObjectiveType;
  parentId?: string;
  teamId?: string;
  ownerId?: string;
  assigneeId?: string;
  tagIds?: string[];
  nextStepDate?: string;
  nextStep?: string;
  storyPoints?: number;
  valuePoints?: number;
  link?: ObjectiveLink;
  sortOrder?: number;
  progressUpdates?: ProgressUpdate[];
  isKeyResult?: boolean;
  progress: number;
  status: ObjectiveStatus;
  workflowStatus: WorkflowStatus;
  resolvedAt?: string;
  periodId: string;
  createdAt: string;
  updatedAt: string;
  history: ObjectiveHistoryEntry[];
}

export interface Tag {
  id: string;
  orgId: string;
  createdBy: string;
  shared: boolean;
  name: string;
  color: string;
}

export interface KeyResult {
  id: string;
  orgId: string;
  createdBy: string;
  shared: boolean;
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
  orgId: string;
  createdBy: string;
  shared: boolean;
  name: string;
  parentId?: string;
  leadEmail?: string;
}

export type PeriodType = 'quarter' | 'month' | 'week';

export interface Period {
  id: string;
  orgId: string;
  createdBy: string;
  shared: boolean;
  name: string;
  type: PeriodType;
  parentId?: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  archived?: boolean;
}

export type FilterOperator = 'equals' | 'not_equals';

export interface OKRState {
  objectives: Objective[];
  keyResults: KeyResult[];
  teams: Team[];
  periods: Period[];
  tags: Tag[];
  allowedDomains: string[];
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
  filterRootObjectiveId: string | null;
  filterWorkflowStatuses: WorkflowStatus[];
  filterKeyResultsOnly: boolean;
  filterListIds: string[];
  filterListShowChildren: boolean;
  showListMembership: boolean;
  listMembershipListId: string | null;
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

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  domain: string;
  organizationId: string;
  organizationName?: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastLoginAt: string;
}

// Plan view saved filter
export interface PlanFilters {
  ownerId: string;
  periodId: string;
  level: ObjectiveLevel | '';
  statuses: WorkflowStatus[];
  types?: ObjectiveType[];
  listId?: string;
}

export interface PlanVersion {
  id: string;
  timestamp: string;
  itemIds: string[];
}

export interface PlanDef {
  id: string;
  name: string;
  filters: PlanFilters;
  ranks?: Record<string, number>;
  replacements?: string[];
  exclusions?: string[];
  hiddenChildrenOf?: string[];
  versions?: PlanVersion[];
}

// Saved View types
export interface SavedViewFilters {
  filterPeriodIds: string[];
  filterTagIds: string[];
  filterTeamIds: string[];
  filterTypes: ObjectiveType[];
  filterTypeNotSet: boolean;
  filterOwnerIds: string[];
  filterOwnerOperator: FilterOperator;
  filterAssigneeIds: string[];
  filterAssigneeOperator: FilterOperator;
  filterNextStepDate: NextStepDateFilter | null;
  filterLevels: ObjectiveLevel[];
  filterObjectiveId: string | null;
  openChildrenOnly: boolean;
}

export interface SavedView {
  id: string;
  name: string;
  isDefault: boolean;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
  filters: SavedViewFilters;
  visibleColumns: string[];
  columnWidths: Record<string, number>;
}

// List types
export interface ListItem {
  objectiveId: string;
  order: number;
}

export interface List {
  id: string;
  name: string;
  color: string;
  items: ListItem[];
  createdAt: string;
  updatedAt: string;
  parentId?: string;
}
