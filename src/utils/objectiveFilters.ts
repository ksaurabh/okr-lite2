import type {
  Objective,
  Period,
  Team,
  List,
  ObjectiveType,
  ObjectiveLevel,
  NextStepDateFilter,
  WorkflowStatus,
  FilterOperator,
} from '../types';

export const TYPE_OPTIONS: { value: ObjectiveType; label: string }[] = [
  { value: 'initiative', label: 'Initiative' },
  { value: 'saga', label: 'Saga' },
  { value: 'epic', label: 'Epic' },
  { value: 'story', label: 'Story' },
  { value: 'subtask', label: 'SubTask' },
];

export const LEVEL_OPTIONS: { value: ObjectiveLevel; label: string }[] = [
  { value: 'company', label: 'Company' },
  { value: 'team', label: 'Team' },
  { value: 'individual', label: 'Individual' },
];

export const NEXT_STEP_DATE_OPTIONS: { value: NextStepDateFilter; label: string }[] = [
  { value: 'not_set', label: 'Not Set' },
  { value: 'last_7d', label: 'In Last 7d' },
  { value: 'last_30d', label: 'In Last 30d' },
  { value: 'past', label: 'In the Past' },
  { value: 'today', label: 'Today' },
  { value: 'next_7d', label: 'In Next 7d' },
  { value: 'next_30d', label: 'In Next 30d' },
  { value: 'future', label: 'In the Future' },
];

export const LAST_UPDATED_OPTIONS: { value: string; label: string; ms: number }[] = [
  { value: '30s', label: 'In last 30 seconds', ms: 30 * 1000 },
  { value: '1m',  label: 'In last 1m',         ms: 60 * 1000 },
  { value: '5m',  label: 'In last 5m',         ms: 5 * 60 * 1000 },
  { value: '30m', label: 'In last 30m',        ms: 30 * 60 * 1000 },
  { value: '1h',  label: 'In last 1h',         ms: 60 * 60 * 1000 },
  { value: '24h', label: 'In the last 24h',    ms: 24 * 60 * 60 * 1000 },
  { value: '1w',  label: 'In the last week',   ms: 7 * 24 * 60 * 60 * 1000 },
];

export const WORKFLOW_STATUS_OPTIONS: { value: WorkflowStatus; label: string }[] = [
  { value: 'todo', label: 'To Do' },
  { value: 'backlog', label: 'In Backlog' },
  { value: 'planning', label: 'In Planning' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'acceptance', label: 'In Acceptance' },
  { value: 'done', label: 'Done' },
  { value: 'archived', label: 'Archived' },
];

export type AncestorPeriodLookup = (id: string) => string[];
export type DescendantPeriodLookup = (id: string) => string[];
export type DescendantTeamLookup = (id: string) => string[];
export type DescendantObjectiveLookup = (id: string) => string[];

export function buildPeriodAncestorLookup(periods: Period[]): AncestorPeriodLookup {
  return (periodId: string): string[] => {
    const ids: string[] = [periodId];
    let current = periods.find((p: Period) => p.id === periodId);
    while (current?.parentId) {
      ids.push(current.parentId);
      current = periods.find((p: Period) => p.id === current!.parentId);
    }
    return ids;
  };
}

export function buildPeriodDescendantLookup(periods: Period[]): DescendantPeriodLookup {
  return (periodId: string): string[] => {
    const ids: string[] = [periodId];
    const findChildren = (parentId: string) => {
      const children = periods.filter((p: Period) => p.parentId === parentId);
      children.forEach((child: Period) => {
        ids.push(child.id);
        findChildren(child.id);
      });
    };
    findChildren(periodId);
    return ids;
  };
}

export function buildTeamDescendantLookup(teams: Team[]): DescendantTeamLookup {
  return (teamId: string): string[] => {
    const ids: string[] = [teamId];
    const findChildren = (parentId: string) => {
      const children = teams.filter((t: Team) => t.parentId === parentId);
      children.forEach((child: Team) => {
        ids.push(child.id);
        findChildren(child.id);
      });
    };
    findChildren(teamId);
    return ids;
  };
}

export function buildObjectiveDescendantLookup(objectives: Objective[]): DescendantObjectiveLookup {
  return (objectiveId: string): string[] => {
    const ids: string[] = [];
    const findChildren = (parentId: string) => {
      const children = objectives.filter((o: Objective) => o.parentId === parentId);
      children.forEach((child: Objective) => {
        ids.push(child.id);
        findChildren(child.id);
      });
    };
    findChildren(objectiveId);
    return ids;
  };
}

