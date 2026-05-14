import { useState, useEffect, useRef } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import {
  TYPE_OPTIONS,
  LEVEL_OPTIONS,
  NEXT_STEP_DATE_OPTIONS,
  LAST_UPDATED_OPTIONS,
  WORKFLOW_STATUS_OPTIONS,
} from '../../utils/objectiveFilters';
import type {
  Period,
  Team,
  Tag,
  User,
  Objective,
  List,
  FilterOperator,
  NextStepDateFilter,
} from '../../types';

interface ObjectiveFilterPanelProps {
  orgObjectives: Objective[];
  orgPeriods: Period[];
  orgTeams: Team[];
  orgTags: Tag[];
  orgUsers: User[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  includeAncestorPeriods: boolean;
  setIncludeAncestorPeriods: (v: boolean) => void;
  includeChildPeriods: boolean;
  setIncludeChildPeriods: (v: boolean) => void;
  includeChildTeams: boolean;
  setIncludeChildTeams: (v: boolean) => void;
  showChildren: boolean;
  setShowChildren: (v: boolean) => void;
  directChildrenOnly: boolean;
  setDirectChildrenOnly: (v: boolean) => void;
  filterLastUpdated: string | null;
  setFilterLastUpdated: (v: string | null) => void;
  showListMembershipOption?: boolean;
}

export function ObjectiveFilterPanel({
  orgObjectives,
  orgPeriods,
  orgTeams,
  orgTags,
  orgUsers,
  searchQuery,
  setSearchQuery,
  includeAncestorPeriods,
  setIncludeAncestorPeriods,
  includeChildPeriods,
  setIncludeChildPeriods,
  includeChildTeams,
  setIncludeChildTeams,
  showChildren,
  setShowChildren,
  directChildrenOnly,
  setDirectChildrenOnly,
  filterLastUpdated,
  setFilterLastUpdated,
  showListMembershipOption = false,
}: ObjectiveFilterPanelProps) {
  const [isFilterExpanded, setIsFilterExpanded] = useState(true);

  const filterPeriodIds = useOKRStore((state: OKRStore) => state.filterPeriodIds);
  const filterTagIds = useOKRStore((state: OKRStore) => state.filterTagIds);
  const filterTeamIds = useOKRStore((state: OKRStore) => state.filterTeamIds);
  const filterOwnerIds = useOKRStore((state: OKRStore) => state.filterOwnerIds);
  const filterOwnerOperator = useOKRStore((state: OKRStore) => state.filterOwnerOperator);
  const filterAssigneeIds = useOKRStore((state: OKRStore) => state.filterAssigneeIds);
  const filterAssigneeOperator = useOKRStore((state: OKRStore) => state.filterAssigneeOperator);
  const toggleFilterPeriod = useOKRStore((state: OKRStore) => state.toggleFilterPeriod);
  const toggleFilterTag = useOKRStore((state: OKRStore) => state.toggleFilterTag);
  const toggleFilterTeam = useOKRStore((state: OKRStore) => state.toggleFilterTeam);
  const filterTypes = useOKRStore((state: OKRStore) => state.filterTypes);
  const filterTypeNotSet = useOKRStore((state: OKRStore) => state.filterTypeNotSet);
  const toggleFilterType = useOKRStore((state: OKRStore) => state.toggleFilterType);
  const toggleFilterTypeNotSet = useOKRStore((state: OKRStore) => state.toggleFilterTypeNotSet);
  const setFilterOwners = useOKRStore((state: OKRStore) => state.setFilterOwners);
  const setFilterOwnerOperator = useOKRStore((state: OKRStore) => state.setFilterOwnerOperator);
  const setFilterAssignees = useOKRStore((state: OKRStore) => state.setFilterAssignees);
  const setFilterAssigneeOperator = useOKRStore((state: OKRStore) => state.setFilterAssigneeOperator);
  const filterAssigneeNotSet = useOKRStore((state: OKRStore) => state.filterAssigneeNotSet);
  const toggleFilterAssigneeNotSet = useOKRStore((state: OKRStore) => state.toggleFilterAssigneeNotSet);
  const filterNextStepDate = useOKRStore((state: OKRStore) => state.filterNextStepDate);
  const setFilterNextStepDate = useOKRStore((state: OKRStore) => state.setFilterNextStepDate);
  const filterLevels = useOKRStore((state: OKRStore) => state.filterLevels);
  const toggleFilterLevel = useOKRStore((state: OKRStore) => state.toggleFilterLevel);
  const filterWorkflowStatuses = useOKRStore((state: OKRStore) => state.filterWorkflowStatuses);
  const toggleFilterWorkflowStatus = useOKRStore((state: OKRStore) => state.toggleFilterWorkflowStatus);
  const filterKeyResultsOnly = useOKRStore((state: OKRStore) => state.filterKeyResultsOnly);
  const toggleFilterKeyResultsOnly = useOKRStore((state: OKRStore) => state.toggleFilterKeyResultsOnly);
  const filterObjectiveId = useOKRStore((state: OKRStore) => state.filterObjectiveId);
  const setFilterObjective = useOKRStore((state: OKRStore) => state.setFilterObjective);
  const filterRootObjectiveId = useOKRStore((state: OKRStore) => state.filterRootObjectiveId);
  const setFilterRootObjective = useOKRStore((state: OKRStore) => state.setFilterRootObjective);
  const showListMembership = useOKRStore((state: OKRStore) => state.showListMembership);
  const setShowListMembership = useOKRStore((state: OKRStore) => state.setShowListMembership);
  const listMembershipListId = useOKRStore((state: OKRStore) => state.listMembershipListId);
  const setListMembershipListId = useOKRStore((state: OKRStore) => state.setListMembershipListId);
  const lists = useOKRStore((state: OKRStore) => state.lists);
  const filterListIds = useOKRStore((state: OKRStore) => state.filterListIds);
  const toggleFilterList = useOKRStore((state: OKRStore) => state.toggleFilterList);
  const clearFilterLists = useOKRStore((state: OKRStore) => state.clearFilterLists);
  const clearAllFilters = useOKRStore((state: OKRStore) => state.clearAllFilters);
  const openChildrenOnly = useOKRStore((state: OKRStore) => state.openChildrenOnly);
  const setOpenChildrenOnly = useOKRStore((state: OKRStore) => state.setOpenChildrenOnly);

  const [objectiveSearch, setObjectiveSearch] = useState('');
  const [showObjectiveDropdown, setShowObjectiveDropdown] = useState(false);
  const objectiveDropdownRef = useRef<HTMLDivElement>(null);
  const objectiveSearchRef = useRef<HTMLInputElement>(null);

  const [rootObjectiveSearch, setRootObjectiveSearch] = useState('');
  const [showRootObjectiveDropdown, setShowRootObjectiveDropdown] = useState(false);
  const rootObjectiveDropdownRef = useRef<HTMLDivElement>(null);
  const rootObjectiveSearchRef = useRef<HTMLInputElement>(null);

  const [showListDropdown, setShowListDropdown] = useState(false);
  const listDropdownRef = useRef<HTMLDivElement>(null);

  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
  const periodDropdownRef = useRef<HTMLDivElement>(null);
  const [showTeamDropdown, setShowTeamDropdown] = useState(false);
  const teamDropdownRef = useRef<HTMLDivElement>(null);
  const [showOwnerDropdown, setShowOwnerDropdown] = useState(false);
  const ownerDropdownRef = useRef<HTMLDivElement>(null);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (objectiveDropdownRef.current && !objectiveDropdownRef.current.contains(event.target as Node)) {
        setShowObjectiveDropdown(false);
        setObjectiveSearch('');
      }
      if (rootObjectiveDropdownRef.current && !rootObjectiveDropdownRef.current.contains(event.target as Node)) {
        setShowRootObjectiveDropdown(false);
        setRootObjectiveSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (listDropdownRef.current && !listDropdownRef.current.contains(event.target as Node)) {
        setShowListDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (periodDropdownRef.current && !periodDropdownRef.current.contains(event.target as Node)) setShowPeriodDropdown(false);
      if (teamDropdownRef.current && !teamDropdownRef.current.contains(event.target as Node)) setShowTeamDropdown(false);
      if (ownerDropdownRef.current && !ownerDropdownRef.current.contains(event.target as Node)) setShowOwnerDropdown(false);
      if (assigneeDropdownRef.current && !assigneeDropdownRef.current.contains(event.target as Node)) setShowAssigneeDropdown(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasActiveFilters = filterPeriodIds.length > 0 || filterTagIds.length > 0 || filterTeamIds.length > 0 || filterTypes.length > 0 || filterTypeNotSet || filterOwnerIds.length > 0 || filterAssigneeIds.length > 0 || filterAssigneeNotSet || filterNextStepDate || filterLastUpdated || filterLevels.length > 0 || filterWorkflowStatuses.length > 0 || filterKeyResultsOnly || filterObjectiveId || filterRootObjectiveId || filterListIds.length > 0 || openChildrenOnly || searchQuery.trim();

  return (
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
          {hasActiveFilters && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearAllFilters();
                setSearchQuery('');
              }}
              className="text-xs text-blue-600 hover:text-blue-700"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {isFilterExpanded && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-4">
          <div className="flex gap-6">
            {/* Column 1 - 50%: Period, Team, Owner, Assignee */}
            <div className="flex-[2] space-y-3 min-w-0">
              {/* Period Filter */}
              <div className="flex items-start gap-3">
                <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Period</label>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {filterPeriodIds.map(pid => {
                      const period = orgPeriods.find((p: Period) => p.id === pid);
                      return period ? (
                        <span key={pid} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-800 text-white rounded-full text-xs">
                          {period.name}
                          <button onClick={() => toggleFilterPeriod(pid)} className="hover:text-gray-300 ml-0.5">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </span>
                      ) : null;
                    })}
                    <div className="relative" ref={periodDropdownRef}>
                      <button
                        onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
                        className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                      >
                        + Add
                      </button>
                      {showPeriodDropdown && (
                        <div className="absolute z-50 mt-1 bg-white border border-gray-300 rounded-md shadow-lg min-w-[180px] max-h-64 overflow-y-auto">
                          {orgPeriods.filter((p: Period) => !filterPeriodIds.includes(p.id)).length === 0 ? (
                            <div className="text-xs text-gray-400 px-3 py-2">All periods selected</div>
                          ) : orgPeriods.filter((p: Period) => !filterPeriodIds.includes(p.id)).map((period: Period) => (
                            <button
                              key={period.id}
                              onClick={() => { toggleFilterPeriod(period.id); setShowPeriodDropdown(false); }}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 truncate"
                            >
                              {period.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {filterPeriodIds.length > 0 && (
                    <div className="flex items-center gap-3 mt-1.5">
                      <label className="inline-flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeAncestorPeriods}
                          onChange={(e) => setIncludeAncestorPeriods(e.target.checked)}
                          className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        Parent
                      </label>
                      <label className="inline-flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeChildPeriods}
                          onChange={(e) => setIncludeChildPeriods(e.target.checked)}
                          className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        Child
                      </label>
                    </div>
                  )}
                </div>
              </div>

              {/* Team Filter */}
              {orgTeams.length > 0 && (
                <div className="flex items-start gap-3">
                  <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Team</label>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {filterTeamIds.map(tid => {
                        const team = orgTeams.find((t: Team) => t.id === tid);
                        return team ? (
                          <span key={tid} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-800 text-white rounded-full text-xs">
                            {team.name}
                            <button onClick={() => toggleFilterTeam(tid)} className="hover:text-gray-300 ml-0.5">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </span>
                        ) : null;
                      })}
                      <div className="relative" ref={teamDropdownRef}>
                        <button
                          onClick={() => setShowTeamDropdown(!showTeamDropdown)}
                          className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                        >
                          + Add
                        </button>
                        {showTeamDropdown && (
                          <div className="absolute z-50 mt-1 bg-white border border-gray-300 rounded-md shadow-lg min-w-[180px] max-h-64 overflow-y-auto">
                            {orgTeams.filter((t: Team) => !filterTeamIds.includes(t.id)).length === 0 ? (
                              <div className="text-xs text-gray-400 px-3 py-2">All teams selected</div>
                            ) : orgTeams.filter((t: Team) => !filterTeamIds.includes(t.id)).map((team: Team) => (
                              <button
                                key={team.id}
                                onClick={() => { toggleFilterTeam(team.id); setShowTeamDropdown(false); }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 truncate"
                              >
                                {team.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {filterTeamIds.length > 0 && (
                      <label className="inline-flex items-center gap-1 text-xs text-gray-500 cursor-pointer mt-1.5">
                        <input
                          type="checkbox"
                          checked={includeChildTeams}
                          onChange={(e) => setIncludeChildTeams(e.target.checked)}
                          className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        Include child teams
                      </label>
                    )}
                  </div>
                </div>
              )}

              {/* Owner Filter */}
              {orgUsers.length > 0 && (
                <div className="flex items-start gap-3">
                  <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Owner</label>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        value={filterOwnerOperator}
                        onChange={(e) => setFilterOwnerOperator(e.target.value as FilterOperator)}
                        className="px-1.5 py-1 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="equals">=</option>
                        <option value="not_equals">!=</option>
                      </select>
                      {filterOwnerIds.map(uid => {
                        const u = orgUsers.find((u: User) => u.id === uid);
                        return u ? (
                          <span key={uid} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-800 text-white rounded-full text-xs">
                            {u.name}
                            <button onClick={() => setFilterOwners(filterOwnerIds.filter(id => id !== uid))} className="hover:text-gray-300 ml-0.5">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </span>
                        ) : null;
                      })}
                      <div className="relative" ref={ownerDropdownRef}>
                        <button
                          onClick={() => setShowOwnerDropdown(!showOwnerDropdown)}
                          className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                        >
                          + Add
                        </button>
                        {showOwnerDropdown && (
                          <div className="absolute z-50 mt-1 bg-white border border-gray-300 rounded-md shadow-lg min-w-[160px] max-h-64 overflow-y-auto">
                            {orgUsers.filter((u: User) => !filterOwnerIds.includes(u.id)).length === 0 ? (
                              <div className="text-xs text-gray-400 px-3 py-2">All users selected</div>
                            ) : orgUsers.filter((u: User) => !filterOwnerIds.includes(u.id)).map((u: User) => (
                              <button
                                key={u.id}
                                onClick={() => { setFilterOwners([...filterOwnerIds, u.id]); setShowOwnerDropdown(false); }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 truncate"
                              >
                                {u.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Assignee Filter */}
              {orgUsers.length > 0 && (
                <div className="flex items-start gap-3">
                  <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Assignee</label>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        value={filterAssigneeOperator}
                        onChange={(e) => setFilterAssigneeOperator(e.target.value as FilterOperator)}
                        className="px-1.5 py-1 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="equals">=</option>
                        <option value="not_equals">!=</option>
                      </select>
                      {filterAssigneeIds.map(uid => {
                        const u = orgUsers.find((u: User) => u.id === uid);
                        return u ? (
                          <span key={uid} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-800 text-white rounded-full text-xs">
                            {u.name}
                            <button onClick={() => setFilterAssignees(filterAssigneeIds.filter(id => id !== uid))} className="hover:text-gray-300 ml-0.5">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </span>
                        ) : null;
                      })}
                      {filterAssigneeNotSet && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-800 text-white rounded-full text-xs">
                          Not Set
                          <button onClick={() => toggleFilterAssigneeNotSet()} className="hover:text-gray-300 ml-0.5">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </span>
                      )}
                      <div className="relative" ref={assigneeDropdownRef}>
                        <button
                          onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
                          className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                        >
                          + Add
                        </button>
                        {showAssigneeDropdown && (
                          <div className="absolute z-50 mt-1 bg-white border border-gray-300 rounded-md shadow-lg min-w-[160px] max-h-64 overflow-y-auto">
                            {!filterAssigneeNotSet && (
                              <button
                                onClick={() => { toggleFilterAssigneeNotSet(); setShowAssigneeDropdown(false); }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 italic text-gray-500"
                              >
                                Not Set
                              </button>
                            )}
                            {orgUsers.filter((u: User) => !filterAssigneeIds.includes(u.id)).map((u: User) => (
                              <button
                                key={u.id}
                                onClick={() => { setFilterAssignees([...filterAssigneeIds, u.id]); setShowAssigneeDropdown(false); }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 truncate"
                              >
                                {u.name}
                              </button>
                            ))}
                            {orgUsers.filter((u: User) => !filterAssigneeIds.includes(u.id)).length === 0 && filterAssigneeNotSet && (
                              <div className="text-xs text-gray-400 px-3 py-2">All options selected</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Column 2 - 25%: Tags, Type, Level, Status */}
            <div className="flex-1 space-y-3 min-w-0">
              {/* Tag Filter */}
              {orgTags.length > 0 && (
                <div className="flex items-start gap-3">
                  <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Tags</label>
                  <div className="flex flex-wrap gap-1.5">
                    {orgTags.map((tag: Tag) => (
                      <button
                        key={tag.id}
                        onClick={() => toggleFilterTag(tag.id)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors ${
                          filterTagIds.includes(tag.id)
                            ? 'bg-gray-800 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${tag.color}`}></span>
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Type Filter */}
              <div className="flex items-start gap-3">
                <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Type</label>
                <div className="flex flex-wrap gap-1.5">
                  {TYPE_OPTIONS.map((type) => (
                    <button
                      key={type.value}
                      onClick={() => toggleFilterType(type.value)}
                      className={`px-2 py-1 rounded-full text-xs transition-colors ${
                        filterTypes.includes(type.value)
                          ? 'bg-gray-800 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                  <button
                    onClick={() => toggleFilterTypeNotSet()}
                    className={`px-2 py-1 rounded-full text-xs transition-colors ${
                      filterTypeNotSet
                        ? 'bg-gray-800 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Not Set
                  </button>
                </div>
              </div>

              {/* Level Filter */}
              <div className="flex items-start gap-3">
                <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Level</label>
                <div className="flex flex-wrap gap-1.5">
                  {LEVEL_OPTIONS.map((level) => (
                    <button
                      key={level.value}
                      onClick={() => toggleFilterLevel(level.value)}
                      className={`px-2 py-1 rounded-full text-xs transition-colors ${
                        filterLevels.includes(level.value)
                          ? 'bg-gray-800 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {level.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Workflow Status Filter */}
              <div className="flex items-start gap-3">
                <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Status</label>
                <div className="flex flex-wrap gap-1.5">
                  {WORKFLOW_STATUS_OPTIONS.map((status) => (
                    <button
                      key={status.value}
                      onClick={() => toggleFilterWorkflowStatus(status.value)}
                      className={`px-2 py-1 rounded-full text-xs transition-colors ${
                        filterWorkflowStatuses.includes(status.value)
                          ? 'bg-gray-800 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {status.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Column 3 - 25%: Key Results, Next Date, Updated, Parent, List */}
            <div className="flex-1 space-y-3 min-w-0">
              {/* Key Results Only Filter */}
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0">Key Results</label>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterKeyResultsOnly}
                    onChange={() => toggleFilterKeyResultsOnly()}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Show only Key Results
                </label>
              </div>

              {/* Next Step Date Filter */}
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0">Next Date</label>
                <select
                  value={filterNextStepDate || ''}
                  onChange={(e) => setFilterNextStepDate(e.target.value as NextStepDateFilter || null)}
                  className="px-2 py-1 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">All</option>
                  {NEXT_STEP_DATE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Last Updated Filter */}
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0">Updated</label>
                <select
                  value={filterLastUpdated || ''}
                  onChange={(e) => setFilterLastUpdated(e.target.value || null)}
                  className="px-2 py-1 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">All</option>
                  {LAST_UPDATED_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Parent Objective Filter */}
              <div className="flex items-start gap-3">
                <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Parent</label>
                <div className="relative flex-1 min-w-0" ref={objectiveDropdownRef}>
                  {filterObjectiveId ? (
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-1 bg-gray-800 text-white rounded-full text-xs truncate max-w-xs">
                        {orgObjectives.find((o: Objective) => o.id === filterObjectiveId)?.title || 'Unknown'}
                      </span>
                      <button
                        onClick={() => setFilterObjective(null)}
                        className="text-gray-400 hover:text-gray-600"
                        title="Clear filter"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setShowObjectiveDropdown(!showObjectiveDropdown);
                          setTimeout(() => objectiveSearchRef.current?.focus(), 0);
                        }}
                        className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                      >
                        Select objective...
                      </button>
                      {showObjectiveDropdown && (
                        <div className="absolute z-50 mt-1 w-72 bg-white border border-gray-300 rounded-lg shadow-lg">
                          <div className="p-2 border-b border-gray-200">
                            <input
                              ref={objectiveSearchRef}
                              type="text"
                              value={objectiveSearch}
                              onChange={(e) => setObjectiveSearch(e.target.value)}
                              placeholder="Search objectives..."
                              className="w-full text-xs px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  setShowObjectiveDropdown(false);
                                  setObjectiveSearch('');
                                }
                              }}
                            />
                          </div>
                          <div className="max-h-64 overflow-y-auto">
                            {orgObjectives
                              .filter((o: Objective) =>
                                objectiveSearch.trim()
                                  ? o.title.toLowerCase().includes(objectiveSearch.toLowerCase())
                                  : true
                              )
                              .slice(0, 50)
                              .map((o: Objective) => (
                                <button
                                  key={o.id}
                                  onClick={() => {
                                    setFilterObjective(o.id);
                                    setShowObjectiveDropdown(false);
                                    setObjectiveSearch('');
                                  }}
                                  className="w-full text-left text-xs px-3 py-2 hover:bg-gray-100 truncate"
                                  title={o.title}
                                >
                                  {o.title}
                                </button>
                              ))}
                            {orgObjectives.filter((o: Objective) =>
                              objectiveSearch.trim()
                                ? o.title.toLowerCase().includes(objectiveSearch.toLowerCase())
                                : true
                            ).length === 0 && (
                              <div className="text-xs text-gray-400 px-3 py-2">No objectives found</div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Root Objective Filter */}
              <div className="flex items-start gap-3">
                <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0 pt-1.5">Root</label>
                <div className="relative flex-1 min-w-0" ref={rootObjectiveDropdownRef}>
                  {filterRootObjectiveId ? (
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-1 bg-gray-800 text-white rounded-full text-xs truncate max-w-xs">
                        {orgObjectives.find((o: Objective) => o.id === filterRootObjectiveId)?.title || 'Unknown'}
                      </span>
                      <button
                        onClick={() => setFilterRootObjective(null)}
                        className="text-gray-400 hover:text-gray-600"
                        title="Clear filter"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setShowRootObjectiveDropdown(!showRootObjectiveDropdown);
                          setTimeout(() => rootObjectiveSearchRef.current?.focus(), 0);
                        }}
                        className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                      >
                        Select root...
                      </button>
                      {showRootObjectiveDropdown && (
                        <div className="absolute z-50 mt-1 w-72 bg-white border border-gray-300 rounded-lg shadow-lg">
                          <div className="p-2 border-b border-gray-200">
                            <input
                              ref={rootObjectiveSearchRef}
                              type="text"
                              value={rootObjectiveSearch}
                              onChange={(e) => setRootObjectiveSearch(e.target.value)}
                              placeholder="Search objectives..."
                              className="w-full text-xs px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  setShowRootObjectiveDropdown(false);
                                  setRootObjectiveSearch('');
                                }
                              }}
                            />
                          </div>
                          <div className="max-h-64 overflow-y-auto">
                            {orgObjectives
                              .filter((o: Objective) =>
                                rootObjectiveSearch.trim()
                                  ? o.title.toLowerCase().includes(rootObjectiveSearch.toLowerCase())
                                  : true
                              )
                              .slice(0, 50)
                              .map((o: Objective) => (
                                <button
                                  key={o.id}
                                  onClick={() => {
                                    setFilterRootObjective(o.id);
                                    setShowRootObjectiveDropdown(false);
                                    setRootObjectiveSearch('');
                                  }}
                                  className="w-full text-left text-xs px-3 py-2 hover:bg-gray-100 truncate"
                                  title={o.title}
                                >
                                  {o.title}
                                </button>
                              ))}
                            {orgObjectives.filter((o: Objective) =>
                              rootObjectiveSearch.trim()
                                ? o.title.toLowerCase().includes(rootObjectiveSearch.toLowerCase())
                                : true
                            ).length === 0 && (
                              <div className="text-xs text-gray-400 px-3 py-2">No objectives found</div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* List Filter */}
              {lists.length > 0 && (
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-gray-500 w-20 flex-shrink-0">List</label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="relative" ref={listDropdownRef}>
                      <button
                        onClick={() => setShowListDropdown(!showListDropdown)}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        {filterListIds.length > 0 ? (
                          <>
                            <div className="flex items-center gap-0.5">
                              {filterListIds.slice(0, 3).map(listId => {
                                const list = lists.find(l => l.id === listId);
                                return list ? (
                                  <span
                                    key={listId}
                                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                    style={{ backgroundColor: list.color || '#6b7280' }}
                                    title={list.name}
                                  />
                                ) : null;
                              })}
                              {filterListIds.length > 3 && (
                                <span className="text-gray-400 text-xs">+{filterListIds.length - 3}</span>
                              )}
                            </div>
                            <span>{filterListIds.length} selected</span>
                          </>
                        ) : (
                          <span>All</span>
                        )}
                        <svg className="w-3 h-3 text-gray-400 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {showListDropdown && (
                        <div className="absolute z-50 mt-1 bg-white border border-gray-300 rounded-md shadow-lg min-w-[180px]">
                          {lists.map((list: List) => {
                            const isSelected = filterListIds.includes(list.id);
                            return (
                              <button
                                key={list.id}
                                onClick={() => toggleFilterList(list.id)}
                                className={`w-full text-left px-2 py-1.5 text-xs hover:bg-gray-100 flex items-center gap-1.5 ${isSelected ? 'bg-blue-50' : ''}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {}}
                                  className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span
                                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                  style={{ backgroundColor: list.color || '#6b7280' }}
                                />
                                <span className={isSelected ? 'text-blue-700' : ''}>{list.name}</span>
                                <span className="text-gray-400">({list.items.length})</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {filterListIds.length > 0 && (
                      <button
                        onClick={() => clearFilterLists()}
                        className="text-gray-400 hover:text-gray-600"
                        title="Clear filter"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Display Options */}
          {(hasActiveFilters || showListMembershipOption) && (
            <div className="pt-3 border-t border-gray-200">
              <div className="flex items-center gap-4 flex-wrap">
                {hasActiveFilters && (
                  <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showChildren}
                      onChange={(e) => {
                        setShowChildren(e.target.checked);
                        if (e.target.checked) setDirectChildrenOnly(true);
                      }}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Show children of matching objectives
                  </label>
                )}
                {hasActiveFilters && showChildren && (
                  <>
                    <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={directChildrenOnly}
                        onChange={(e) => setDirectChildrenOnly(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      Direct children only
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={openChildrenOnly}
                        onChange={(e) => setOpenChildrenOnly(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      Only show open children
                    </label>
                  </>
                )}
                {showListMembershipOption && (
                  <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showListMembership}
                      onChange={(e) => setShowListMembership(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Show list membership
                  </label>
                )}
                {showListMembershipOption && showListMembership && lists.length > 0 && (
                  <select
                    value={listMembershipListId || ''}
                    onChange={(e) => setListMembershipListId(e.target.value || null)}
                    className="px-2 py-1 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">All lists</option>
                    {lists.map(list => (
                      <option key={list.id} value={list.id}>{list.name}</option>
                    ))}
                  </select>
                )}
                {showListMembershipOption && showListMembership && listMembershipListId && (
                  <span
                    className="w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: lists.find(l => l.id === listMembershipListId)?.color || '#6b7280' }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
