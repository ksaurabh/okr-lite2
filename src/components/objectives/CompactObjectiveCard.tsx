import { useState, useMemo, useRef, useEffect } from 'react';
import type { Objective, ObjectiveLevel, Period, User } from '../../types';
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
  const quickAddInputRef = useRef<HTMLInputElement>(null);

  const allObjectives = useOKRStore((state: OKRStore) => state.objectives);
  const periods = useOKRStore((state: OKRStore) => state.periods);
  const addObjective = useOKRStore((state: OKRStore) => state.addObjective);
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

  const assignee = useMemo(
    () => orgUsers.find((u: User) => u.id === objective.assigneeId),
    [orgUsers, objective.assigneeId]
  );

  const period = useMemo(
    () => periods.find((p: Period) => p.id === objective.periodId),
    [periods, objective.periodId]
  );

  const hasChildren = childObjectives.length > 0;
  const badge = levelBadges[objective.level];
  const canAddChild = objective.level !== 'individual';

  useEffect(() => {
    if (showQuickAdd && quickAddInputRef.current) {
      quickAddInputRef.current.focus();
    }
  }, [showQuickAdd]);

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
    <div style={{ marginLeft: depth * 16 }}>
      {/* Main compact row */}
      <div className="group flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 rounded-md">
        {/* Expand/collapse chevron */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 ${!hasChildren ? 'invisible' : ''}`}
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

        {/* Level badge */}
        <span className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold flex-shrink-0 ${badge.bgColor} ${badge.textColor}`}>
          {badge.label}
        </span>

        {/* Title */}
        <span className="flex-1 text-sm text-gray-900 truncate min-w-0">{objective.title}</span>

        {/* Assignee */}
        {assignee && (
          <span className="flex items-center gap-1 text-xs text-gray-500 flex-shrink-0">
            <span className="w-4 h-4 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-[10px] font-bold">A</span>
            <span className="max-w-[80px] truncate">{assignee.name}</span>
          </span>
        )}

        {/* Period */}
        {period && (
          <span className="text-xs text-gray-500 bg-blue-50 px-1.5 py-0.5 rounded flex-shrink-0 max-w-[80px] truncate">
            {period.name}
          </span>
        )}

        {/* Progress percentage */}
        <span className="text-xs text-gray-500 font-medium w-10 text-right flex-shrink-0">{objective.progress}%</span>

        {/* Action buttons - visible on hover */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
          {canAddChild && (
            <button
              onClick={() => setShowQuickAdd(!showQuickAdd)}
              className={`p-1 rounded ${showQuickAdd ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-blue-600'}`}
              title="Add child objective"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Quick add input */}
      {showQuickAdd && (
        <div style={{ marginLeft: (depth + 1) * 16 }} className="flex items-center gap-2 py-1 px-2">
          <span className="w-4 h-4" /> {/* Spacer for chevron alignment */}
          <span className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold opacity-50 ${levelBadges[getChildLevel(objective.level)].bgColor} ${levelBadges[getChildLevel(objective.level)].textColor}`}>
            {levelBadges[getChildLevel(objective.level)].label}
          </span>
          <input
            ref={quickAddInputRef}
            type="text"
            value={quickAddTitle}
            onChange={(e) => setQuickAddTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add child objective... (Enter to save, Esc to cancel)"
            className="flex-1 text-sm px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            disabled={isAdding}
          />
        </div>
      )}

      {/* Child objectives */}
      {isExpanded && hasChildren && (
        <div className="border-l border-gray-200" style={{ marginLeft: depth * 16 + 8 }}>
          {childObjectives.map((child: Objective) => (
            <CompactObjectiveCard
              key={child.id}
              objective={child}
              depth={depth + 1}
              filteredObjectiveIds={filteredObjectiveIds}
            />
          ))}
        </div>
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