export interface FilterObjectivesArgs {
  orgObjectives: Objective[];
  lists: List[];
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
  filterWorkflowStatuses: WorkflowStatus[];
  filterKeyResultsOnly: boolean;
  filterObjectiveId: string | null;
  filterRootObjectiveId: string | null;
  filterListIds: string[];
  filterLastUpdated: string | null;
  searchQuery: string;
  includeAncestorPeriods: boolean;
  includeChildPeriods: boolean;
  includeChildTeams: boolean;
  showChildren: boolean;
  directChildrenOnly: boolean;
  openChildrenOnly: boolean;
  ancestorPeriodLookup: AncestorPeriodLookup;
  descendantPeriodLookup: DescendantPeriodLookup;
  descendantTeamLookup: DescendantTeamLookup;
  descendantObjectiveLookup: DescendantObjectiveLookup;
}

export interface FilterObjectivesResult {
  filtered: Objective[];
  directlyMatchingIds: Set<string>;
}

export function filterObjectives(args: FilterObjectivesArgs): FilterObjectivesResult {
  const {
    orgObjectives, lists,
    filterPeriodIds, filterTagIds, filterTeamIds,
    filterTypes, filterTypeNotSet,
    filterOwnerIds, filterOwnerOperator,
    filterAssigneeIds, filterAssigneeOperator, filterAssigneeNotSet,
    filterNextStepDate, filterLevels, filterWorkflowStatuses,
    filterKeyResultsOnly, filterObjectiveId, filterRootObjectiveId, filterListIds,
    filterLastUpdated, searchQuery,
    includeAncestorPeriods, includeChildPeriods, includeChildTeams,
    showChildren, directChildrenOnly, openChildrenOnly,
    ancestorPeriodLookup, descendantPeriodLookup,
    descendantTeamLookup, descendantObjectiveLookup,
  } = args;

  let result = orgObjectives;

  if (filterPeriodIds.length > 0) {
    let validPeriodIds: string[] = [...filterPeriodIds];
    if (includeAncestorPeriods) {
      filterPeriodIds.forEach(id => {
        validPeriodIds = [...new Set([...validPeriodIds, ...ancestorPeriodLookup(id)])];
      });
    }
    if (includeChildPeriods) {
      filterPeriodIds.forEach(id => {
        validPeriodIds = [...new Set([...validPeriodIds, ...descendantPeriodLookup(id)])];
      });
    }
    result = result.filter((obj: Objective) => validPeriodIds.includes(obj.periodId));
  }

  if (filterTeamIds.length > 0) {
    let validTeamIds = [...filterTeamIds];
    if (includeChildTeams) {
      filterTeamIds.forEach(teamId => {
        validTeamIds = [...new Set([...validTeamIds, ...descendantTeamLookup(teamId)])];
      });
    }
    result = result.filter((obj: Objective) => obj.teamId && validTeamIds.includes(obj.teamId));
  }

  if (filterTagIds.length > 0) {
    result = result.filter((obj: Objective) =>
      obj.tagIds?.some((tagId: string) => filterTagIds.includes(tagId))
    );
  }

  if (filterTypes.length > 0 || filterTypeNotSet) {
    result = result.filter((obj: Objective) => {
      const matchesType = filterTypes.length > 0 && obj.type && filterTypes.includes(obj.type);
      const matchesNotSet = filterTypeNotSet && !obj.type;
      return matchesType || matchesNotSet;
    });
  }

  if (filterLevels.length > 0) {
    result = result.filter((obj: Objective) => filterLevels.includes(obj.level));
  }

  if (filterWorkflowStatuses.length > 0) {
    const includesOnlyActiveStatuses = !filterWorkflowStatuses.includes('done') && !filterWorkflowStatuses.includes('archived');
    result = result.filter((obj: Objective) => {
      if (!obj.workflowStatus) {
        return includesOnlyActiveStatuses;
      }
      return filterWorkflowStatuses.includes(obj.workflowStatus);
    });
  }

  if (filterObjectiveId) {
    const descendantIds = new Set(descendantObjectiveLookup(filterObjectiveId));
    result = result.filter((obj: Objective) => descendantIds.has(obj.id));
  }

  if (filterRootObjectiveId) {
    const rootIds = new Set(descendantObjectiveLookup(filterRootObjectiveId));
    rootIds.add(filterRootObjectiveId);
    result = result.filter((obj: Objective) => rootIds.has(obj.id));
  }

  if (filterOwnerIds.length > 0) {
    if (filterOwnerOperator === 'equals') {
      result = result.filter((obj: Objective) => obj.ownerId && filterOwnerIds.includes(obj.ownerId));
    } else {
      result = result.filter((obj: Objective) => !obj.ownerId || !filterOwnerIds.includes(obj.ownerId));
    }
  }

  if (filterAssigneeIds.length > 0 || filterAssigneeNotSet) {
    if (filterAssigneeOperator === 'equals') {
      result = result.filter((obj: Objective) => {
        const matchesAssignee = obj.assigneeId && filterAssigneeIds.includes(obj.assigneeId);
        const matchesNotSet = filterAssigneeNotSet && !obj.assigneeId;
        return matchesAssignee || matchesNotSet;
      });
    } else {
      result = result.filter((obj: Objective) => {
        const excludesAssignee = !obj.assigneeId || !filterAssigneeIds.includes(obj.assigneeId);
        const matchesNotSet = filterAssigneeNotSet && !obj.assigneeId;
        if (filterAssigneeNotSet && filterAssigneeIds.length === 0) {
          return matchesNotSet;
        }
        return excludesAssignee;
      });
    }
  }

  if (filterNextStepDate) {
    if (filterNextStepDate === 'not_set') {
      result = result.filter((obj: Objective) =>
        !obj.nextStepDate && obj.workflowStatus !== 'done' && obj.workflowStatus !== 'archived'
      );
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayMs = today.getTime();

      result = result.filter((obj: Objective) => {
        if (!obj.nextStepDate) return false;
        const [year, month, day] = obj.nextStepDate.split('-').map(Number);
        const stepDate = new Date(year, month - 1, day);
        stepDate.setHours(0, 0, 0, 0);
        const stepMs = stepDate.getTime();
        const diffDays = (stepMs - todayMs) / (1000 * 60 * 60 * 24);

        if (filterNextStepDate === 'past' || filterNextStepDate === 'today') {
          const now = Date.now();
          const twentyFourHoursMs = 24 * 60 * 60 * 1000;
          const stepEndMs = stepMs + twentyFourHoursMs;
          const diffFromNow = stepEndMs - now;

          if (filterNextStepDate === 'past') {
            return diffFromNow < 0;
          } else {
            return diffFromNow >= 0 && diffFromNow < twentyFourHoursMs;
          }
        }

        switch (filterNextStepDate) {
          case 'last_7d':
            return diffDays >= -7 && diffDays < 0;
          case 'last_30d':
            return diffDays >= -30 && diffDays < 0;
          case 'next_7d':
            return diffDays >= 0 && diffDays <= 7;
          case 'next_30d':
            return diffDays >= 0 && diffDays <= 30;
          case 'future':
            return diffDays >= 0;
          default:
            return true;
        }
      });
    }
  }

  if (filterLastUpdated) {
    const option = LAST_UPDATED_OPTIONS.find(o => o.value === filterLastUpdated);
    if (option) {
      const cutoff = Date.now() - option.ms;
      result = result.filter((obj: Objective) => new Date(obj.updatedAt).getTime() >= cutoff);
    }
  }

  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    const keywords = query.split(/\s+/);
    result = result.filter((obj: Objective) => {
      const searchText = `${obj.title} ${obj.description || ''} ${obj.nextStep || ''}`.toLowerCase();
      return keywords.every(keyword => searchText.includes(keyword));
    });
  }

  if (filterListIds.length > 0) {
    const selectedLists = lists.filter(l => filterListIds.includes(l.id));
    const listObjectiveIds = new Set(
      selectedLists.flatMap(list => list.items.map(item => item.objectiveId))
    );
    result = result.filter((obj: Objective) => listObjectiveIds.has(obj.id));
  }

  if (filterKeyResultsOnly) {
    result = result.filter((obj: Objective) => obj.isKeyResult === true);
  }

  const directlyMatchingIds = new Set(result.map((obj: Objective) => obj.id));

  if (showChildren && result.length > 0) {
    const matchingIds = new Set(result.map((obj: Objective) => obj.id));
    const isOpenChild = (obj: Objective) =>
      !openChildrenOnly || (obj.workflowStatus !== 'done' && obj.workflowStatus !== 'archived');

    if (directChildrenOnly) {
      const directChildren = orgObjectives.filter((obj: Objective) =>
        obj.parentId && matchingIds.has(obj.parentId) && !matchingIds.has(obj.id) && isOpenChild(obj)
      );
      result = [...result, ...directChildren];
    } else {
      const descendants: Objective[] = [];
      const findDescendants = (parentIds: Set<string>) => {
        const children = orgObjectives.filter((obj: Objective) =>
          obj.parentId && parentIds.has(obj.parentId) && !matchingIds.has(obj.id) && isOpenChild(obj)
        );
        if (children.length > 0) {
          children.forEach((child: Objective) => {
            if (!matchingIds.has(child.id)) {
              descendants.push(child);
              matchingIds.add(child.id);
            }
          });
          findDescendants(new Set(children.map((c: Objective) => c.id)));
        }
      };
      findDescendants(matchingIds);
      result = [...result, ...descendants];
    }
  }

  return { filtered: result, directlyMatchingIds };
}
