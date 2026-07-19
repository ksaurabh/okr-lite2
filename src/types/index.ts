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

export interface ObjectiveComment {
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
  readOnly?: boolean;
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
  comments?: ObjectiveComment[];
  isKeyResult?: boolean;
  progress: number;
  status: ObjectiveStatus;
  workflowStatus: WorkflowStatus;
  resolvedAt?: string;
  periodId: string;
  createdAt: string;
  updatedAt: string;
  history: ObjectiveHistoryEntry[];
  jiraEpicKey?: string;
  jiraEpicUrl?: string;
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
  memberEmails?: string[];
  // 'self' marks an individual-contributor team that cannot have other members.
  type?: 'self' | 'standard';
}

export type PeriodType = 'quarter' | 'month' | 'week' | 'oneoff';

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

// An org-level defined department. Departments are identified by name (the same
// value stored on User.department and synced from Google Workspace). `parentName`
// nests a department under another one; null/absent means top-level.
export interface Department {
  name: string;
  parentName?: string | null;
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
  managerEmail?: string;   // reporting: this user's manager (email)
  managerId?: string;      // resolved id of the manager's user record
  department?: string;     // from Google Workspace directory
  active?: boolean;        // from Google Workspace directory (false = suspended). Undefined = treat as active.
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

export interface TeamAssignment {
  id: string;
  orgId: string;
  who: string;              // user email
  teamId: string;           // references Team.id (empty when isSelf)
  isSelf?: boolean;         // self/individual capacity, not tied to a team
  capacitySpPerWeek: number; // story points per week
  startDate: string;        // yyyy-mm-dd (required)
  endDate?: string;         // yyyy-mm-dd (optional)
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ListHistoryEntry {
  id: string;
  timestamp: string;
  userEmail: string;
  userName?: string;
  action: 'item_added' | 'item_removed' | 'item_moved';
  objectiveId: string;
  objectiveTitle?: string;
  // 0-based positions. `position` = where it was added / removed from.
  // `fromPosition`/`toPosition` describe a move.
  position?: number;
  fromPosition?: number;
  toPosition?: number;
}

// A single item's line on a plan's final scorecard. `valuePoints` and `title`
// are snapshots taken at review time so the scorecard stays stable even if the
// objective later changes. `percentAchieved` is 0–100.
export interface PlanScorecardItem {
  objectiveId: string;
  title: string;
  valuePoints: number;
  percentAchieved: number;
  workflowStatus?: WorkflowStatus;
}

// The final review attached to a plan: per-item ratings plus the rolled-up
// score. `vpAchieved` = Σ (valuePoints × percentAchieved / 100); `vpAchievedPct`
// = vpAchieved / totalVp × 100.
export interface PlanScorecard {
  reviewedAt: string;
  reviewedBy: string;
  items: PlanScorecardItem[];
  totalVp: number;
  vpAchieved: number;
  vpAchievedPct: number;
}

export interface List {
  id: string;
  name: string;
  color: string;
  items: ListItem[];
  createdAt: string;
  updatedAt: string;
  parentId?: string;
  ownerId?: string;
  periodId?: string;
  level?: ObjectiveLevel;
  shared?: boolean;
  status?: string;
  createdByEmail?: string;
  history?: ListHistoryEntry[];
  scorecard?: PlanScorecard;
}
