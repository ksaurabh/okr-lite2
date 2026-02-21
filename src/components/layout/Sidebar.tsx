import { useState, useMemo } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import type { Period, PeriodType, Team, Tag } from '../../types';

type View = 'dashboard' | 'objectives' | 'checklist' | 'progress' | 'updates' | 'lists' | 'logwork' | 'teams' | 'periods' | 'tags' | 'settings' | 'admin' | 'logs';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface TeamItemProps {
  team: Team;
  teams: Team[];
  onAddChild: (parentId: string) => void;
  onDelete: (id: string) => void;
  depth?: number;
  isAdmin?: boolean;
}

function TeamItem({ team, teams, onAddChild, onDelete, depth = 0, isAdmin = false }: TeamItemProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const childTeams = teams.filter((t: Team) => t.parentId === team.id);
  const hasChildren = childTeams.length > 0;

  return (
    <div>
      <div
        className="flex items-center justify-between px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 rounded"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {hasChildren ? (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-400 hover:text-gray-600 flex-shrink-0"
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
          ) : (
            <span className="w-3" />
          )}
          <span className="truncate">{team.name}</span>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => onAddChild(team.id)}
              className="text-gray-400 hover:text-blue-600 p-0.5"
              title="Add sub-team"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </button>
            <button
              onClick={() => onDelete(team.id)}
              className="text-gray-400 hover:text-red-600 p-0.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {isExpanded && hasChildren && (
        <div>
          {childTeams.map((child: Team) => (
            <TeamItem
              key={child.id}
              team={child}
              teams={teams}
              onAddChild={onAddChild}
              onDelete={onDelete}
              depth={depth + 1}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const TAG_COLORS = [
  { name: 'Gray', value: 'bg-gray-500' },
  { name: 'Red', value: 'bg-red-500' },
  { name: 'Orange', value: 'bg-orange-500' },
  { name: 'Yellow', value: 'bg-yellow-500' },
  { name: 'Green', value: 'bg-green-500' },
  { name: 'Blue', value: 'bg-blue-500' },
  { name: 'Purple', value: 'bg-purple-500' },
  { name: 'Pink', value: 'bg-pink-500' },
];

const PERIOD_TYPE_LABELS: Record<PeriodType, string> = {
  quarter: 'Quarter',
  month: 'Month',
  week: 'Week',
};

const PERIOD_TYPE_ICONS: Record<PeriodType, string> = {
  quarter: 'Q',
  month: 'M',
  week: 'W',
};

interface PeriodItemProps {
  period: Period;
  periods: Period[];
  onAddChild: (parentId: string, childType: PeriodType) => void;
  onDelete: (id: string) => void;
  depth?: number;
  isAdmin?: boolean;
}

function formatPeriodDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function PeriodItem({ period, periods, onAddChild, onDelete, depth = 0, isAdmin = false }: PeriodItemProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const childPeriods = periods.filter((p: Period) => p.parentId === period.id);
  const hasChildren = childPeriods.length > 0;

  const canAddChild = period.type === 'quarter' || period.type === 'month';
  const childType: PeriodType = period.type === 'quarter' ? 'month' : 'week';
  const dateTooltip = `${formatPeriodDate(period.startDate)} - ${formatPeriodDate(period.endDate)}`;

  return (
    <div>
      <div
        className={`flex items-center justify-between px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 rounded`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {hasChildren ? (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-400 hover:text-gray-600 flex-shrink-0"
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
          ) : (
            <span className="w-3" />
          )}
          <span className="text-xs font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
            {PERIOD_TYPE_ICONS[period.type]}
          </span>
          <span className="truncate" title={dateTooltip}>{period.name}</span>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {canAddChild && (
              <button
                onClick={() => onAddChild(period.id, childType)}
                className="text-gray-400 hover:text-blue-600 p-0.5"
                title={`Add ${PERIOD_TYPE_LABELS[childType]}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </button>
            )}
            <button
              onClick={() => onDelete(period.id)}
              className="text-gray-400 hover:text-red-600 p-0.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {isExpanded && hasChildren && (
        <div>
          {childPeriods.map((child: Period) => (
            <PeriodItem
              key={child.id}
              period={child}
              periods={periods}
              onAddChild={onAddChild}
              onDelete={onDelete}
              depth={depth + 1}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ currentView, onViewChange, collapsed = false, onToggleCollapse }: SidebarProps) {
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamParentId, setNewTeamParentId] = useState<string | undefined>(undefined);
  const [newPeriodName, setNewPeriodName] = useState('');
  const [newPeriodType, setNewPeriodType] = useState<PeriodType>('quarter');
  const [newPeriodParentId, setNewPeriodParentId] = useState<string | undefined>(undefined);
  const [newPeriodStart, setNewPeriodStart] = useState('');
  const [newPeriodEnd, setNewPeriodEnd] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('bg-blue-500');
  const [isTeamPrivate, setIsTeamPrivate] = useState(false);
  const [isPeriodPrivate, setIsPeriodPrivate] = useState(false);
  const [isTagPrivate, setIsTagPrivate] = useState(false);

  const { organization, user, isSuperAdmin, isOrgAdmin } = useAuth();
  const orgId = organization?.id || '';
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;

  const teams = useOKRStore((state: OKRStore) => state.teams);
  const periods = useOKRStore((state: OKRStore) => state.periods);
  const tags = useOKRStore((state: OKRStore) => state.tags);
  const addTeam = useOKRStore((state: OKRStore) => state.addTeam);
  const addPeriod = useOKRStore((state: OKRStore) => state.addPeriod);
  const addTag = useOKRStore((state: OKRStore) => state.addTag);
  const deleteTeam = useOKRStore((state: OKRStore) => state.deleteTeam);
  const deletePeriod = useOKRStore((state: OKRStore) => state.deletePeriod);
  const deleteTag = useOKRStore((state: OKRStore) => state.deleteTag);

  // Filter items by organization and visibility (admins see all, others see shared or owned)
  const orgTeams = useMemo(
    () => teams.filter((t: Team) =>
      (!t.orgId || t.orgId === orgId) && (isAdmin || t.shared !== false || t.createdBy === userEmail)
    ),
    [teams, orgId, userEmail, isAdmin]
  );

  const orgPeriods = useMemo(
    () => periods.filter((p: Period) =>
      (!p.orgId || p.orgId === orgId) && (isAdmin || p.shared !== false || p.createdBy === userEmail) && !p.archived
    ),
    [periods, orgId, userEmail, isAdmin]
  );

  const orgTags = useMemo(
    () => tags.filter((t: Tag) =>
      (!t.orgId || t.orgId === orgId) && (isAdmin || t.shared !== false || t.createdBy === userEmail)
    ),
    [tags, orgId, userEmail, isAdmin]
  );

  // Get root periods (quarters with no parent)
  const rootPeriods = useMemo(
    () => orgPeriods.filter((p: Period) => !p.parentId).sort((a: Period, b: Period) => a.startDate.localeCompare(b.startDate)),
    [orgPeriods]
  );

  // Get root teams (teams with no parent)
  const rootTeams = useMemo(
    () => orgTeams.filter((t: Team) => !t.parentId).sort((a: Team, b: Team) => a.name.localeCompare(b.name)),
    [orgTeams]
  );

  const openAddTeamModal = (parentId?: string) => {
    setNewTeamParentId(parentId);
    setNewTeamName('');
    setIsTeamPrivate(false);
    setShowTeamModal(true);
  };

  const handleAddTeam = async () => {
    if (newTeamName.trim()) {
      try {
        await addTeam({ name: newTeamName.trim(), parentId: newTeamParentId }, { orgId, userEmail, shared: !isTeamPrivate });
        setNewTeamName('');
        setNewTeamParentId(undefined);
        setIsTeamPrivate(false);
        setShowTeamModal(false);
      } catch (error) {
        console.error('Failed to add team:', error);
      }
    }
  };

  const getParentTeamName = () => {
    if (!newTeamParentId) return null;
    const parent = teams.find((t: Team) => t.id === newTeamParentId);
    return parent?.name;
  };

  const openAddPeriodModal = (parentId?: string, type: PeriodType = 'quarter') => {
    setNewPeriodParentId(parentId);
    setNewPeriodType(type);
    setNewPeriodName('');
    setNewPeriodStart('');
    setNewPeriodEnd('');
    setIsPeriodPrivate(false);
    setShowPeriodModal(true);
  };

  const handleAddPeriod = async () => {
    if (newPeriodName.trim() && newPeriodStart && newPeriodEnd) {
      try {
        await addPeriod({
          name: newPeriodName.trim(),
          type: newPeriodType,
          parentId: newPeriodParentId,
          startDate: newPeriodStart,
          endDate: newPeriodEnd,
          isActive: false,
        }, { orgId, userEmail, shared: !isPeriodPrivate });
        setNewPeriodName('');
        setNewPeriodStart('');
        setNewPeriodEnd('');
        setNewPeriodParentId(undefined);
        setIsPeriodPrivate(false);
        setShowPeriodModal(false);
      } catch (error) {
        console.error('Failed to add period:', error);
      }
    }
  };

  const handleAddTag = async () => {
    if (newTagName.trim()) {
      try {
        await addTag({ name: newTagName.trim(), color: newTagColor }, { orgId, userEmail, shared: !isTagPrivate });
        setNewTagName('');
        setNewTagColor('bg-blue-500');
        setIsTagPrivate(false);
        setShowTagModal(false);
      } catch (error) {
        console.error('Failed to add tag:', error);
      }
    }
  };

  const openAddTagModal = () => {
    setNewTagName('');
    setNewTagColor('bg-blue-500');
    setIsTagPrivate(false);
    setShowTagModal(true);
  };

  const getParentPeriodName = () => {
    if (!newPeriodParentId) return null;
    const parent = periods.find((p: Period) => p.id === newPeriodParentId);
    return parent?.name;
  };

  const navItems: { id: View; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    { id: 'objectives', label: 'Objectives', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
    { id: 'checklist', label: 'Checklist', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
    { id: 'progress', label: 'Progress', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
    { id: 'updates', label: 'Updates', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
    { id: 'lists', label: 'Lists', icon: 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z' },
    { id: 'logwork', label: 'Log Work', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    { id: 'logs', label: 'Logs', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
    { id: 'teams', label: 'Teams', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
    { id: 'periods', label: 'Periods', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { id: 'tags', label: 'Tags', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
    { id: 'settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
    { id: 'admin', label: 'Super Admin', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  ];

  return (
    <aside className={`${collapsed ? 'w-14' : 'w-64'} bg-gray-50 border-r border-gray-200 min-h-screen transition-all duration-200`}>
      <nav className={collapsed ? 'p-2' : 'p-4'}>
        {/* Collapse toggle button */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className={`w-full flex items-center ${collapsed ? 'justify-center' : 'justify-end'} mb-2 p-1 text-gray-400 hover:text-gray-600`}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {collapsed ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              )}
            </svg>
          </button>
        )}
        <ul className="space-y-1">
          {navItems.filter(item => {
            if (item.id === 'admin') return isSuperAdmin;
            if (item.id === 'settings') return isAdmin;
            return true;
          }).map((item) => (
            <li key={item.id}>
              <button
                onClick={() => onViewChange(item.id)}
                className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-md text-left transition-colors ${
                  currentView === item.id
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-200'
                }`}
                title={collapsed ? item.label : undefined}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                </svg>
                {!collapsed && item.label}
              </button>
            </li>
          ))}
        </ul>

        {!collapsed && currentView === 'teams' && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-500 uppercase">Teams</h3>
              {isAdmin && (
                <button
                  onClick={() => openAddTeamModal()}
                  className="text-blue-600 hover:text-blue-700 text-sm"
                >
                  + Add
                </button>
              )}
            </div>
            <div className="space-y-0.5">
              {rootTeams.map((team: Team) => (
                <TeamItem
                  key={team.id}
                  team={team}
                  teams={orgTeams}
                  onAddChild={openAddTeamModal}
                  onDelete={deleteTeam}
                  isAdmin={isAdmin}
                />
              ))}
              {rootTeams.length === 0 && (
                <p className="text-xs text-gray-400 px-3 py-2">No teams yet. Add a team to get started.</p>
              )}
            </div>
          </div>
        )}

        {!collapsed && currentView === 'periods' && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-500 uppercase">Periods</h3>
              {isAdmin && (
                <button
                  onClick={() => openAddPeriodModal(undefined, 'quarter')}
                  className="text-blue-600 hover:text-blue-700 text-sm"
                >
                  + Quarter
                </button>
              )}
            </div>
            <div className="space-y-0.5">
              {rootPeriods.map((period: Period) => (
                <PeriodItem
                  key={period.id}
                  period={period}
                  periods={orgPeriods}
                  onAddChild={openAddPeriodModal}
                  onDelete={deletePeriod}
                  isAdmin={isAdmin}
                />
              ))}
              {rootPeriods.length === 0 && (
                <p className="text-xs text-gray-400 px-3 py-2">No periods yet. Add a quarter to get started.</p>
              )}
            </div>
          </div>
        )}

        {!collapsed && currentView === 'tags' && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-500 uppercase">Tags</h3>
              {isAdmin && (
                <button
                  onClick={openAddTagModal}
                  className="text-blue-600 hover:text-blue-700 text-sm"
                >
                  + Add
                </button>
              )}
            </div>
            <ul className="space-y-1">
              {orgTags.map((tag: Tag) => (
                <li key={tag.id} className="flex items-center justify-between px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 rounded">
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${tag.color}`}></span>
                    <span>{tag.name}</span>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => deleteTag(tag.id)}
                      className="text-gray-400 hover:text-red-600"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      <Modal
        isOpen={showTeamModal}
        onClose={() => setShowTeamModal(false)}
        title={newTeamParentId ? 'Add Sub-team' : 'Add Team'}
      >
        <div className="space-y-4">
          {newTeamParentId && (
            <div className="text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded">
              Parent: <span className="font-medium">{getParentTeamName()}</span>
            </div>
          )}
          <input
            type="text"
            placeholder={newTeamParentId ? 'Sub-team name' : 'Team name'}
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isTeamPrivate"
              checked={isTeamPrivate}
              onChange={(e) => setIsTeamPrivate(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="isTeamPrivate" className="text-sm text-gray-600">
              Private (only visible to me)
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowTeamModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddTeam}>
              {newTeamParentId ? 'Add Sub-team' : 'Add Team'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showPeriodModal}
        onClose={() => setShowPeriodModal(false)}
        title={`Add ${PERIOD_TYPE_LABELS[newPeriodType]}`}
      >
        <div className="space-y-4">
          {newPeriodParentId && (
            <div className="text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded">
              Parent: <span className="font-medium">{getParentPeriodName()}</span>
            </div>
          )}
          <input
            type="text"
            placeholder={`${PERIOD_TYPE_LABELS[newPeriodType]} name (e.g., ${
              newPeriodType === 'quarter' ? 'Q1 2025' :
              newPeriodType === 'month' ? 'January 2025' :
              'Week 1'
            })`}
            value={newPeriodName}
            onChange={(e) => setNewPeriodName(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Start Date</label>
              <input
                type="date"
                value={newPeriodStart}
                onChange={(e) => setNewPeriodStart(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">End Date</label>
              <input
                type="date"
                value={newPeriodEnd}
                onChange={(e) => setNewPeriodEnd(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isPeriodPrivate"
              checked={isPeriodPrivate}
              onChange={(e) => setIsPeriodPrivate(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="isPeriodPrivate" className="text-sm text-gray-600">
              Private (only visible to me)
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowPeriodModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddPeriod}>Add {PERIOD_TYPE_LABELS[newPeriodType]}</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showTagModal} onClose={() => setShowTagModal(false)} title="Add Tag">
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Tag name"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div>
            <label className="block text-sm text-gray-600 mb-2">Color</label>
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setNewTagColor(color.value)}
                  className={`w-8 h-8 rounded-full ${color.value} ${
                    newTagColor === color.value ? 'ring-2 ring-offset-2 ring-gray-400' : ''
                  }`}
                  title={color.name}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isTagPrivate"
              checked={isTagPrivate}
              onChange={(e) => setIsTagPrivate(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="isTagPrivate" className="text-sm text-gray-600">
              Private (only visible to me)
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowTagModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddTag}>Add Tag</Button>
          </div>
        </div>
      </Modal>
    </aside>
  );
}
