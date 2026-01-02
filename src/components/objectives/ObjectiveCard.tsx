import { useState, useMemo } from 'react';
import type { Objective, ObjectiveLevel, KeyResult, Tag, Team, Period } from '../../types';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { getStatusColor } from '../../utils/calculations';
import { ProgressBar } from '../common/ProgressBar';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { KeyResultItem } from '../key-results/KeyResultItem';
import { KeyResultForm } from '../key-results/KeyResultForm';
import { ObjectiveForm } from './ObjectiveForm';

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

  const allKeyResults = useOKRStore((state: OKRStore) => state.keyResults);
  const allObjectives = useOKRStore((state: OKRStore) => state.objectives);
  const deleteObjective = useOKRStore((state: OKRStore) => state.deleteObjective);
  const teams = useOKRStore((state: OKRStore) => state.teams);
  const periods = useOKRStore((state: OKRStore) => state.periods);
  const allTags = useOKRStore((state: OKRStore) => state.tags);

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
            <div className="flex items-center gap-2 mb-1">
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
            </div>
            <h3 className="text-lg font-medium text-gray-900">{objective.title}</h3>
            {objective.description && (
              <p className="text-sm text-gray-600 mt-1">{objective.description}</p>
            )}
            <div className="mt-3 max-w-xs">
              <ProgressBar progress={objective.progress} size="sm" />
            </div>
          </div>

          <div className="flex items-center gap-1 ml-4">
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

      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Edit Objective">
        <ObjectiveForm objective={objective} onClose={() => setShowEdit(false)} />
      </Modal>

      <Modal isOpen={showAddChild} onClose={() => setShowAddChild(false)} title="Add Child Objective">
        <ObjectiveForm
          parentId={objective.id}
          defaultLevel={getChildLevel(objective.level)}
          onClose={() => setShowAddChild(false)}
        />
      </Modal>
    </div>
  );
}
