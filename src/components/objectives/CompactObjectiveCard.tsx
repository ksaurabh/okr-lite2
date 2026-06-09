import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Objective, ObjectiveLevel, ObjectiveType, WorkflowStatus, Period, User, Team, Tag, List } from '../../types';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { usePinnedRowActions, type RowAction } from '../../utils/recentRowAction';
import { resolveJiraEpicForObjective } from '../../utils/jiraEpic';
import { SlidePane } from '../common/SlidePane';
import { ObjectiveForm } from './ObjectiveForm';

const API_URL = import.meta.env.VITE_API_URL || '';

interface CompactObjectiveCardProps {
  objective: Objective;
  depth?: number;
  filteredObjectiveIds?: Set<string>;
  directlyMatchingIds?: Set<string>;
  defaultCollapsed?: boolean;
  visibleColumnsOverride?: import('../../store/okrStore').ColumnKey[];
  onRowClick?: (objective: Objective) => void;
  onTitleClick?: (objective: Objective) => void;
  groupPeriodsByDate?: boolean;
  hideRowActions?: boolean;
  quickAddToListId?: string;
  alwaysShowQuickAdd?: boolean;
  quickAddTooltip?: string;
  kebabActions?: boolean;
  addToPlanBookmark?: boolean;
  removeFromListId?: string;
  // When set, the row's drag handle reorders items within this plan list
  // (by ListItem.order) instead of reordering objective siblings by sortOrder.
  reorderInList?: { listId: string; onReorder: (draggedObjectiveId: string, targetObjectiveId: string) => void };
}

const getChildLevel = (parentLevel: ObjectiveLevel): ObjectiveLevel => {
  switch (parentLevel) {
    case 'company': return 'team';
    case 'team': return 'individual';
    default: return 'individual';
  }
};

const levelBadges: Record<ObjectiveLevel, { label: string; bgColor: string; textColor: string }> = {
  company: { label: 'C', bgColor: 'bg-purple-100', textColor: 'text-purple-700' },
  team: { label: 'T', bgColor: 'bg-blue-100', textColor: 'text-blue-700' },
  individual: { label: 'I', bgColor: 'bg-green-100', textColor: 'text-green-700' },
};

const WORKFLOW_STATUS_OPTIONS: { value: WorkflowStatus; label: string }[] = [
  { value: 'todo', label: 'To Do' },
  { value: 'backlog', label: 'In Backlog' },
  { value: 'planning', label: 'In Planning' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'acceptance', label: 'In Acceptance' },
  { value: 'done', label: 'Done' },
  { value: 'archived', label: 'Archived' },
];

function getNextStepDateIndicator(nextStepDate?: string): { color: string; tooltip: string } | null {
  if (!nextStepDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [year, month, day] = nextStepDate.split('-').map(Number);
  const stepDate = new Date(year, month - 1, day);
  stepDate.setHours(0, 0, 0, 0);

  const diffMs = stepDate.getTime() - today.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays < 0) {
    return { color: 'bg-[#dc2626]', tooltip: 'Next step date is in the past' };
  } else if (diffDays <= 7) {
    return { color: 'bg-[#facc15]', tooltip: 'Next step less than 7d in the future' };
  } else {
    return { color: 'bg-[#22c55e]', tooltip: 'Next step more than 7d in the future' };
  }
}

