import { useState, useMemo, useRef, useEffect } from 'react';
import type { Objective, ObjectiveLevel, ObjectiveType, WorkflowStatus, Period, User, Team, Tag, List } from '../../types';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { SlidePane } from '../common/SlidePane';
import { ObjectiveForm } from './ObjectiveForm';

const API_URL = import.meta.env.VITE_API_URL || '';

interface CompactObjectiveCardProps {
  objective: Objective;
  depth?: number;
  filteredObjectiveIds?: Set<string>;
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

export function CompactObjectiveCard({ objective: objectiveProp, depth = 0, filteredObjectiveIds }: CompactObjectiveCardProps) {
  // Only root-level items (depth 0) are expanded by default
  const [isExpanded, setIsExpanded] = useState(depth === 0);
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
  const nextStepDateInputRef = useRef<HTMLInputElement>(null);
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
  const editorWidth = useOKRStore((state: OKRStore) => state.editorWidth);
  const setEditorWidth = useOKRStore((state: OKRStore) => state.setEditorWidth);
  const columnWidths = useOKRStore((state: OKRStore) => state.columnWidths);
  const visibleColumns = useOKRStore((state: OKRStore) => state.visibleColumns);
  const setFilterObjective = useOKRStore((state: OKRStore) => state.setFilterObjective);
  const lists = useOKRStore((state: OKRStore) => state.lists);
  const addItemToList = useOKRStore((state: OKRStore) => state.addItemToList);
  const removeItemFromList = useOKRStore((state: OKRStore) => state.removeItemFromList);
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
  const canAddChild = true; // All objectives can have children (stories, tasks, subtasks)

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
    if (editingPeriod && periodSelectRef.current) {
      periodSelectRef.current.focus();
    }
  }, [editingPeriod]);

  useEffect(() => {
    if (editingNextStepDate && nextStepDateInputRef.current) {
      nextStepDateInputRef.current.focus();
    }
  }, [editingNextStepDate]);

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
      // Keep input open for rapid entry
      quickAddInputRef.current?.focus();
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
        className={`group flex items-center hover:bg-gray-50 border-b border-gray-100 ${isDragOver ? 'bg-blue-50 border-blue-300' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Tree column - uses title width */}
        <div className="flex items-center gap-1 py-1.5 px-2 min-w-0" style={{ width: columnWidths.title, minWidth: 150, paddingLeft: depth * 20 + 8 }}>
          {/* Drag handle */}
          {canModify && (
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
          {!canModify && <div className="w-4 flex-shrink-0" />}

          {/* Expand/collapse chevron */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={`w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 flex-shrink-0 ${!hasChildren ? 'invisible' : ''}`}
          >
            <svg
              className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
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
              onClick={() => canModify && setEditingTitle(true)}
              className={`text-sm text-gray-900 truncate ${canModify ? 'cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded -mx-1' : ''}`}
            >
              {objective.title}
            </span>
          )}

          {/* External link */}
          {objective.link?.url && (
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
          {(() => {
            const indicator = getNextStepDateIndicator(objective.nextStepDate);
            if (!indicator) return null;
            return (
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${indicator.color}`}
                title={indicator.tooltip}
              />
            );
          })()}

          {/* Quick add button - inline with title */}
          {canAddChild && (
            <button
              onClick={() => setShowQuickAdd(!showQuickAdd)}
              className={`p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ${showQuickAdd ? 'text-blue-600 bg-blue-50 opacity-100' : 'text-gray-400 hover:text-blue-600'}`}
              title="Add child objective"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </button>
          )}

          {/* Filter to descendants button */}
          <button
            onClick={() => setFilterObjective(objective.id)}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-gray-400 hover:text-gray-600"
            title="Filter to show descendants"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="12" r="5" fill="currentColor" />
            </svg>
          </button>

          {/* Add to list button */}
          <div className="relative">
            <button
              ref={listButtonRef}
              onClick={() => setShowListDropdown(!showListDropdown)}
              className={`p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ${showListDropdown ? 'text-blue-600 opacity-100' : 'text-gray-400 hover:text-gray-600'}`}
              title="Add to list"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
            </button>
            {showListDropdown && listDropdownPosition && (
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

          {/* Edit button - inline with title */}
          {canModify && (
            <button
              onClick={() => setShowEdit(true)}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-gray-400 hover:text-gray-600"
              title="Edit objective"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
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
        <div className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.period }}>
          {editingPeriod ? (
            <select
              ref={periodSelectRef}
              value={objective.periodId}
              onChange={(e) => handlePeriodChange(e.target.value)}
              onBlur={() => setEditingPeriod(false)}
              className="w-full text-xs px-1 py-0.5 border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {periods.map((p: Period) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => canModify && setEditingPeriod(true)}
              className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${canModify ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'} ${period ? 'text-gray-600' : 'text-gray-300'}`}
              disabled={!canModify}
            >
              {period?.name || '—'}
            </button>
          )}
        </div>
        )}

        {/* Next Step Date column - editable with date picker */}
        {visibleColumns.includes('nextStepDate') && (
        <div className="px-1 py-1 flex-shrink-0" style={{ width: columnWidths.nextStepDate }}>
          {editingNextStepDate ? (
            <input
              ref={nextStepDateInputRef}
              type="date"
              value={objective.nextStepDate || ''}
              onChange={(e) => handleNextStepDateChange(e.target.value)}
              onBlur={() => setEditingNextStepDate(false)}
              className="w-full text-xs px-1 py-0.5 border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          ) : (
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
      {isExpanded && hasChildren && (
        <>
          {childObjectives.map((child: Objective) => (
            <CompactObjectiveCard
              key={child.id}
              objective={child}
              depth={depth + 1}
              filteredObjectiveIds={filteredObjectiveIds}
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
