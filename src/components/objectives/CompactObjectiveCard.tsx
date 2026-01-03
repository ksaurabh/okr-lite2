import { useState, useMemo, useRef, useEffect } from 'react';
import type { Objective, ObjectiveLevel, Period, User, Team } from '../../types';
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

export function CompactObjectiveCard({ objective, depth = 0, filteredObjectiveIds }: CompactObjectiveCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [editingLevel, setEditingLevel] = useState(false);
  const [editingTeam, setEditingTeam] = useState(false);
  const [editingOwner, setEditingOwner] = useState(false);
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState(false);
  const [editingParent, setEditingParent] = useState(false);
  const [parentSearch, setParentSearch] = useState('');
  const quickAddInputRef = useRef<HTMLInputElement>(null);
  const levelSelectRef = useRef<HTMLSelectElement>(null);
  const teamSelectRef = useRef<HTMLSelectElement>(null);
  const ownerSelectRef = useRef<HTMLSelectElement>(null);
  const assigneeSelectRef = useRef<HTMLSelectElement>(null);
  const periodSelectRef = useRef<HTMLSelectElement>(null);
  const parentSearchRef = useRef<HTMLInputElement>(null);
  const parentDropdownRef = useRef<HTMLDivElement>(null);

  const allObjectives = useOKRStore((state: OKRStore) => state.objectives);
  const periods = useOKRStore((state: OKRStore) => state.periods);
  const teams = useOKRStore((state: OKRStore) => state.teams);
  const addObjective = useOKRStore((state: OKRStore) => state.addObjective);
  const updateObjective = useOKRStore((state: OKRStore) => state.updateObjective);
  const deleteObjective = useOKRStore((state: OKRStore) => state.deleteObjective);
  const editorWidth = useOKRStore((state: OKRStore) => state.editorWidth);
  const setEditorWidth = useOKRStore((state: OKRStore) => state.setEditorWidth);

  const { user, isSuperAdmin, isOrgAdmin, organization } = useAuth();
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;
  const canModify = isAdmin || objective.createdBy === userEmail;

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
    () => allObjectives.filter((o: Objective) =>
      o.parentId === objective.id &&
      (!filteredObjectiveIds || filteredObjectiveIds.has(o.id))
    ),
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

  const hasChildren = childObjectives.length > 0;
  const badge = levelBadges[objective.level];
  const canAddChild = objective.level !== 'individual';

  const levelOptions: { value: ObjectiveLevel; label: string }[] = [
    { value: 'company', label: 'Company' },
    { value: 'team', label: 'Team' },
    { value: 'individual', label: 'Individual' },
  ];

  useEffect(() => {
    if (showQuickAdd && quickAddInputRef.current) {
      quickAddInputRef.current.focus();
    }
  }, [showQuickAdd]);

  useEffect(() => {
    if (editingLevel && levelSelectRef.current) {
      levelSelectRef.current.focus();
    }
  }, [editingLevel]);

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
    if (editingParent && parentSearchRef.current) {
      parentSearchRef.current.focus();
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

  const handleLevelChange = async (newLevel: ObjectiveLevel) => {
    setEditingLevel(false);
    if (newLevel !== objective.level) {
      await updateObjective(objective.id, { level: newLevel }, userEmail);
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

  const handleParentChange = async (newParentId: string) => {
    setEditingParent(false);
    setParentSearch('');
    if (newParentId !== (objective.parentId || '')) {
      await updateObjective(objective.id, { parentId: newParentId || undefined }, userEmail);
    }
  };

  const handleQuickAdd = async () => {
    if (!quickAddTitle.trim() || isAdding) return;

    setIsAdding(true);
    try {
      await addObjective(
        {
          title: quickAddTitle.trim(),
          description: '',
          level: getChildLevel(objective.level),
          parentId: objective.id,
          periodId: objective.periodId,
          teamId: objective.teamId,
          tagIds: [],
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
      <div className="group flex items-center hover:bg-gray-50 border-b border-gray-100">
        {/* Tree column - flexible width */}
        <div className="flex-1 flex items-center gap-1 py-1.5 px-2 min-w-0" style={{ paddingLeft: depth * 20 + 8 }}>
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

          {/* Title */}
          <span className="text-sm text-gray-900 truncate">{objective.title}</span>

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
        </div>

        {/* Level column - fixed width, editable */}
        <div className="w-24 px-1 py-1 flex-shrink-0">
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

        {/* Parent column - fixed width, editable with search */}
        <div className="w-36 px-1 py-1 flex-shrink-0 relative">
          {editingParent ? (
            <div ref={parentDropdownRef} className="absolute top-0 left-0 z-50 w-64 bg-white border border-gray-300 rounded shadow-lg">
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
              <div className="max-h-48 overflow-y-auto">
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
          ) : (
            <button
              onClick={() => canModify && setEditingParent(true)}
              className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${canModify ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'} ${parentObjective ? 'text-gray-600' : 'text-gray-300'}`}
              disabled={!canModify}
            >
              {parentObjective?.title || '—'}
            </button>
          )}
        </div>

        {/* Team column - fixed width, editable */}
        <div className="w-28 px-1 py-1 flex-shrink-0">
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

        {/* Owner column - fixed width, editable */}
        <div className="w-28 px-1 py-1 flex-shrink-0">
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

        {/* Assignee column - fixed width, editable */}
        <div className="w-28 px-1 py-1 flex-shrink-0">
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

        {/* Period column - fixed width, editable */}
        <div className="w-28 px-1 py-1 flex-shrink-0">
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

        {/* Progress column - fixed width */}
        <div className="w-14 px-2 py-1.5 text-xs text-gray-500 font-medium text-right flex-shrink-0">
          {objective.progress}%
        </div>

        {/* Actions column - fixed width */}
        <div className="w-16 px-2 py-1.5 flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {canModify && (
            <>
              <button
                onClick={() => setShowEdit(true)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
                title="Edit"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
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
          <div className="w-24 px-1" />
          <div className="w-36 px-1" />
          <div className="w-28 px-1" />
          <div className="w-28 px-1" />
          <div className="w-28 px-1" />
          <div className="w-28 px-1" />
          <div className="w-14 px-2" />
          <div className="w-16 px-2" />
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
