import { useMemo, useState } from 'react';
import { useOKRStore } from '../../store/okrStore';
import { ObjectiveCard } from './ObjectiveCard';
import type { Period, PeriodType } from '../../types';

const PERIOD_TYPE_BADGES: Record<PeriodType, { label: string; color: string }> = {
  quarter: { label: 'Q', color: 'bg-purple-100 text-purple-700' },
  month: { label: 'M', color: 'bg-blue-100 text-blue-700' },
  week: { label: 'W', color: 'bg-green-100 text-green-700' },
};

interface PeriodFilterButtonProps {
  period: Period;
  periods: Period[];
  activePeriodId: string | null;
  onSelect: (id: string | null) => void;
  depth: number;
}

function PeriodFilterButton({ period, periods, activePeriodId, onSelect, depth }: PeriodFilterButtonProps) {
  const childPeriods = periods.filter((p) => p.parentId === period.id);
  const isActive = activePeriodId === period.id;
  // Fallback for periods created before type was added
  const periodType = period.type || 'quarter';
  const badge = PERIOD_TYPE_BADGES[periodType];

  return (
    <>
      <button
        onClick={() => onSelect(isActive ? null : period.id)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
          isActive
            ? 'bg-gray-800 text-white'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
        }`}
        style={{ marginLeft: depth > 0 ? `${depth * 8}px` : undefined }}
      >
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${isActive ? 'bg-gray-600' : badge.color}`}>
          {badge.label}
        </span>
        {period.name}
      </button>
      {childPeriods.map((child) => (
        <PeriodFilterButton
          key={child.id}
          period={child}
          periods={periods}
          activePeriodId={activePeriodId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

export function ObjectiveTree() {
  const [isFilterExpanded, setIsFilterExpanded] = useState(true);
  const objectives = useOKRStore((state) => state.objectives);
  const periods = useOKRStore((state) => state.periods);
  const teams = useOKRStore((state) => state.teams);
  const tags = useOKRStore((state) => state.tags);
  const activePeriodId = useOKRStore((state) => state.activePeriodId);
  const filterTagIds = useOKRStore((state) => state.filterTagIds);
  const filterTeamIds = useOKRStore((state) => state.filterTeamIds);
  const setActivePeriod = useOKRStore((state) => state.setActivePeriod);
  const toggleFilterTag = useOKRStore((state) => state.toggleFilterTag);
  const toggleFilterTeam = useOKRStore((state) => state.toggleFilterTeam);
  const clearAllFilters = useOKRStore((state) => state.clearAllFilters);

  const hasActiveFilters = activePeriodId || filterTagIds.length > 0 || filterTeamIds.length > 0;

  // Get all ancestor period IDs for a given period (including the period itself)
  const getAncestorPeriodIds = useMemo(() => {
    return (periodId: string): string[] => {
      const ids: string[] = [periodId];
      let current = periods.find((p) => p.id === periodId);
      while (current?.parentId) {
        ids.push(current.parentId);
        current = periods.find((p) => p.id === current!.parentId);
      }
      return ids;
    };
  }, [periods]);

  // Get root periods (no parent) for hierarchical display
  const rootPeriods = useMemo(() => {
    return periods.filter((p) => !p.parentId);
  }, [periods]);

  // Apply all filters
  const filteredObjectives = useMemo(() => {
    let result = objectives;

    // Filter by period (including ancestor periods)
    if (activePeriodId) {
      const validPeriodIds = getAncestorPeriodIds(activePeriodId);
      result = result.filter((obj) => validPeriodIds.includes(obj.periodId));
    }

    // Filter by teams
    if (filterTeamIds.length > 0) {
      result = result.filter((obj) => obj.teamId && filterTeamIds.includes(obj.teamId));
    }

    // Filter by tags
    if (filterTagIds.length > 0) {
      result = result.filter((obj) =>
        obj.tagIds?.some((tagId) => filterTagIds.includes(tagId))
      );
    }

    return result;
  }, [objectives, activePeriodId, filterTeamIds, filterTagIds, getAncestorPeriodIds]);

  // Get root objectives (no parent)
  const rootObjectives = filteredObjectives.filter((obj) => !obj.parentId);

  // Group by level
  const companyObjectives = rootObjectives.filter((obj) => obj.level === 'company');
  const teamObjectives = rootObjectives.filter((obj) => obj.level === 'team');
  const individualObjectives = rootObjectives.filter((obj) => obj.level === 'individual');

  if (periods.length === 0) {
    return (
      <div className="text-center py-12">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900">No periods yet</h3>
        <p className="mt-1 text-sm text-gray-500">
          Create a period first to start adding objectives.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div
          className="flex items-center justify-between p-4 cursor-pointer"
          onClick={() => setIsFilterExpanded(!isFilterExpanded)}
        >
          <div className="flex items-center gap-2">
            <button className="text-gray-400 hover:text-gray-600">
              <svg
                className={`w-4 h-4 transition-transform ${isFilterExpanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <h3 className="text-sm font-medium text-gray-700">Filters</h3>
            {hasActiveFilters && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                Active
              </span>
            )}
          </div>
          {hasActiveFilters && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearAllFilters();
              }}
              className="text-xs text-blue-600 hover:text-blue-700"
            >
              Clear all
            </button>
          )}
        </div>

        {isFilterExpanded && (
          <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
            {/* Period Filter */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">Time Period</label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setActivePeriod(null)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    !activePeriodId
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  All Periods
                </button>
                {rootPeriods.map((period) => (
                  <PeriodFilterButton
                    key={period.id}
                    period={period}
                    periods={periods}
                    activePeriodId={activePeriodId}
                    onSelect={setActivePeriod}
                    depth={0}
                  />
                ))}
              </div>
            </div>

            {/* Team Filter */}
            {teams.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Team</label>
                <div className="flex flex-wrap gap-2">
                  {teams.map((team) => (
                    <button
                      key={team.id}
                      onClick={() => toggleFilterTeam(team.id)}
                      className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                        filterTeamIds.includes(team.id)
                          ? 'bg-gray-800 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {team.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Tag Filter */}
            {tags.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Tags</label>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => toggleFilterTag(tag.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
                        filterTagIds.includes(tag.id)
                          ? 'bg-gray-800 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${tag.color}`}></span>
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Empty state for filtered results */}
      {filteredObjectives.length === 0 && (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">
            {hasActiveFilters ? 'No matching objectives' : 'No objectives yet'}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {hasActiveFilters
              ? 'Try adjusting your filters or create objectives that match.'
              : 'Get started by creating a new objective.'}
          </p>
        </div>
      )}

      {/* Objectives List */}
      {companyObjectives.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-3 h-3 bg-purple-500 rounded-full"></span>
            Company Objectives
          </h2>
          <div className="space-y-3">
            {companyObjectives.map((obj) => (
              <ObjectiveCard key={obj.id} objective={obj} />
            ))}
          </div>
        </section>
      )}

      {teamObjectives.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
            Team Objectives
          </h2>
          <div className="space-y-3">
            {teamObjectives.map((obj) => (
              <ObjectiveCard key={obj.id} objective={obj} />
            ))}
          </div>
        </section>
      )}

      {individualObjectives.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-3 h-3 bg-green-500 rounded-full"></span>
            Individual Objectives
          </h2>
          <div className="space-y-3">
            {individualObjectives.map((obj) => (
              <ObjectiveCard key={obj.id} objective={obj} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
