import { useState, useMemo, useEffect } from 'react';
import type { Objective, ObjectiveLevel, KeyResult, Tag, Team, Period, ObjectiveHistoryEntry, User } from '../../types';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { getStatusColor } from '../../utils/calculations';
import { ProgressBar } from '../common/ProgressBar';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { SlidePane } from '../common/SlidePane';
import { KeyResultItem } from '../key-results/KeyResultItem';
import { KeyResultForm } from '../key-results/KeyResultForm';
import { ObjectiveForm } from './ObjectiveForm';

const API_URL = import.meta.env.VITE_API_URL || '';

interface ObjectiveCardProps {
  objective: Objective;
  depth?: number;
  showChildren?: boolean;
}

const getChildLevel = (parentLevel: ObjectiveLevel): ObjectiveLevel => {
  switch (parentLevel) {
    case 'company': return 'team';
    case 'team': return 'individual';
    default: return 'individual';
  }
};

export function ObjectiveCard({ objective, depth = 0, showChildren = true }: ObjectiveCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showAddKR, setShowAddKR] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showAddChild, setShowAddChild] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [orgUsers, setOrgUsers] = useState<User[]>([]);

  const editorWidth = useOKRStore((state: OKRStore) => state.editorWidth);
  const setEditorWidth = useOKRStore((state: OKRStore) => state.setEditorWidth);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch(`${API_URL}/api/users`, {
          credentials: 'include',
        });
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

  const allKeyResults = useOKRStore((state: OKRStore) => state.keyResults);
  const allObjectives = useOKRStore((state: OKRStore) => state.objectives);
  const deleteObjective = useOKRStore((state: OKRStore) => state.deleteObjective);
  const teams = useOKRStore((state: OKRStore) => state.teams);
  const periods = useOKRStore((state: OKRStore) => state.periods);
  const allTags = useOKRStore((state: OKRStore) => state.tags);

  const { user, isSuperAdmin, isOrgAdmin } = useAuth();
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;
  const canModify = isAdmin || objective.createdBy === userEmail;

  const keyResults = useMemo(
    () => allKeyResults.filter((kr: KeyResult) => kr.objectiveId === objective.id),
    [allKeyResults, objective.id]
  );
  const childObjectives = useMemo(
    () => allObjectives.filter((o: Objective) => o.parentId === objective.id),
    [allObjectives, objective.id]
  );
  const objectiveTags = useMemo(
    () => allTags.filter((tag: Tag) => objective.tagIds?.includes(tag.id)),
    [allTags, objective.tagIds]
  );

  const owner = useMemo(
    () => orgUsers.find((u: User) => u.id === objective.ownerId),
    [orgUsers, objective.ownerId]
  );
  const assignee = useMemo(
    () => orgUsers.find((u: User) => u.id === objective.assigneeId),
    [orgUsers, objective.assigneeId]
  );

  const team = teams.find((t: Team) => t.id === objective.teamId);
  const period = periods.find((p: Period) => p.id === objective.periodId);
  const hasChildren = (showChildren && childObjectives.length > 0) || keyResults.length > 0;

  const levelColors = {
    company: 'border-l-purple-500',
    team: 'border-l-blue-500',
    individual: 'border-l-green-500',
  };

  const levelLabels = {
    company: 'Company',
    team: 'Team',
    individual: 'Individual',
  };

  return (
    <div className={`ml-${depth * 4}`}>
      <div className={`bg-white rounded-lg shadow-sm border border-gray-200 border-l-4 ${levelColors[objective.level]} p-4`}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center justify-between flex-wrap gap-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                {hasChildren && (
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg
                      className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${getStatusColor(objective.status)}`}>
                  {levelLabels[objective.level]}
                </span>
                {team && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                    {team.name}
                  </span>
                )}
                {period && (
                  <span className="text-xs text-gray-500 bg-blue-50 px-2 py-0.5 rounded flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {period.name}
                  </span>
                )}
                {objectiveTags.map((tag: Tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded"
                  >
                    <span className={`w-2 h-2 rounded-full ${tag.color}`}></span>
                    {tag.name}
                  </span>
                ))}
                {objective.shared === false && (
                  <span className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Private
                  </span>
                )}
              </div>
              {objective.createdBy && (
                <span className="text-xs text-gray-400">
                  Created by {objective.createdBy}
                </span>
              )}
            </div>
            <h3 className="text-lg font-medium text-gray-900">{objective.title}</h3>
            {objective.description && (
              <p className="text-sm text-gray-600 mt-1">{objective.description}</p>
            )}
            {(owner || assignee) && (
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                {owner && (
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    Owner: <span className="font-medium text-gray-700">{owner.name}</span>
                  </span>
                )}
                {assignee && (
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    Assignee: <span className="font-medium text-gray-700">{assignee.name}</span>
                  </span>
                )}
              </div>
            )}
            <div className="mt-2 max-w-xs">
              <ProgressBar progress={objective.progress} size="sm" />
            </div>
          </div>

          <div className="flex items-center gap-1 ml-4">
            <Button variant="ghost" size="sm" onClick={() => setShowHistory(true)} title="View history">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </Button>
            {canModify && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setShowEdit(true)}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowAddKR(true)}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </Button>
                {objective.level !== 'individual' && (
                  <Button variant="ghost" size="sm" onClick={() => setShowAddChild(true)}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => deleteObjective(objective.id)}>
                  <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </Button>
              </>
            )}
          </div>
        </div>

        {isExpanded && keyResults.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <h4 className="text-sm font-medium text-gray-500 mb-2">Key Results</h4>
            <div className="space-y-2">
              {keyResults.map((kr: KeyResult) => (
                <KeyResultItem key={kr.id} keyResult={kr} />
              ))}
            </div>
          </div>
        )}

        {showAddKR && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <KeyResultForm
              objectiveId={objective.id}
              onClose={() => setShowAddKR(false)}
            />
          </div>
        )}
      </div>

      {showChildren && isExpanded && childObjectives.length > 0 && (
        <div className="ml-6 mt-2 space-y-2 border-l-2 border-gray-200 pl-4">
          {childObjectives.map((child: Objective) => (
            <ObjectiveCard
              key={child.id}
              objective={child}
              depth={depth + 1}
              showChildren={showChildren}
            />
          ))}
        </div>
      )}

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

      <SlidePane
        isOpen={showAddChild}
        onClose={() => setShowAddChild(false)}
        title="Add Child Objective"
        width="lg"
        customWidth={editorWidth}
        onWidthChange={setEditorWidth}
      >
        <ObjectiveForm
          parentId={objective.id}
          defaultLevel={getChildLevel(objective.level)}
          onClose={() => setShowAddChild(false)}
        />
      </SlidePane>

      <Modal isOpen={showHistory} onClose={() => setShowHistory(false)} title="Edit History">
        <div className="space-y-4 max-h-96 overflow-y-auto">
          {(objective.history || []).length === 0 ? (
            <p className="text-sm text-gray-500">No history available.</p>
          ) : (
            [...(objective.history || [])].reverse().map((entry: ObjectiveHistoryEntry) => (
              <div key={entry.id} className="border-l-2 border-gray-200 pl-4 py-2">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                    entry.action === 'created' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {entry.action === 'created' ? 'Created' : 'Updated'}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mb-2">
                  by {entry.userEmail}
                </p>
                <div className="space-y-1">
                  {entry.changes.map((change, idx) => (
                    <div key={idx} className="text-xs bg-gray-50 rounded p-2">
                      <span className="font-medium text-gray-700">{change.field}:</span>
                      {entry.action === 'created' ? (
                        <span className="text-green-600 ml-1">
                          {String(change.newValue ?? '(empty)')}
                        </span>
                      ) : (
                        <>
                          <span className="text-red-500 line-through ml-1">
                            {String(change.oldValue ?? '(empty)')}
                          </span>
                          <span className="text-gray-400 mx-1">→</span>
                          <span className="text-green-600">
                            {String(change.newValue ?? '(empty)')}
                          </span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
