import { useState, useMemo } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import type { Objective, Period, Team } from '../../types';

export function ChecklistPage() {
  const [isNoNextStepExpanded, setIsNoNextStepExpanded] = useState(true);

  const { organization, user, isSuperAdmin, isOrgAdmin } = useAuth();
  const orgId = organization?.id || '';
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;

  const objectives = useOKRStore((state: OKRStore) => state.objectives);
  const periods = useOKRStore((state: OKRStore) => state.periods);
  const teams = useOKRStore((state: OKRStore) => state.teams);

  // Filter objectives by organization and visibility
  const orgObjectives = useMemo(
    () => objectives.filter((o: Objective) =>
      (!o.orgId || o.orgId === orgId) && (isAdmin || o.shared !== false || o.createdBy === userEmail)
    ),
    [objectives, orgId, userEmail, isAdmin]
  );

  // Get objectives without next step date
  const objectivesWithoutNextStep = useMemo(
    () => orgObjectives.filter((o: Objective) => !o.nextStepDate),
    [orgObjectives]
  );

  // Helper to get period name
  const getPeriodName = (periodId: string) => {
    const period = periods.find((p: Period) => p.id === periodId);
    return period?.name || 'Unknown';
  };

  // Helper to get team name
  const getTeamName = (teamId?: string) => {
    if (!teamId) return null;
    const team = teams.find((t: Team) => t.id === teamId);
    return team?.name;
  };

  return (
    <div className="space-y-6">
      {/* No Next Step Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <button
          onClick={() => setIsNoNextStepExpanded(!isNoNextStepExpanded)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
        >
          <div className="flex items-center gap-3">
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${isNoNextStepExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                Items without Next Step
              </h3>
              <p className="text-xs text-gray-500">
                {objectivesWithoutNextStep.length} {objectivesWithoutNextStep.length === 1 ? 'item' : 'items'} need attention
              </p>
            </div>
          </div>
          <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
            objectivesWithoutNextStep.length > 0
              ? 'bg-amber-100 text-amber-700'
              : 'bg-green-100 text-green-700'
          }`}>
            {objectivesWithoutNextStep.length}
          </span>
        </button>

        {isNoNextStepExpanded && (
          <div className="border-t border-gray-200">
            {objectivesWithoutNextStep.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <svg className="mx-auto h-10 w-10 text-green-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm">All objectives have a next step defined!</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {objectivesWithoutNextStep.map((objective: Objective) => (
                  <li key={objective.id} className="px-4 py-3 hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {objective.title}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                            objective.level === 'company' ? 'bg-purple-100 text-purple-700' :
                            objective.level === 'team' ? 'bg-blue-100 text-blue-700' :
                            'bg-green-100 text-green-700'
                          }`}>
                            {objective.level === 'company' ? 'C' : objective.level === 'team' ? 'T' : 'I'}
                          </span>
                          <span>{getPeriodName(objective.periodId)}</span>
                          {getTeamName(objective.teamId) && (
                            <>
                              <span className="text-gray-300">•</span>
                              <span>{getTeamName(objective.teamId)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600">
                          {objective.progress}%
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
