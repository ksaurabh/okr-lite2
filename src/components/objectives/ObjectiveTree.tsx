import { useMemo, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { ObjectiveCard } from './ObjectiveCard';
import type { Period, PeriodType, Objective, Team, Tag } from '../../types';

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
  const childPeriods = periods.filter((p: Period) => p.parentId === period.id);
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
      {childPeriods.map((child: Period) => (
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

type ViewMode = 'tree' | 'list';

export function ObjectiveTree() {
  const [isFilterExpanded, setIsFilterExpanded] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [includeAncestorPeriods, setIncludeAncestorPeriods] = useState(false);

  const { organization, user, isSuperAdmin, isOrgAdmin } = useAuth();
  const orgId = organization?.id || '';
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;

  const objectives = useOKRStore((state: OKRStore) => state.objectives);
  const periods = useOKRStore((state: OKRStore) => state.periods);
  const teams = useOKRStore((state: OKRStore) => state.teams);
  const tags = useOKRStore((state: OKRStore) => state.tags);
  const activePeriodId = useOKRStore((state: OKRStore) => state.activePeriodId);
  const filterTagIds = useOKRStore((state: OKRStore) => state.filterTagIds);
  const filterTeamIds = useOKRStore((state: OKRStore) => state.filterTeamIds);
  const setActivePeriod = useOKRStore((state: OKRStore) => state.setActivePeriod);
  const toggleFilterTag = useOKRStore((state: OKRStore) => state.toggleFilterTag);
  const toggleFilterTeam = useOKRStore((state: OKRStore) => state.toggleFilterTeam);
  const clearAllFilters = useOKRStore((state: OKRStore) => state.clearAllFilters);

  // Filter items by organization and visibility (admins see all, others see shared or owned)
  const orgObjectives = useMemo(
    () => objectives.filter((o: Objective) =>
      (!o.orgId || o.orgId === orgId) && (isAdmin || o.shared !== false || o.createdBy === userEmail)
    ),
    [objectives, orgId, userEmail, isAdmin]
  );
  const orgPeriods = useMemo(
    () => periods.filter((p: Period) =>
      (!p.orgId || p.orgId === orgId) && (isAdmin || p.shared !== false || p.createdBy === userEmail)
    ),
    [periods, orgId, userEmail, isAdmin]
  );
  const orgTeams = useMemo(
    () => teams.filter((t: Team) =>
      (!t.orgId || t.orgId === orgId) && (isAdmin || t.shared !== false || t.createdBy === userEmail)
    ),
    [teams, orgId, userEmail, isAdmin]
  );
  const orgTags = useMemo(
    () => tags.filter((t: Tag) =>
      (!t.orgId || t.orgId === orgId) && (isAdmin || t.shared !== false || t.createdBy === userEmail)
    ),
    [tags, orgId, userEmail, isAdmin]
  );

  const hasActiveFilters = activePeriodId || filterTagIds.length > 0 || filterTeamIds.length > 0;

  // Get all ancestor period IDs for a given period (including the period itself)
  const getAncestorPeriodIds = useMemo(() => {
    return (periodId: string): string[] => {
      const ids: string[] = [periodId];
      let current = orgPeriods.find((p: Period) => p.id === periodId);
      while (current?.parentId) {
        ids.push(current.parentId);
        current = orgPeriods.find((p: Period) => p.id === current!.parentId);
      }
      return ids;
    };
  }, [orgPeriods]);

  // Get root periods (no parent) for hierarchical display
  const rootPeriods = useMemo(() => {
    return orgPeriods.filter((p: Period) => !p.parentId);
  }, [orgPeriods]);

  // Apply all filters
  const filteredObjectives = useMemo(() => {
    let result = orgObjectives;

    // Filter by period (optionally including ancestor periods)
    if (activePeriodId) {
      if (includeAncestorPeriods) {
        const validPeriodIds = getAncestorPeriodIds(activePeriodId);
        result = result.filter((obj: Objective) => validPeriodIds.includes(obj.periodId));
      } else {
        result = result.filter((obj: Objective) => obj.periodId === activePeriodId);
      }
    }

    // Filter by teams
    if (filterTeamIds.length > 0) {
      result = result.filter((obj: Objective) => obj.teamId && filterTeamIds.includes(obj.teamId));
    }

    // Filter by tags
    if (filterTagIds.length > 0) {
      result = result.filter((obj: Objective) =>
        obj.tagIds?.some((tagId: string) => filterTagIds.includes(tagId))
      );
    }

    return result;
  }, [orgObjectives, activePeriodId, filterTeamIds, filterTagIds, includeAncestorPeriods, getAncestorPeriodIds]);

  // Get root objectives (no parent)
  const rootObjectives = filteredObjectives.filter((obj: Objective) => !obj.parentId);

  // Group by level
  const companyObjectives = rootObjectives.filter((obj: Objective) => obj.level === 'company');
  const teamObjectives = rootObjectives.filter((obj: Objective) => obj.level === 'team');
  const individualObjectives = rootObjectives.filter((obj: Objective) => obj.level === 'individual');

  if (orgPeriods.length === 0) {
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
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-medium text-gray-500">Time Period</label>
                {activePeriodId && (
                  <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeAncestorPeriods}
                      onChange={(e) => setIncludeAncestorPeriods(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Include parent periods
                  </label>
                )}
              </div>
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
                {rootPeriods.map((period: Period) => (
                  <PeriodFilterButton
                    key={period.id}
                    period={period}
                    periods={orgPeriods}
                    activePeriodId={activePeriodId}
                    onSelect={setActivePeriod}
                    depth={0}
                  />
                ))}
              </div>
            </div>

            {/* Team Filter */}
            {orgTeams.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Team</label>
                <div className="flex flex-wrap gap-2">
                  {orgTeams.map((team: Team) => (
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
            {orgTags.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Tags</label>
                <div className="flex flex-wrap gap-2">
                  {orgTags.map((tag: Tag) => (
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

      {/* View Toggle */}
      <div className="flex justify-end">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          <button
            onClick={() => setViewMode('tree')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
              viewMode === 'tree'
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            Tree
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
              viewMode === 'list'
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            List
          </button>
        </div>
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

      {/* Tree View - Hierarchical grouped by level */}
      {viewMode === 'tree' && (
        <>
          {companyObjectives.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="w-3 h-3 bg-purple-500 rounded-full"></span>
                Company Objectives
              </h2>
              <div className="space-y-3">
                {companyObjectives.map((obj: Objective) => (
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
                {teamObjectives.map((obj: Objective) => (
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
                {individualObjectives.map((obj: Objective) => (
                  <ObjectiveCard key={obj.id} objective={obj} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* List View - Flat list of all objectives */}
      {viewMode === 'list' && filteredObjectives.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            All Objectives ({filteredObjectives.length})
          </h2>
          <div className="space-y-3">
            {filteredObjectives.map((obj: Objective) => (
              <ObjectiveCard key={obj.id} objective={obj} showChildren={false} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