export function CompactObjectiveCard({ objective: objectiveProp, depth = 0, filteredObjectiveIds, directlyMatchingIds, defaultCollapsed = false, visibleColumnsOverride, onRowClick, onTitleClick, groupPeriodsByDate = false, hideRowActions = false, quickAddToListId, alwaysShowQuickAdd = false, quickAddTooltip, kebabActions = false, addToPlanBookmark = false, removeFromListId, reorderInList }: CompactObjectiveCardProps) {
  // Only root-level items (depth 0) are expanded by default, unless caller opts into collapsed
  const [isExpanded, setIsExpanded] = useState(depth === 0 && !defaultCollapsed);
  const forcedExpandedIds = useOKRStore((s: OKRStore) => s.forcedExpandedIds);
  const setForcedExpandedIds = useOKRStore((s: OKRStore) => s.setForcedExpandedIds);
  const forcedExpanded = forcedExpandedIds ? forcedExpandedIds.includes(objectiveProp.id) : null;
  const effectiveIsExpanded = forcedExpanded !== null ? forcedExpanded : isExpanded;
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState(objectiveProp.title);
  const [editingLevel, setEditingLevel] = useState(false);
  const [editingType, setEditingType] = useState(false);
  const [editingWorkflowStatus, setEditingWorkflowStatus] = useState(false);
  const [editingTeam, setEditingTeam] = useState(false);
  const [editingOwner, setEditingOwner] = useState(false);
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState(false);
  const [editingNextStepDate, setEditingNextStepDate] = useState(false);
  const [editingResolved, setEditingResolved] = useState(false);
  const [editingNextStep, setEditingNextStep] = useState(false);
  const [nextStepValue, setNextStepValue] = useState(objectiveProp.nextStep || '');
  const [editingStoryPoints, setEditingStoryPoints] = useState(false);
  const [storyPointsValue, setStoryPointsValue] = useState(objectiveProp.storyPoints?.toString() || '');
  const [editingValuePoints, setEditingValuePoints] = useState(false);
  const [valuePointsValue, setValuePointsValue] = useState(objectiveProp.valuePoints?.toString() || '');
  const [editingParent, setEditingParent] = useState(false);
  const [parentSearch, setParentSearch] = useState('');
  const [editingTags, setEditingTags] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showListDropdown, setShowListDropdown] = useState(false);
  const [showKebabMenu, setShowKebabMenu] = useState(false);
  const kebabMenuRef = useRef<HTMLDivElement>(null);
  const kebabButtonRef = useRef<HTMLButtonElement>(null);
  const [kebabMenuPos, setKebabMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const [planPickerPos, setPlanPickerPos] = useState<{ top: number; left: number } | null>(null);
  const [planPickerSearch, setPlanPickerSearch] = useState('');
  const planPickerRef = useRef<HTMLDivElement>(null);
  const { isPinned, togglePin } = usePinnedRowActions();
  const [showAddPlanMenu, setShowAddPlanMenu] = useState(false);
  const [addPlanSearch, setAddPlanSearch] = useState('');
  const addPlanMenuRef = useRef<HTMLDivElement>(null);
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const newListInputRef = useRef<HTMLInputElement>(null);
  const tagsDropdownRef = useRef<HTMLDivElement>(null);
  const listDropdownRef = useRef<HTMLDivElement>(null);
  const tagsButtonRef = useRef<HTMLButtonElement>(null);
  const [tagsDropdownPosition, setTagsDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const [listDropdownPosition, setListDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const listButtonRef = useRef<HTMLButtonElement>(null);
  const quickAddInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const levelSelectRef = useRef<HTMLSelectElement>(null);
  const typeSelectRef = useRef<HTMLSelectElement>(null);
  const workflowStatusSelectRef = useRef<HTMLSelectElement>(null);
  const teamSelectRef = useRef<HTMLSelectElement>(null);
  const ownerSelectRef = useRef<HTMLSelectElement>(null);
  const assigneeSelectRef = useRef<HTMLSelectElement>(null);
  const periodSelectRef = useRef<HTMLSelectElement>(null);
  const periodCellRef = useRef<HTMLDivElement>(null);
  const [periodPopoverPos, setPeriodPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [periodActiveCollapsed, setPeriodActiveCollapsed] = useState(false);
  const [periodInactiveCollapsed, setPeriodInactiveCollapsed] = useState(true);
  const nextStepDateInputRef = useRef<HTMLInputElement>(null);
  const nextStepDateCellRef = useRef<HTMLDivElement>(null);
  const [nextStepDatePopoverPos, setNextStepDatePopoverPos] = useState<{ top: number; left: number } | null>(null);
  const resolvedInputRef = useRef<HTMLInputElement>(null);
  const nextStepInputRef = useRef<HTMLInputElement>(null);
  const storyPointsInputRef = useRef<HTMLInputElement>(null);
  const valuePointsInputRef = useRef<HTMLInputElement>(null);
  const parentSearchRef = useRef<HTMLInputElement>(null);
  const parentDropdownRef = useRef<HTMLDivElement>(null);
  const parentButtonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);

  const allObjectives = useOKRStore((state: OKRStore) => state.objectives);
  const periods = useOKRStore((state: OKRStore) => state.periods);
  const teams = useOKRStore((state: OKRStore) => state.teams);
  const allTags = useOKRStore((state: OKRStore) => state.tags);

  // Subscribe directly to this objective from the store to get real-time updates
  const objective = useOKRStore((state: OKRStore) =>
    state.objectives.find((o: Objective) => o.id === objectiveProp.id)
  ) || objectiveProp;
  const addObjective = useOKRStore((state: OKRStore) => state.addObjective);
  const updateObjective = useOKRStore((state: OKRStore) => state.updateObjective);
  const deleteObjective = useOKRStore((state: OKRStore) => state.deleteObjective);
  const cloneObjective = useOKRStore((state: OKRStore) => state.cloneObjective);
  const editorWidth = useOKRStore((state: OKRStore) => state.editorWidth);
  const setEditorWidth = useOKRStore((state: OKRStore) => state.setEditorWidth);
  const columnWidths = useOKRStore((state: OKRStore) => state.columnWidths);
  const visibleColumnsFromStore = useOKRStore((state: OKRStore) => state.visibleColumns);
  const visibleColumns = visibleColumnsOverride ?? visibleColumnsFromStore;
  const nameOnly = !!visibleColumnsOverride && visibleColumnsOverride.length === 0;
  const minimalActions = nameOnly || hideRowActions;
  const setFilterObjective = useOKRStore((state: OKRStore) => state.setFilterObjective);
  const lists = useOKRStore((state: OKRStore) => state.lists);
  const addItemToList = useOKRStore((state: OKRStore) => state.addItemToList);
  const removeItemFromList = useOKRStore((state: OKRStore) => state.removeItemFromList);
  const showListMembership = useOKRStore((state: OKRStore) => state.showListMembership);
  const listMembershipListId = useOKRStore((state: OKRStore) => state.listMembershipListId);
  const createList = useOKRStore((state: OKRStore) => state.createList);

  const { user, isSuperAdmin, isOrgAdmin, organization } = useAuth();
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;
  const canModify = isAdmin || objective.createdBy === userEmail;

  // Find current user's ID from orgUsers (for owner/assignee comparison)
  const currentUserId = useMemo(
    () => orgUsers.find((u: User) => u.email === userEmail)?.id,
    [orgUsers, userEmail]
  );

  // Fetch users for assignee display
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch(`${API_URL}/api/users`, { credentials: 'include' });
        if (response.ok) {
          const data = await response.json();
          setOrgUsers(data.users || []);
        }
      } catch (err) {
        console.error('Failed to fetch users:', err);
      }
    };
    fetchUsers();
  }, []);

  const childObjectives = useMemo(
    () => allObjectives
      .filter((o: Objective) =>
        o.parentId === objective.id &&
        (!filteredObjectiveIds || filteredObjectiveIds.has(o.id))
      )
      .sort((a: Objective, b: Objective) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [allObjectives, objective.id, filteredObjectiveIds]
  );

  // Get all descendant IDs to exclude from parent selection
  const getDescendantIds = useMemo(() => {
    const descendants = new Set<string>();
    const findDescendants = (parentId: string) => {
      allObjectives.forEach((o: Objective) => {
        if (o.parentId === parentId && !descendants.has(o.id)) {
          descendants.add(o.id);
          findDescendants(o.id);
        }
      });
    };
    findDescendants(objective.id);
    return descendants;
  }, [allObjectives, objective.id]);

  // Valid parent objectives: exclude self and all descendants
  const validParentObjectives = useMemo(
    () => allObjectives.filter((o: Objective) =>
      o.id !== objective.id && !getDescendantIds.has(o.id)
    ),
    [allObjectives, objective.id, getDescendantIds]
  );

  // Filtered parent objectives based on search
  const filteredParentObjectives = useMemo(
    () => parentSearch.trim()
      ? validParentObjectives.filter((o: Objective) =>
          o.title.toLowerCase().includes(parentSearch.toLowerCase())
        )
      : validParentObjectives,
    [validParentObjectives, parentSearch]
  );

  const parentObjective = useMemo(
    () => allObjectives.find((o: Objective) => o.id === objective.parentId),
    [allObjectives, objective.parentId]
  );

  // Get objective's current tags
  const objectiveTags = useMemo(
    () => allTags.filter((tag: Tag) => objective.tagIds?.includes(tag.id)),
    [allTags, objective]
  );

  // Get available tags (not already on this objective)
  const availableTags = useMemo(
    () => allTags.filter((tag: Tag) => !objective.tagIds?.includes(tag.id)),
    [allTags, objective]
  );

  const owner = useMemo(
    () => orgUsers.find((u: User) => u.id === objective.ownerId),
    [orgUsers, objective.ownerId]
  );

  const assignee = useMemo(
    () => orgUsers.find((u: User) => u.id === objective.assigneeId),
    [orgUsers, objective.assigneeId]
  );

  const team = useMemo(
    () => teams.find((t: Team) => t.id === objective.teamId),
    [teams, objective.teamId]
  );

  const period = useMemo(
    () => periods.find((p: Period) => p.id === objective.periodId),
    [periods, objective.periodId]
  );

  // Get siblings (objectives with same parent) for reordering
  const siblings = useMemo(
    () => allObjectives
      .filter((o: Objective) => o.parentId === objective.parentId)
      .sort((a: Objective, b: Objective) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [allObjectives, objective.parentId]
  );

  const siblingIndex = useMemo(
    () => siblings.findIndex((o: Objective) => o.id === objective.id),
    [siblings, objective.id]
  );

  const canMoveUp = siblingIndex > 0;
  const canMoveDown = siblingIndex < siblings.length - 1 && siblingIndex >= 0;

  const handleMoveUp = async () => {
    if (!canMoveUp) return;
    const prevSibling = siblings[siblingIndex - 1];
    const prevOrder = prevSibling.sortOrder ?? 0;
    const currentOrder = objective.sortOrder ?? 0;
    // Swap sort orders
    await updateObjective(objective.id, { sortOrder: prevOrder }, userEmail);
    await updateObjective(prevSibling.id, { sortOrder: currentOrder }, userEmail);
  };

  const handleMoveDown = async () => {
    if (!canMoveDown) return;
    const nextSibling = siblings[siblingIndex + 1];
    const nextOrder = nextSibling.sortOrder ?? 0;
    const currentOrder = objective.sortOrder ?? 0;
    // Swap sort orders
    await updateObjective(objective.id, { sortOrder: nextOrder }, userEmail);
    await updateObjective(nextSibling.id, { sortOrder: currentOrder }, userEmail);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent) => {
    if (reorderInList) {
      e.dataTransfer.setData('text/plain', JSON.stringify({
        planReorder: true,
        listId: reorderInList.listId,
        id: objective.id,
      }));
      e.dataTransfer.effectAllowed = 'move';
      return;
    }
    e.dataTransfer.setData('text/plain', JSON.stringify({
      id: objective.id,
      parentId: objective.parentId,
      sortOrder: objective.sortOrder ?? 0,
    }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Only show drag-over effect for siblings (same parent)
    try {
      const data = e.dataTransfer.types.includes('text/plain');
      if (data) {
        setIsDragOver(true);
      }
    } catch {
      // Ignore errors during drag
    }
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));

      // Plan-item reordering mode: only act when both source and target are in
      // the same plan list. Never fall through to sibling sortOrder reordering.
      if (reorderInList || data.planReorder) {
        if (
          data.planReorder &&
          reorderInList &&
          data.listId === reorderInList.listId &&
          data.id !== objective.id
        ) {
          reorderInList.onReorder(data.id, objective.id);
        }
        return;
      }

      const draggedId = data.id;
      const draggedParentId = data.parentId;

      // Only allow drop between siblings (same parent)
      if (draggedParentId !== objective.parentId || draggedId === objective.id) {
        return;
      }

      // Find the dragged objective in siblings
      const draggedIndex = siblings.findIndex((o: Objective) => o.id === draggedId);
      if (draggedIndex === -1) return;

      const targetIndex = siblingIndex;
      if (draggedIndex === targetIndex) return;

      // Reorder: move dragged item to target position
      const newSiblings = [...siblings];
      const [draggedItem] = newSiblings.splice(draggedIndex, 1);
      newSiblings.splice(targetIndex, 0, draggedItem);

      // Update sortOrder for all affected siblings
      const updates = newSiblings.map((sibling, index) =>
        updateObjective(sibling.id, { sortOrder: index }, userEmail)
      );
      await Promise.all(updates);
    } catch (err) {
      console.error('Drop failed:', err);
    }
  };

  const handleDragEnd = () => {
    setIsDragOver(false);
  };

  const hasChildren = childObjectives.length > 0;
  const badge = levelBadges[objective.level];
  const isOwnerOrAssignee = !!currentUserId && (objective.ownerId === currentUserId || objective.assigneeId === currentUserId);
  // Adding a child requires edit rights on the parent (creator/admin) or being
  // its owner/assignee. Read-only objectives narrow this to owner/assignee
  // (plus the creator and admins).
  const isTrackedInJira = !!objective.jiraEpicKey;
  const canAddChild = (canModify || isOwnerOrAssignee) && !isTrackedInJira;

  const levelOptions: { value: ObjectiveLevel; label: string }[] = [
    { value: 'company', label: 'Company' },
    { value: 'team', label: 'Team' },
    { value: 'individual', label: 'Individual' },
  ];

  const typeOptions: { value: ObjectiveType; label: string }[] = [
    { value: 'initiative', label: 'Initiative' },
    { value: 'saga', label: 'Saga' },
    { value: 'epic', label: 'Epic' },
    { value: 'story', label: 'Story' },
    { value: 'subtask', label: 'SubTask' },
  ];

  useEffect(() => {
    if (showQuickAdd && quickAddInputRef.current) {
      quickAddInputRef.current.focus();
    }
  }, [showQuickAdd]);

  // Sync editTitleValue when objective title changes externally
  useEffect(() => {
    if (!editingTitle) {
      setEditTitleValue(objective.title);
    }
  }, [objective.title, editingTitle]);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    if (editingLevel && levelSelectRef.current) {
      levelSelectRef.current.focus();
    }
  }, [editingLevel]);

  useEffect(() => {
    if (editingType && typeSelectRef.current) {
      typeSelectRef.current.focus();
    }
  }, [editingType]);

  useEffect(() => {
    if (editingWorkflowStatus && workflowStatusSelectRef.current) {
      workflowStatusSelectRef.current.focus();
    }
  }, [editingWorkflowStatus]);

  useEffect(() => {
    if (editingTeam && teamSelectRef.current) {
      teamSelectRef.current.focus();
    }
  }, [editingTeam]);

  useEffect(() => {
    if (editingOwner && ownerSelectRef.current) {
      ownerSelectRef.current.focus();
    }
  }, [editingOwner]);

  useEffect(() => {
    if (editingAssignee && assigneeSelectRef.current) {
      assigneeSelectRef.current.focus();
    }
  }, [editingAssignee]);

  useEffect(() => {
    if (editingPeriod && periodCellRef.current) {
      const rect = periodCellRef.current.getBoundingClientRect();
      setPeriodPopoverPos({ top: rect.bottom + 4, left: rect.left });
    } else {
      setPeriodPopoverPos(null);
    }
  }, [editingPeriod]);

  useEffect(() => {
    if (!editingPeriod) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (periodCellRef.current?.contains(target)) return;
      if (target.closest('[data-period-popover]')) return;
      setEditingPeriod(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editingPeriod]);

  useEffect(() => {
    if (editingNextStepDate && nextStepDateCellRef.current) {
      const rect = nextStepDateCellRef.current.getBoundingClientRect();
      setNextStepDatePopoverPos({ top: rect.bottom + 4, left: rect.left });
    } else {
      setNextStepDatePopoverPos(null);
    }
  }, [editingNextStepDate]);

  useEffect(() => {
    if (!editingNextStepDate) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (nextStepDateCellRef.current?.contains(target)) return;
      if (target.closest('[data-next-date-panel]')) return;
      setEditingNextStepDate(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editingNextStepDate]);

  useEffect(() => {
    if (editingResolved && resolvedInputRef.current) {
      resolvedInputRef.current.focus();
    }
  }, [editingResolved]);

  useEffect(() => {
    if (editingNextStep && nextStepInputRef.current) {
      nextStepInputRef.current.focus();
      nextStepInputRef.current.select();
    }
  }, [editingNextStep]);

  // Sync nextStepValue when objective changes externally
  useEffect(() => {
    if (!editingNextStep) {
      setNextStepValue(objective.nextStep || '');
    }
  }, [objective.nextStep, editingNextStep]);

  useEffect(() => {
    if (editingStoryPoints && storyPointsInputRef.current) {
      storyPointsInputRef.current.focus();
      storyPointsInputRef.current.select();
    }
  }, [editingStoryPoints]);

  // Sync storyPointsValue when objective changes externally
  useEffect(() => {
    if (!editingStoryPoints) {
      setStoryPointsValue(objective.storyPoints?.toString() || '');
    }
  }, [objective.storyPoints, editingStoryPoints]);

  useEffect(() => {
    if (editingValuePoints && valuePointsInputRef.current) {
      valuePointsInputRef.current.focus();
      valuePointsInputRef.current.select();
    }
  }, [editingValuePoints]);

  // Sync valuePointsValue when objective changes externally
  useEffect(() => {
    if (!editingValuePoints) {
      setValuePointsValue(objective.valuePoints?.toString() || '');
    }
  }, [objective.valuePoints, editingValuePoints]);

  useEffect(() => {
    if (editingParent) {
      // Calculate dropdown position based on button location
      if (parentButtonRef.current) {
        const rect = parentButtonRef.current.getBoundingClientRect();
        setDropdownPosition({ top: rect.bottom + 2, left: rect.left });
      }
      // Focus the search input after a brief delay to allow positioning
      setTimeout(() => {
        parentSearchRef.current?.focus();
      }, 0);
    } else {
      setDropdownPosition(null);
    }
  }, [editingParent]);

  // Close parent dropdown when clicking outside
  useEffect(() => {
    if (!editingParent) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (parentDropdownRef.current && !parentDropdownRef.current.contains(e.target as Node)) {
        setEditingParent(false);
        setParentSearch('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editingParent]);

  // Tags dropdown positioning
  useEffect(() => {
    if (editingTags && tagsButtonRef.current) {
      const rect = tagsButtonRef.current.getBoundingClientRect();
      setTagsDropdownPosition({ top: rect.bottom + 2, left: rect.left });
    } else {
      setTagsDropdownPosition(null);
    }
  }, [editingTags]);

  // Close tags dropdown when clicking outside
  useEffect(() => {
    if (!editingTags) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (tagsDropdownRef.current && !tagsDropdownRef.current.contains(e.target as Node) &&
          tagsButtonRef.current && !tagsButtonRef.current.contains(e.target as Node)) {
        setEditingTags(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editingTags]);

  useEffect(() => {
    if (!showKebabMenu) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (kebabMenuRef.current && kebabMenuRef.current.contains(target)) return;
      if (kebabButtonRef.current && kebabButtonRef.current.contains(target)) return;
      setShowKebabMenu(false);
      setKebabMenuPos(null);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showKebabMenu]);

  useEffect(() => {
    if (!showPlanPicker) return;
    const onClick = (e: MouseEvent) => {
      if (planPickerRef.current && planPickerRef.current.contains(e.target as Node)) return;
      setShowPlanPicker(false);
      setPlanPickerPos(null);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showPlanPicker]);

  useEffect(() => {
    if (!showAddPlanMenu) return;
    const onClick = (e: MouseEvent) => {
      if (addPlanMenuRef.current && !addPlanMenuRef.current.contains(e.target as Node)) setShowAddPlanMenu(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showAddPlanMenu]);

  // List dropdown positioning
  useEffect(() => {
    if (showListDropdown && listButtonRef.current) {
      const rect = listButtonRef.current.getBoundingClientRect();
      setListDropdownPosition({ top: rect.bottom + 2, left: rect.left });
    } else {
      setListDropdownPosition(null);
    }
  }, [showListDropdown]);

  // Close list dropdown when clicking outside
  useEffect(() => {
    if (!showListDropdown) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (listDropdownRef.current && !listDropdownRef.current.contains(e.target as Node) &&
          listButtonRef.current && !listButtonRef.current.contains(e.target as Node)) {
        setShowListDropdown(false);
        setIsCreatingList(false);
        setNewListName('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showListDropdown]);

  // Focus new list input when creating
  useEffect(() => {
    if (isCreatingList && newListInputRef.current) {
      newListInputRef.current.focus();
    }
  }, [isCreatingList]);

  const handleTitleSave = async () => {
    setEditingTitle(false);
    const trimmedTitle = editTitleValue.trim();
    if (trimmedTitle && trimmedTitle !== objective.title) {
      await updateObjective(objective.id, { title: trimmedTitle }, userEmail);
    } else {
      setEditTitleValue(objective.title); // Reset if empty or unchanged
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleTitleSave();
    } else if (e.key === 'Escape') {
      setEditingTitle(false);
      setEditTitleValue(objective.title);
    }
  };

  const handleLevelChange = async (newLevel: ObjectiveLevel) => {
    setEditingLevel(false);
    if (newLevel !== objective.level) {
      await updateObjective(objective.id, { level: newLevel }, userEmail);
    }
  };

  const handleTypeChange = async (newType: ObjectiveType) => {
    setEditingType(false);
    if (newType !== objective.type) {
      await updateObjective(objective.id, { type: newType }, userEmail);
    }
  };

  const handleWorkflowStatusChange = async (newStatus: WorkflowStatus) => {
    setEditingWorkflowStatus(false);
    if (newStatus !== objective.workflowStatus) {
      await updateObjective(objective.id, { workflowStatus: newStatus }, userEmail);
    }
  };

  const handleTeamChange = async (newTeamId: string) => {
    setEditingTeam(false);
    if (newTeamId !== (objective.teamId || '')) {
      await updateObjective(objective.id, { teamId: newTeamId || undefined }, userEmail);
    }
  };

  const handleOwnerChange = async (newOwnerId: string) => {
    setEditingOwner(false);
    if (newOwnerId !== (objective.ownerId || '')) {
      await updateObjective(objective.id, { ownerId: newOwnerId || undefined }, userEmail);
    }
  };

  const handleAssigneeChange = async (newAssigneeId: string) => {
    setEditingAssignee(false);
    if (newAssigneeId !== (objective.assigneeId || '')) {
      await updateObjective(objective.id, { assigneeId: newAssigneeId || undefined }, userEmail);
    }
  };

  const handlePeriodChange = async (newPeriodId: string) => {
    setEditingPeriod(false);
    if (newPeriodId !== objective.periodId) {
      await updateObjective(objective.id, { periodId: newPeriodId }, userEmail);
    }
  };

  const handleNextStepDateChange = async (newDate: string) => {
    setEditingNextStepDate(false);
    if (newDate !== (objective.nextStepDate || '')) {
      await updateObjective(objective.id, { nextStepDate: newDate || undefined }, userEmail);
    }
  };

  const formatYmd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const formatShortDate = (ymd: string) => {
    const [y, m, day] = ymd.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const nextStepDateShortcuts = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const out: { label: string; date: string }[] = [];

    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const week = new Date(today); week.setDate(week.getDate() + 7);
    const month = new Date(today); month.setMonth(month.getMonth() + 1);
    const quarter = new Date(today); quarter.setMonth(quarter.getMonth() + 3);
    out.push({ label: 'Today', date: formatYmd(today) });
    out.push({ label: 'Tomorrow', date: formatYmd(tomorrow) });
    out.push({ label: 'Next Week', date: formatYmd(week) });
    out.push({ label: 'Next Month', date: formatYmd(month) });
    out.push({ label: 'Next Quarter', date: formatYmd(quarter) });

    const todayMs = today.getTime();
    const futurePeriods = periods
      .filter((p: Period) => {
        const [y, m, d] = p.startDate.split('-').map(Number);
        return new Date(y, m - 1, d).getTime() > todayMs && !p.archived;
      })
      .sort((a: Period, b: Period) => a.startDate.localeCompare(b.startDate));
    futurePeriods.forEach((p: Period) => {
      out.push({ label: p.name, date: p.startDate });
    });

    return out;
  }, [periods]);

  const handleResolvedChange = async (newDate: string) => {
    setEditingResolved(false);
    if (newDate !== (objective.resolvedAt || '')) {
      await updateObjective(objective.id, { resolvedAt: newDate || undefined }, userEmail);
    }
  };

  const handleNextStepSave = async () => {
    setEditingNextStep(false);
    const trimmedValue = nextStepValue.trim();
    if (trimmedValue !== (objective.nextStep || '')) {
      await updateObjective(objective.id, { nextStep: trimmedValue || undefined }, userEmail);
    } else {
      setNextStepValue(objective.nextStep || '');
    }
  };

  const handleNextStepKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNextStepSave();
    } else if (e.key === 'Escape') {
      setEditingNextStep(false);
      setNextStepValue(objective.nextStep || '');
    }
  };

  const handleStoryPointsSave = async () => {
    setEditingStoryPoints(false);
    const trimmedValue = storyPointsValue.trim();
    const numValue = trimmedValue ? parseFloat(trimmedValue) : undefined;
    if (numValue !== objective.storyPoints) {
      if (numValue === undefined || (!isNaN(numValue) && numValue >= 0)) {
        await updateObjective(objective.id, { storyPoints: numValue }, userEmail);
      } else {
        setStoryPointsValue(objective.storyPoints?.toString() || '');
      }
    }
  };

  const handleStoryPointsKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleStoryPointsSave();
    } else if (e.key === 'Escape') {
      setEditingStoryPoints(false);
      setStoryPointsValue(objective.storyPoints?.toString() || '');
    }
  };

  const handleValuePointsSave = async () => {
    setEditingValuePoints(false);
    const trimmedValue = valuePointsValue.trim();
    const numValue = trimmedValue ? parseFloat(trimmedValue) : undefined;
    if (numValue !== objective.valuePoints) {
      if (numValue === undefined || (!isNaN(numValue) && numValue >= 0)) {
        await updateObjective(objective.id, { valuePoints: numValue }, userEmail);
      } else {
        setValuePointsValue(objective.valuePoints?.toString() || '');
      }
    }
  };

  const handleValuePointsKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleValuePointsSave();
    } else if (e.key === 'Escape') {
      setEditingValuePoints(false);
      setValuePointsValue(objective.valuePoints?.toString() || '');
    }
  };

  const handleParentChange = async (newParentId: string) => {
    setEditingParent(false);
    setParentSearch('');
    if (newParentId !== (objective.parentId || '')) {
      await updateObjective(objective.id, { parentId: newParentId || undefined }, userEmail);
    }
  };

  const handleAddTag = async (tagId: string) => {
    const newTagIds = [...(objective.tagIds || []), tagId];
    await updateObjective(objective.id, { tagIds: newTagIds }, userEmail);
  };

  const handleRemoveTag = async (tagId: string) => {
    const newTagIds = (objective.tagIds || []).filter(id => id !== tagId);
    await updateObjective(objective.id, { tagIds: newTagIds }, userEmail);
  };

  const isInList = (listId: string) => {
    const list = lists.find(l => l.id === listId);
    return list?.items.some(item => item.objectiveId === objective.id) || false;
  };

  // Get lists that contain this objective (gated by the "show list membership" view option)
  const objectiveLists = useMemo(
    () => {
      if (!showListMembership) return [];
      const memberLists = lists.filter(list => list.items.some(item => item.objectiveId === objective.id));
      if (listMembershipListId) {
        return memberLists.filter(list => list.id === listMembershipListId);
      }
      return memberLists;
    },
    [lists, objective.id, showListMembership, listMembershipListId]
  );

  const handleToggleList = async (listId: string) => {
    if (isInList(listId)) {
      await removeItemFromList(listId, objective.id);
    } else {
      await addItemToList(listId, objective.id);
    }
  };

  const handleCreateListAndAdd = async () => {
    if (!newListName.trim()) return;
    const newList = await createList(newListName.trim());
    if (newList) {
      await addItemToList(newList.id, objective.id);
    }
    setShowListDropdown(false);
    setIsCreatingList(false);
    setNewListName('');
  };

  const handleQuickAdd = async () => {
    if (!quickAddTitle.trim() || isAdding) return;

    setIsAdding(true);
    try {
      // Calculate sortOrder for new child (add at end)
      const maxSortOrder = childObjectives.reduce(
        (max, child) => Math.max(max, child.sortOrder ?? 0),
        0
      );
      await addObjective(
        {
          title: quickAddTitle.trim(),
          description: '',
          level: getChildLevel(objective.level),
          parentId: objective.id,
          periodId: objective.periodId,
          teamId: objective.teamId,
          ownerId: objective.ownerId,
          assigneeId: objective.assigneeId,
          tagIds: [],
          workflowStatus: 'todo',
          sortOrder: maxSortOrder + 1,
        },
        {
          orgId: organization?.id || '',
          userEmail,
          shared: true,
        }
      );
      setQuickAddTitle('');
      setShowQuickAdd(false);
    } catch (err) {
      console.error('Failed to add objective:', err);
    } finally {
      setIsAdding(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleQuickAdd();
    } else if (e.key === 'Escape') {
      setShowQuickAdd(false);
      setQuickAddTitle('');
    }
  };

  return (
    <div>
      {/* Main tree table row */}
      <div
        data-objective-id={objective.id}
        className={`group flex items-center hover:bg-gray-50 border-b border-gray-100 ${isDragOver ? 'bg-blue-50 border-blue-300' : ''} ${onRowClick ? 'cursor-pointer' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={onRowClick ? () => onRowClick(objective) : undefined}
      >
        {/* Tree column - uses title width (or fills the row in nameOnly mode) */}
        <div
          className={`flex items-center gap-1 py-1.5 px-2 min-w-0 ${nameOnly ? 'flex-1' : 'flex-shrink-0'}`}
          style={nameOnly
            ? { paddingLeft: depth * 20 + 8 }
            : { width: columnWidths.title, minWidth: 150, paddingLeft: depth * 20 + 8 }}
        >
          {/* Drag handle */}
          {(reorderInList || (canModify && !minimalActions)) && (
            <div
              draggable
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              className="w-4 h-4 flex items-center justify-center text-gray-300 hover:text-gray-500 flex-shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
              title="Drag to reorder"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="5" r="2" />
                <circle cx="9" cy="12" r="2" />
                <circle cx="9" cy="19" r="2" />
                <circle cx="15" cy="5" r="2" />
                <circle cx="15" cy="12" r="2" />
                <circle cx="15" cy="19" r="2" />
              </svg>
            </div>
          )}
          {!reorderInList && !canModify && !minimalActions && <div className="w-4 flex-shrink-0" />}

          {/* Expand/collapse chevron */}
          <button
            onClick={() => {
              if (forcedExpandedIds) {
                const next = effectiveIsExpanded
                  ? forcedExpandedIds.filter(id => id !== objectiveProp.id)
                  : [...new Set([...forcedExpandedIds, objectiveProp.id])];
                setForcedExpandedIds(next);
              } else {
                setIsExpanded(!effectiveIsExpanded);
              }
            }}
            className={`w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 flex-shrink-0 ${!hasChildren ? 'invisible' : ''}`}
          >
            <svg
              className={`w-3 h-3 transition-transform ${effectiveIsExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Title - editable */}
          {editingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={editTitleValue}
              onChange={(e) => setEditTitleValue(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={handleTitleKeyDown}
              className="flex-1 min-w-0 text-sm px-1 py-0.5 border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          ) : (
            <span
              onClick={() => {
                if (onTitleClick) { onTitleClick(objective); return; }
                if (!minimalActions && canModify) setEditingTitle(true);
              }}
              className={`text-sm truncate flex-1 min-w-0 ${
                directlyMatchingIds && directlyMatchingIds.size > 0 && !directlyMatchingIds.has(objective.id)
                  ? 'text-gray-400'
                  : 'text-gray-900'
              } ${onTitleClick || (!minimalActions && canModify) ? 'cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded -mx-1' : ''}`}
            >
              {objective.title}
            </span>
          )}

          {/* Colored bookmark icons for lists */}
          {!minimalActions && objectiveLists.length > 0 && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {objectiveLists.map((list: List) => (
                <span key={list.id} className="relative group/bookmark">
                  <svg
                    className="w-3.5 h-3.5"
                    fill={list.color}
                    stroke={list.color}
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                  <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 px-2 py-1 text-xs text-white bg-gray-800 rounded whitespace-nowrap opacity-0 group-hover/bookmark:opacity-100 transition-opacity duration-75 pointer-events-none z-50">
                    {list.name}
                  </span>
                </span>
              ))}
            </div>
          )}

          {/* Jira tracking badge */}
          {!minimalActions && objective.jiraEpicKey && (
            <a
              href={objective.jiraEpicUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
              title={`Tracked in Jira as ${objective.jiraEpicKey}`}
            >
              {objective.jiraEpicKey}
            </a>
          )}

          {/* External link */}
          {!minimalActions && objective.link?.url && (
            <a
              href={objective.link.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex-shrink-0 text-blue-500 hover:text-blue-700 text-xs flex items-center gap-0.5"
              title={objective.link.url}
            >
              {objective.link.description || (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              )}
            </a>
          )}

          {/* Next step date indicator */}
          {!minimalActions && (() => {
            const indicator = getNextStepDateIndicator(objective.nextStepDate);
            if (!indicator) return null;
            return (
              <span className="relative flex-shrink-0 group/indicator">
                <span className={`w-2 h-2 rounded-full block ${indicator.color}`} />
                <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 px-2 py-1 text-xs text-white bg-gray-800 rounded whitespace-nowrap opacity-0 group-hover/indicator:opacity-100 transition-opacity duration-75 pointer-events-none z-50">
                  {indicator.tooltip}
                </span>
              </span>
            );
          })()}

          {/* Quick add button - inline with title */}
          {!minimalActions && !kebabActions && canAddChild && (
            <span className="relative group/quickadd flex-shrink-0">
              <button
                onClick={() => setShowQuickAdd(!showQuickAdd)}
                className={`p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity ${showQuickAdd ? 'text-blue-600 bg-blue-50 opacity-100' : 'text-gray-400 hover:text-blue-600'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </button>
              <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 px-2 py-1 text-xs text-white bg-gray-800 rounded whitespace-nowrap opacity-0 group-hover/quickadd:opacity-100 transition-opacity duration-75 pointer-events-none z-50">
                Add child
              </span>
            </span>
          )}

          {/* Filter to descendants button */}
          {!minimalActions && !kebabActions && (
          <span className="relative group/filter flex-shrink-0">
            <button
              onClick={() => setFilterObjective(objective.id)}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="12" r="5" fill="currentColor" />
              </svg>
            </button>
            <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 px-2 py-1 text-xs text-white bg-gray-800 rounded whitespace-nowrap opacity-0 group-hover/filter:opacity-100 transition-opacity duration-75 pointer-events-none z-50">
              Filter to descendants
            </span>
          </span>
          )}

          {/* Add to list/plan button - only when bound to a specific list (i.e. plan context) */}
          {!minimalActions && !kebabActions && quickAddToListId && (
          <div className="relative group/list">
            <button
              ref={listButtonRef}
              onClick={() => {
                if (quickAddToListId) {
                  addItemToList(quickAddToListId, objective.id);
                } else {
                  setShowListDropdown(!showListDropdown);
                }
              }}
              className={alwaysShowQuickAdd
                ? `px-2 py-0.5 text-[11px] font-medium rounded border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 flex-shrink-0 ${showListDropdown ? 'bg-blue-100' : ''}`
                : `p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ${showListDropdown ? 'text-blue-600 opacity-100' : 'text-gray-400 hover:text-gray-600'}`}
            >
              {alwaysShowQuickAdd ? (
                quickAddTooltip || 'Add to Plan'
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              )}
            </button>
            {!showListDropdown && !alwaysShowQuickAdd && (
              <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 px-2 py-1 text-xs text-white bg-gray-800 rounded whitespace-nowrap opacity-0 group-hover/list:opacity-100 transition-opacity duration-75 pointer-events-none z-50">
                {quickAddTooltip || (quickAddToListId ? 'Add to Child List' : 'Add to list')}
              </span>
            )}
            {!quickAddToListId && showListDropdown && listDropdownPosition && (
              <div
                ref={listDropdownRef}
                className="fixed z-[100] bg-white border border-gray-300 rounded shadow-lg min-w-[150px]"
                style={{ top: listDropdownPosition.top, left: listDropdownPosition.left }}
              >
                <div className="py-1">
                  <div className="px-2 py-1 text-xs font-medium text-gray-500 flex items-center justify-between">
                    <span>Lists</span>
                    {!isCreatingList && (
                      <button
                        onClick={() => setIsCreatingList(true)}
                        className="p-0.5 text-blue-600 hover:text-blue-800 rounded hover:bg-blue-50"
                        title="Create new list"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {isCreatingList && (
                    <div className="px-2 py-1 border-b border-gray-200 mb-1">
                      <input
                        ref={newListInputRef}
                        type="text"
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleCreateListAndAdd();
                          } else if (e.key === 'Escape') {
                            setIsCreatingList(false);
                            setNewListName('');
                          }
                        }}
                        placeholder="List name..."
                        className="w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <div className="flex justify-end gap-1 mt-1">
                        <button
                          onClick={() => {
                            setIsCreatingList(false);
                            setNewListName('');
                          }}
                          className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleCreateListAndAdd}
                          disabled={!newListName.trim()}
                          className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          Create
                        </button>
                      </div>
                    </div>
                  )}
                  {lists.map((list: List) => {
                    const inList = isInList(list.id);
                    return (
                      <button
                        key={list.id}
                        onClick={() => handleToggleList(list.id)}
                        className={`w-full text-left text-xs px-2 py-1.5 hover:bg-gray-100 flex items-center justify-between ${inList ? 'text-blue-600' : 'text-gray-700'}`}
                      >
                        <span>
                          {list.name}
                          <span className="text-gray-400 ml-1">({list.items.length})</span>
                        </span>
                        {inList && (
                          <svg className="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          )}

          {/* Pinned actions + Actions menu */}
          {!minimalActions && !kebabActions && (() => {
            const ICONS: Record<RowAction, React.ReactNode> = {
              edit: (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              ),
              clone: (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              ),
              archive: (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4" />
                </svg>
              ),
            };
            const LABELS: Record<RowAction, string> = { edit: 'Edit', clone: 'Clone', archive: 'Archive' };
            const ACTIONS: RowAction[] = ['edit', 'clone', 'archive'];
            const doAction = (a: RowAction) => {
              if (a === 'edit') setShowEdit(true);
              else if (a === 'clone') cloneObjective(objective.id, { orgId: organization?.id || '', userEmail, shared: objective.shared });
              else updateObjective(objective.id, { workflowStatus: 'archived' }, userEmail);
            };
            return (
              <>
                {canModify && ACTIONS.filter(a => isPinned(a)).map(a => (
                  <span key={a} className="relative group/pinned flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); doAction(a); }}
                      className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-700"
                    >
                      {ICONS[a]}
                    </button>
                    <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 px-2 py-1 text-xs text-white bg-gray-800 rounded whitespace-nowrap opacity-0 group-hover/pinned:opacity-100 transition-opacity duration-75 pointer-events-none z-50">
                      {LABELS[a]}
                    </span>
                  </span>
                ))}
                <div ref={kebabMenuRef} className="relative flex-shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowKebabMenu(!showKebabMenu); }}
                    className={`p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity ${showKebabMenu ? 'text-blue-600 bg-blue-50 opacity-100' : 'text-gray-400 hover:text-gray-700'}`}
                    title="Actions"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="6" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="12" cy="18" r="1.5" />
                    </svg>
                  </button>
                  {showKebabMenu && (
                    <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[200px]">
                      {canModify && ACTIONS.map((a, i) => (
                        <div key={a} className={`flex items-center justify-between hover:bg-gray-50 ${i > 0 && a === 'archive' ? 'border-t border-gray-100' : ''}`}>
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowKebabMenu(false); doAction(a); }}
                            className="flex-1 text-left px-3 py-1.5 text-sm text-gray-700 flex items-center gap-2"
                          >
                            {ICONS[a]} {LABELS[a]}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); togglePin(a); }}
                            className={`px-2 py-1.5 text-xs ${isPinned(a) ? 'text-blue-600 hover:text-blue-800' : 'text-gray-300 hover:text-gray-600'}`}
                            title={isPinned(a) ? 'Unpin from row' : 'Pin to row'}
                          >
                            <svg className="w-3.5 h-3.5" fill={isPinned(a) ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5l5 5m9 9l-5-5m-4 4l-3-3m10-7l3 3M9 15l-4 4m6-12l6 6" />
                            </svg>
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setShowKebabMenu(false);
                          setPlanPickerSearch('');
                          const w = 260;
                          setPlanPickerPos({ top: r.bottom + 4, left: Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) });
                          setShowPlanPicker(true);
                        }}
                        className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 border-t border-gray-100"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
                        Add to Plan…
                      </button>
                      {canModify && (!objective.jiraEpicKey ? (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            setShowKebabMenu(false);
                            try {
                              const result = await resolveJiraEpicForObjective(objective);
                              if (result) {
                                await updateObjective(objective.id, { jiraEpicKey: result.key, jiraEpicUrl: result.url }, userEmail);
                              }
                            } catch (err) {
                              window.alert(`Failed to create Jira ticket: ${err instanceof Error ? err.message : String(err)}`);
                            }
                          }}
                          className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 border-t border-gray-100"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                          Create Jira ticket
                        </button>
                      ) : (
                        <a
                          href={objective.jiraEpicUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="w-full text-left px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50 flex items-center gap-2 border-t border-gray-100"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                          Open {objective.jiraEpicKey} in Jira
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </>
            );
          })()}

          {/* Add to Plan bookmark */}
          {!minimalActions && addToPlanBookmark && (() => {
            const plans = lists.filter(l => l.ownerId && l.periodId);
            const q = addPlanSearch.trim().toLowerCase();
            const matches = q ? plans.filter(p => p.name.toLowerCase().includes(q)) : plans;
            return (
              <div ref={addPlanMenuRef} className="relative flex-shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); setAddPlanSearch(''); setShowAddPlanMenu(!showAddPlanMenu); }}
                  className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                  title="Add to Plan"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </button>
                {showAddPlanMenu && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[220px] max-h-72 overflow-y-auto">
                    <div className="px-2 py-1 border-b border-gray-100">
                      <input
                        type="text"
                        autoFocus
                        value={addPlanSearch}
                        onChange={(e) => setAddPlanSearch(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="Search plans…"
                        className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    {plans.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-gray-400">No plans available.</div>
                    ) : matches.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-gray-400">No matches.</div>
                    ) : (
                      matches.map(p => {
                        const already = p.items.some(it => it.objectiveId === objective.id);
                        return (
                          <button
                            key={p.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!already) addItemToList(p.id, objective.id);
                              setShowAddPlanMenu(false);
                            }}
                            disabled={already}
                            className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${already ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-50'}`}
                          >
                            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: p.color || '#6b7280' }} />
                            <span className="flex-1 truncate">{p.name}</span>
                            {already && <span className="text-[10px] text-gray-400">added</span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Kebab actions menu */}
          {!minimalActions && kebabActions && (
            <div className="relative flex-shrink-0">
              <button
                ref={kebabButtonRef}
                onClick={(e) => {
                  e.stopPropagation();
                  if (showKebabMenu) {
                    setShowKebabMenu(false);
                    setKebabMenuPos(null);
                  } else {
                    const r = kebabButtonRef.current?.getBoundingClientRect();
                    if (r) {
                      const menuWidth = 200;
                      setKebabMenuPos({ top: r.bottom + 4, left: Math.max(8, Math.min(window.innerWidth - menuWidth - 8, r.right - menuWidth)) });
                    }
                    setShowKebabMenu(true);
                  }
                }}
                className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                title="Actions"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="6" r="1.5" />
                  <circle cx="12" cy="12" r="1.5" />
                  <circle cx="12" cy="18" r="1.5" />
                </svg>
              </button>
              {showKebabMenu && kebabMenuPos && createPortal(
                <div ref={kebabMenuRef} style={{ position: 'fixed', top: kebabMenuPos.top, left: kebabMenuPos.left }} className="z-[100] bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[180px]">
                  {canModify && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowKebabMenu(false); setShowEdit(true); }}
                      className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Edit
                    </button>
                  )}
                  {canAddChild && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowKebabMenu(false); setShowQuickAdd(true); }}
                      className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Add child
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowKebabMenu(false); setFilterObjective(objective.id); }}
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Filter to descendants
                  </button>
                  {quickAddToListId && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowKebabMenu(false);
                        addItemToList(quickAddToListId, objective.id);
                      }}
                      className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {quickAddTooltip || 'Add to Plan'}
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const r = kebabButtonRef.current?.getBoundingClientRect();
                      setShowKebabMenu(false);
                      setKebabMenuPos(null);
                      setPlanPickerSearch('');
                      if (r) {
                        const w = 260;
                        setPlanPickerPos({ top: r.bottom + 4, left: Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) });
                      }
                      setShowPlanPicker(true);
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Add to Plan…
                  </button>
                  {canModify && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowKebabMenu(false); cloneObjective(objective.id, { orgId: organization?.id || '', userEmail, shared: objective.shared }); }}
                      className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Clone
                    </button>
                  )}
                  {removeFromListId && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowKebabMenu(false); removeItemFromList(removeFromListId, objective.id); }}
                      className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 border-t border-gray-100"
                    >
                      Remove from current plan
                    </button>
                  )}
                  {canModify && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowKebabMenu(false);
                        if (window.confirm(`Delete "${objective.title}"? This also removes its children.`)) {
                          deleteObjective(objective.id);
                        }
                      }}
                      className="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 border-t border-gray-100"
                    >
                      Delete
                    </button>
                  )}
                </div>,
                document.body
              )}
            </div>
          )}
          {showPlanPicker && planPickerPos && createPortal(
            (() => {
              const plans = lists.filter(l => l.ownerId && l.periodId);
              const q = planPickerSearch.trim().toLowerCase();
              const matches = q ? plans.filter(p => p.name.toLowerCase().includes(q)) : plans;
              return (
                <div ref={planPickerRef} style={{ position: 'fixed', top: planPickerPos.top, left: planPickerPos.left, width: 260 }} className="z-[100] bg-white border border-gray-200 rounded-md shadow-lg py-1 max-h-72 overflow-y-auto">
                  <div className="px-2 py-1 border-b border-gray-100 sticky top-0 bg-white">
                    <input
                      type="text"
                      autoFocus
                      value={planPickerSearch}
                      onChange={(e) => setPlanPickerSearch(e.target.value)}
                      placeholder="Search plans…"
                      className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  {plans.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-400">No plans available.</div>
                  ) : matches.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-400">No matches.</div>
                  ) : (
                    matches.map(p => {
                      const already = p.items.some(it => it.objectiveId === objective.id);
                      return (
                        <button
                          key={p.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!already) addItemToList(p.id, objective.id);
                            setShowPlanPicker(false);
                            setPlanPickerPos(null);
                          }}
                          disabled={already}
                          className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${already ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-50'}`}
                        >
                          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: p.color || '#6b7280' }} />
                          <span className="flex-1 truncate">{p.name}</span>
                          {already && <span className="text-[10px] text-gray-400">added</span>}
                        </button>
                      );
                    })
                  )}
                </div>
              );
            })(),
            document.body
          )}
        </div>

        {/* Level column - editable */}
        {visibleColumns.includes('level') && (
          <div className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.level }}>
            {editingLevel ? (
              <select
                ref={levelSelectRef}
                value={objective.level}
                onChange={(e) => handleLevelChange(e.target.value as ObjectiveLevel)}
                onBlur={() => setEditingLevel(false)}
                className="w-full text-xs px-1 py-0.5 border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {levelOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : (
              <button
                onClick={() => canModify && setEditingLevel(true)}
                className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${canModify ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'}`}
                disabled={!canModify}
              >
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold ${badge.bgColor} ${badge.textColor}`}>
                  {badge.label}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Type column - editable */}
        {visibleColumns.includes('type') && (
          <div className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.type }}>
            {editingType ? (
              <select
                ref={typeSelectRef}
                value={objective.type || ''}
                onChange={(e) => handleTypeChange(e.target.value as ObjectiveType)}
                onBlur={() => setEditingType(false)}
                className="w-full text-xs px-1 py-0.5 border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">—</option>
                {typeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : (
              <button
                onClick={() => canModify && setEditingType(true)}
                className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${canModify ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'} ${objective.type ? 'text-gray-600' : 'text-gray-300'}`}
                disabled={!canModify}
              >
                {objective.type ? typeOptions.find(t => t.value === objective.type)?.label : '—'}
              </button>
            )}
          </div>
        )}

        {/* Workflow Status column - editable */}
        {visibleColumns.includes('workflowStatus') && (
          <div className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.workflowStatus }}>
            {editingWorkflowStatus ? (
              <select
                ref={workflowStatusSelectRef}
                value={objective.workflowStatus || 'todo'}
                onChange={(e) => handleWorkflowStatusChange(e.target.value as WorkflowStatus)}
                onBlur={() => setEditingWorkflowStatus(false)}
                className="w-full text-xs px-1 py-0.5 border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {WORKFLOW_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : (
              <button
                onClick={() => canModify && setEditingWorkflowStatus(true)}
                className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${canModify ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'} text-gray-600`}
                disabled={!canModify}
              >
                {WORKFLOW_STATUS_OPTIONS.find(s => s.value === objective.workflowStatus)?.label || 'To Do'}
              </button>
            )}
          </div>
        )}

        {/* Key Result column - toggle with one click */}
        {visibleColumns.includes('keyResult') && (
          <div className="px-1 py-1 flex-shrink-0 flex items-center justify-center" style={{ width: columnWidths.keyResult }}>
            <button
              onClick={async () => {
                if (canModify) {
                  await updateObjective(objective.id, { isKeyResult: !objective.isKeyResult }, userEmail);
                }
              }}
              className={`w-4 h-4 rounded-full border-2 transition-colors ${
                objective.isKeyResult
                  ? 'bg-gray-500 border-gray-500'
                  : 'border-gray-300 hover:border-gray-400'
              } ${canModify ? 'cursor-pointer' : 'cursor-default opacity-50'}`}
              disabled={!canModify}
              title={objective.isKeyResult ? 'Remove Key Result flag' : 'Mark as Key Result'}
            />
          </div>
        )}

        {/* Parent column - editable with search */}
        {visibleColumns.includes('parent') && (
          <div className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.parent }}>
          <button
            ref={parentButtonRef}
            onClick={() => canModify && setEditingParent(true)}
            className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${canModify ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'} ${parentObjective ? 'text-gray-600' : 'text-gray-300'}`}
            disabled={!canModify}
          >
            {parentObjective?.title || '—'}
          </button>
          {editingParent && dropdownPosition && (
            <div
              ref={parentDropdownRef}
              className="fixed z-[100] w-72 bg-white border border-gray-300 rounded shadow-lg"
              style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
            >
              <div className="p-1 border-b border-gray-200">
                <input
                  ref={parentSearchRef}
                  type="text"
                  value={parentSearch}
                  onChange={(e) => setParentSearch(e.target.value)}
                  placeholder="Search objectives..."
                  className="w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setEditingParent(false);
                      setParentSearch('');
                    }
                  }}
                />
              </div>
              <div className="max-h-80 overflow-y-auto">
                <button
                  onClick={() => handleParentChange('')}
                  className={`w-full text-left text-xs px-2 py-1.5 hover:bg-gray-100 ${!objective.parentId ? 'bg-blue-50 text-blue-700' : 'text-gray-600'}`}
                >
                  No parent
                </button>
                {filteredParentObjectives.map((o: Objective) => (
                  <button
                    key={o.id}
                    onClick={() => handleParentChange(o.id)}
                    className={`w-full text-left text-xs px-2 py-1.5 hover:bg-gray-100 truncate ${objective.parentId === o.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                    title={o.title}
                  >
                    {o.title}
                  </button>
                ))}
                {filteredParentObjectives.length === 0 && parentSearch.trim() && (
                  <div className="text-xs text-gray-400 px-2 py-1.5">No matches found</div>
                )}
              </div>
            </div>
          )}
        </div>
        )}

        {/* Team column - editable */}
        {visibleColumns.includes('team') && (
        <div className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.team }}>
          {editingTeam ? (
            <select
              ref={teamSelectRef}
              value={objective.teamId || ''}
              onChange={(e) => handleTeamChange(e.target.value)}
              onBlur={() => setEditingTeam(false)}
              className="w-full text-xs px-1 py-0.5 border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">No team</option>
              {teams.map((t: Team) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => canModify && setEditingTeam(true)}
              className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${canModify ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'} ${team ? 'text-gray-600' : 'text-gray-300'}`}
              disabled={!canModify}
            >
              {team?.name || '—'}
            </button>
          )}
        </div>
        )}

        {/* Owner column - editable */}
        {visibleColumns.includes('owner') && (
        <div className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.owner }}>
          {editingOwner ? (
            <select
              ref={ownerSelectRef}
              value={objective.ownerId || ''}
              onChange={(e) => handleOwnerChange(e.target.value)}
              onBlur={() => setEditingOwner(false)}
              className="w-full text-xs px-1 py-0.5 border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Unassigned</option>
              {orgUsers.map((u: User) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => canModify && setEditingOwner(true)}
              className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${canModify ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'} ${owner ? 'text-gray-600' : 'text-gray-300'}`}
              disabled={!canModify}
            >
              {owner?.name || '—'}
            </button>
          )}
        </div>
        )}

        {/* Assignee column - editable */}
        {visibleColumns.includes('assignee') && (
        <div className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.assignee }}>
          {editingAssignee ? (
            <select
              ref={assigneeSelectRef}
              value={objective.assigneeId || ''}
              onChange={(e) => handleAssigneeChange(e.target.value)}
              onBlur={() => setEditingAssignee(false)}
              className="w-full text-xs px-1 py-0.5 border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Unassigned</option>
              {orgUsers.map((u: User) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => canModify && setEditingAssignee(true)}
              className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${canModify ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'} ${assignee ? 'text-gray-600' : 'text-gray-300'}`}
              disabled={!canModify}
            >
              {assignee?.name || '—'}
            </button>
          )}
        </div>
        )}

        {/* Period column - editable */}
        {visibleColumns.includes('period') && (
        <div ref={periodCellRef} className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.period }}>
          <button
            onClick={() => canModify && setEditingPeriod(!editingPeriod)}
            className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${canModify ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'} ${period ? 'text-gray-600' : 'text-gray-300'} ${editingPeriod ? 'border border-blue-300 bg-white' : ''}`}
            disabled={!canModify}
          >
            {period?.name || '—'}
          </button>
          {editingPeriod && periodPopoverPos && createPortal(
            (() => {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const todayMs = today.getTime();
              const parseYmd = (ymd: string) => {
                const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
                return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : NaN;
              };
              const duration = (p: Period) => {
                const s = parseYmd(p.startDate);
                const e = parseYmd(p.endDate);
                if (!Number.isFinite(s) || !Number.isFinite(e)) return Number.MAX_SAFE_INTEGER;
                return e - s;
              };
              const sortByEndThenDuration = (a: Period, b: Period) => {
                const cmp = a.endDate.localeCompare(b.endDate);
                if (cmp !== 0) return cmp;
                return duration(a) - duration(b);
              };
              const active: Period[] = [];
              const inactive: Period[] = [];
              periods.forEach((p: Period) => {
                const end = parseYmd(p.endDate);
                if (Number.isFinite(end) && end < todayMs) inactive.push(p);
                else active.push(p);
              });
              active.sort(sortByEndThenDuration);
              inactive.sort(sortByEndThenDuration);
              const renderItem = (p: Period) => (
                <button
                  key={p.id}
                  onClick={() => handlePeriodChange(p.id)}
                  className={`w-full text-left text-xs px-3 py-1.5 hover:bg-gray-100 flex items-center justify-between gap-2 ${objective.periodId === p.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-[10px] text-gray-400 flex-shrink-0">{p.endDate}</span>
                </button>
              );
              return (
                <div
                  data-period-popover
                  style={{ position: 'fixed', top: periodPopoverPos.top, left: periodPopoverPos.left, zIndex: 1000 }}
                  className="bg-white border border-gray-200 rounded-md shadow-lg min-w-[240px] max-h-96 overflow-y-auto"
                >
                  <button
                    onClick={() => setPeriodActiveCollapsed(!periodActiveCollapsed)}
                    className="w-full flex items-center gap-1 px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50 hover:bg-gray-100 border-b border-gray-100"
                  >
                    <svg className={`w-3 h-3 transition-transform ${periodActiveCollapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Active ({active.length})
                  </button>
                  {!periodActiveCollapsed && (active.length > 0
                    ? active.map(renderItem)
                    : <div className="px-3 py-1.5 text-xs text-gray-400 italic">None</div>
                  )}
                  <button
                    onClick={() => setPeriodInactiveCollapsed(!periodInactiveCollapsed)}
                    className="w-full flex items-center gap-1 px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50 hover:bg-gray-100 border-y border-gray-100"
                  >
                    <svg className={`w-3 h-3 transition-transform ${periodInactiveCollapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Inactive ({inactive.length})
                  </button>
                  {!periodInactiveCollapsed && (inactive.length > 0
                    ? inactive.map(renderItem)
                    : <div className="px-3 py-1.5 text-xs text-gray-400 italic">None</div>
                  )}
                </div>
              );
            })(),
            document.body
          )}
        </div>
        )}

        {/* Next Step Date column - editable with date picker */}
        {visibleColumns.includes('nextStepDate') && (
        <div ref={nextStepDateCellRef} className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.nextStepDate }}>
          {editingNextStepDate ? (
            <>
              <button
                type="button"
                className="w-full text-left text-xs px-1 py-0.5 rounded border border-blue-300 bg-white text-gray-700"
                onClick={(e) => e.stopPropagation()}
              >
                {objective.nextStepDate ? (() => {
                  const [y, m, d] = objective.nextStepDate.split('-').map(Number);
                  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                })() : 'Pick date'}
              </button>
              {nextStepDatePopoverPos && createPortal(
                <div
                  data-next-date-panel
                  style={{ position: 'fixed', top: nextStepDatePopoverPos.top, left: nextStepDatePopoverPos.left, zIndex: 1000 }}
                  className="bg-white border border-gray-200 rounded-md shadow-lg p-2 flex flex-col gap-2 min-w-[200px]"
                >
                  <input
                    ref={nextStepDateInputRef}
                    type="date"
                    value={objective.nextStepDate || ''}
                    onChange={(e) => handleNextStepDateChange(e.target.value)}
                    className="text-xs px-2 py-1 border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) handleNextStepDateChange(e.target.value);
                    }}
                    className="text-xs px-2 py-1 border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Shortcuts…</option>
                    {nextStepDateShortcuts.map((s) => (
                      <option key={`${s.label}-${s.date}`} value={s.date}>
                        {s.label} — {formatShortDate(s.date)}
                      </option>
                    ))}
                  </select>
                  <div className="flex justify-between items-center pt-1 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => handleNextStepDateChange('')}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingNextStepDate(false)}
                      className="text-xs text-gray-600 hover:text-gray-800"
                    >
                      Close
                    </button>
                  </div>
                </div>,
                document.body
              )}
            </>
          ) : null}
          {!editingNextStepDate && (
            <button
              onClick={() => canModify && setEditingNextStepDate(true)}
              className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${canModify ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'} ${objective.nextStepDate ? 'text-gray-600' : 'text-gray-300'}`}
              disabled={!canModify}
            >
              {objective.nextStepDate ? (() => {
                const [year, month, day] = objective.nextStepDate.split('-').map(Number);
                return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              })() : '—'}
            </button>
          )}
        </div>
        )}

        {/* Next Step column - editable text */}
        {visibleColumns.includes('nextStep') && (
        <div className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.nextStep }}>
          {editingNextStep ? (
            <input
              ref={nextStepInputRef}
              type="text"
              value={nextStepValue}
              onChange={(e) => setNextStepValue(e.target.value)}
              onBlur={handleNextStepSave}
              onKeyDown={handleNextStepKeyDown}
              className="w-full text-xs px-1 py-0.5 border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Next step..."
            />
          ) : (
            <button
              onClick={() => canModify && setEditingNextStep(true)}
              className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${canModify ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'} ${objective.nextStep ? 'text-gray-600' : 'text-gray-300'}`}
              disabled={!canModify}
              title={objective.nextStep || ''}
            >
              {objective.nextStep || '—'}
            </button>
          )}
        </div>
        )}

        {/* Story Points column - editable only by assignee */}
        {visibleColumns.includes('storyPoints') && (
        <div className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.storyPoints }}>
          {(() => {
            const canEditStoryPoints = currentUserId === objective.assigneeId;
            return editingStoryPoints ? (
              <input
                ref={storyPointsInputRef}
                type="number"
                step="0.1"
                min="0"
                value={storyPointsValue}
                onChange={(e) => setStoryPointsValue(e.target.value)}
                onBlur={handleStoryPointsSave}
                onKeyDown={handleStoryPointsKeyDown}
                className="w-full text-xs px-1 py-0.5 border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-right"
              />
            ) : (
              <button
                onClick={() => canEditStoryPoints && setEditingStoryPoints(true)}
                className={`w-full text-right text-xs px-1 py-0.5 rounded truncate ${canEditStoryPoints ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'} ${objective.storyPoints !== undefined ? 'text-gray-600' : 'text-gray-300'}`}
                disabled={!canEditStoryPoints}
                title={canEditStoryPoints ? 'Click to edit' : 'Only assignee can edit'}
              >
                {objective.storyPoints !== undefined ? objective.storyPoints : '—'}
              </button>
            );
          })()}
        </div>
        )}

        {/* Value Points column - editable only by owner */}
        {visibleColumns.includes('valuePoints') && (
        <div className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.valuePoints }}>
          {(() => {
            const canEditValuePoints = currentUserId === objective.ownerId;
            return editingValuePoints ? (
              <input
                ref={valuePointsInputRef}
                type="number"
                step="0.1"
                min="0"
                value={valuePointsValue}
                onChange={(e) => setValuePointsValue(e.target.value)}
                onBlur={handleValuePointsSave}
                onKeyDown={handleValuePointsKeyDown}
                className="w-full text-xs px-1 py-0.5 border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-right"
              />
            ) : (
              <button
                onClick={() => canEditValuePoints && setEditingValuePoints(true)}
                className={`w-full text-right text-xs px-1 py-0.5 rounded truncate ${canEditValuePoints ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'} ${objective.valuePoints !== undefined ? 'text-gray-600' : 'text-gray-300'}`}
                disabled={!canEditValuePoints}
                title={canEditValuePoints ? 'Click to edit' : 'Only owner can edit'}
              >
                {objective.valuePoints !== undefined ? objective.valuePoints : '—'}
              </button>
            );
          })()}
        </div>
        )}

        {/* Tags column - editable */}
        {visibleColumns.includes('tags') && (
        <div className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.tags }}>
          <div className="flex items-center gap-1 flex-wrap">
            {objectiveTags.map((tag: Tag) => (
              <span
                key={tag.id}
                className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded text-white ${tag.color} ${canModify ? 'cursor-pointer hover:opacity-80' : ''}`}
                onClick={() => canModify && handleRemoveTag(tag.id)}
                title={canModify ? 'Click to remove' : tag.name}
              >
                {tag.name}
                {canModify && (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
              </span>
            ))}
            {canModify && availableTags.length > 0 && (
              <button
                ref={tagsButtonRef}
                onClick={() => setEditingTags(!editingTags)}
                className="text-gray-400 hover:text-gray-600 p-0.5"
                title="Add tag"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </button>
            )}
          </div>
          {editingTags && tagsDropdownPosition && (
            <div
              ref={tagsDropdownRef}
              className="fixed z-[100] bg-white border border-gray-300 rounded shadow-lg max-h-48 overflow-y-auto"
              style={{ top: tagsDropdownPosition.top, left: tagsDropdownPosition.left, minWidth: 120 }}
            >
              {availableTags.map((tag: Tag) => (
                <button
                  key={tag.id}
                  onClick={async () => {
                    setEditingTags(false);
                    await handleAddTag(tag.id);
                  }}
                  className="w-full text-left text-xs px-2 py-1.5 hover:bg-gray-100 flex items-center gap-1.5"
                >
                  <span className={`w-2 h-2 rounded-full ${tag.color}`}></span>
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Progress column */}
        {visibleColumns.includes('progress') && (
        <div className="px-2 py-1.5 text-xs text-gray-500 font-medium text-right flex-shrink-0" style={{ width: columnWidths.progress }}>
          {objective.progress}%
        </div>
        )}

        {/* Resolved column - editable date picker */}
        {visibleColumns.includes('resolved') && (
        <div className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.resolved }}>
          {editingResolved ? (
            <input
              ref={resolvedInputRef}
              type="date"
              value={objective.resolvedAt || ''}
              onChange={(e) => handleResolvedChange(e.target.value)}
              onBlur={() => setEditingResolved(false)}
              className="w-full text-xs px-1 py-0.5 border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          ) : (
            <button
              onClick={() => canModify && setEditingResolved(true)}
              className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${canModify ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'} ${objective.resolvedAt ? 'text-gray-600' : 'text-gray-300'}`}
              disabled={!canModify}
            >
              {objective.resolvedAt ? (() => {
                const [year, month, day] = objective.resolvedAt.split('-').map(Number);
                return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              })() : '—'}
            </button>
          )}
        </div>
        )}

        {/* Actions column */}
        <div className="w-20 px-2 py-1.5 flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {canModify && (
            <>
              <button
                onClick={handleMoveUp}
                disabled={!canMoveUp}
                className={`p-1 rounded ${canMoveUp ? 'text-gray-400 hover:text-gray-600' : 'text-gray-200 cursor-not-allowed'}`}
                title="Move up"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button
                onClick={handleMoveDown}
                disabled={!canMoveDown}
                className={`p-1 rounded ${canMoveDown ? 'text-gray-400 hover:text-gray-600' : 'text-gray-200 cursor-not-allowed'}`}
                title="Move down"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <button
                onClick={() => deleteObjective(objective.id)}
                className="p-1 text-gray-400 hover:text-red-500 rounded"
                title="Delete"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Quick add input row */}
      {showQuickAdd && (
        <div className="flex items-center border-b border-gray-100 bg-blue-50/30">
          <div className="flex-1 flex items-center gap-1 py-1 px-2 min-w-0" style={{ paddingLeft: (depth + 1) * 20 + 8 }}>
            <span className="w-4 h-4 flex-shrink-0" /> {/* Spacer for chevron */}
            <input
              ref={quickAddInputRef}
              type="text"
              value={quickAddTitle}
              onChange={(e) => setQuickAddTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add child... (Enter to save, Esc to cancel)"
              className="flex-1 text-sm px-2 py-0.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
              disabled={isAdding}
            />
          </div>
          <div className="px-1" style={{ width: columnWidths.level }} />
          <div className="px-1" style={{ width: columnWidths.type }} />
          <div className="px-1" style={{ width: columnWidths.workflowStatus }} />
          <div className="px-1" style={{ width: columnWidths.parent }} />
          <div className="px-1" style={{ width: columnWidths.team }} />
          <div className="px-1" style={{ width: columnWidths.owner }} />
          <div className="px-1" style={{ width: columnWidths.assignee }} />
          <div className="px-1" style={{ width: columnWidths.period }} />
          <div className="px-1" style={{ width: columnWidths.nextStepDate }} />
          <div className="px-1" style={{ width: columnWidths.nextStep }} />
          <div className="px-1" style={{ width: columnWidths.storyPoints }} />
          <div className="px-1" style={{ width: columnWidths.valuePoints }} />
          <div className="px-1" style={{ width: columnWidths.tags }} />
          <div className="px-2" style={{ width: columnWidths.progress }} />
          <div className="w-20 px-2" />
        </div>
      )}

      {/* Child objectives */}
      {effectiveIsExpanded && hasChildren && (
        <>
          {childObjectives.map((child: Objective) => (
            <CompactObjectiveCard
              key={child.id}
              objective={child}
              depth={depth + 1}
              filteredObjectiveIds={filteredObjectiveIds}
              directlyMatchingIds={directlyMatchingIds}
              visibleColumnsOverride={visibleColumnsOverride}
              onRowClick={onRowClick}
              onTitleClick={onTitleClick}
              groupPeriodsByDate={groupPeriodsByDate}
              hideRowActions={hideRowActions}
              quickAddToListId={quickAddToListId}
            />
          ))}
        </>
      )}

      {/* Edit slide pane */}
      <SlidePane
        isOpen={showEdit}
        onClose={() => setShowEdit(false)}
        title="Edit Objective"
        width="lg"
        customWidth={editorWidth}
        onWidthChange={setEditorWidth}
      >
        <ObjectiveForm objective={objective} onClose={() => setShowEdit(false)} />
      </SlidePane>
    </div>
  );
}
