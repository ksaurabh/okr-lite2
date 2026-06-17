import { useEffect, useMemo, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { Modal, Button } from '../common';
import type { Team, User, TeamAssignment } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';

interface TeamRowProps {
  team: Team;
  teams: Team[];
  depth: number;
  isAdmin: boolean;
  leadName: string | null;
  memberNames: string[];
  onAddChild: (parentId: string) => void;
  onEdit: (team: Team) => void;
  onDelete: (id: string) => void;
  getLeadName: (email?: string) => string | null;
  getMemberNames: (emails?: string[]) => string[];
}

function TeamRow({ team, teams, depth, isAdmin, leadName, memberNames, onAddChild, onEdit, onDelete, getLeadName, getMemberNames }: TeamRowProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const childTeams = teams.filter(t => t.parentId === team.id).sort((a, b) => a.name.localeCompare(b.name));
  const hasChildren = childTeams.length > 0;

  return (
    <div>
      <div
        className="group flex items-center justify-between py-2 px-3 hover:bg-gray-50 border-b border-gray-100"
        style={{ paddingLeft: `${12 + depth * 20}px` }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {hasChildren ? (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-400 hover:text-gray-600 flex-shrink-0"
            >
              <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}
          <span className="text-sm text-gray-900 truncate">{team.name}</span>
          {leadName && (
            <span className="text-xs text-gray-500 truncate">· Lead: {leadName}</span>
          )}
          {memberNames.length > 0 && (
            <span className="text-xs text-gray-500 truncate" title={memberNames.join(', ')}>· {memberNames.length} {memberNames.length === 1 ? 'member' : 'members'}: {memberNames.slice(0, 3).join(', ')}{memberNames.length > 3 ? ` +${memberNames.length - 3}` : ''}</span>
          )}
          {team.type === 'self' && (
            <span className="text-[10px] uppercase tracking-wide text-indigo-500 ml-2">individual</span>
          )}
          {team.shared === false && (
            <span className="text-[10px] uppercase tracking-wide text-gray-400 ml-2">private</span>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onAddChild(team.id)}
              className="text-gray-400 hover:text-blue-600 p-1"
              title="Add sub-team"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </button>
            <button
              onClick={() => onEdit(team)}
              className="text-gray-400 hover:text-blue-600 p-1"
              title="Edit team"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={() => onDelete(team.id)}
              className="text-gray-400 hover:text-red-600 p-1"
              title="Delete"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {isExpanded && hasChildren && (
        <div>
          {childTeams.map(child => (
            <TeamRow
              key={child.id}
              team={child}
              teams={teams}
              depth={depth + 1}
              isAdmin={isAdmin}
              leadName={getLeadName(child.leadEmail)}
              memberNames={getMemberNames(child.memberEmails)}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDelete={onDelete}
              getLeadName={getLeadName}
              getMemberNames={getMemberNames}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TeamsPage() {
  const { organization, user, isSuperAdmin, isOrgAdmin } = useAuth();
  const orgId = organization?.id || '';
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;

  const [showAllTeams, setShowAllTeams] = useState(true);
  const [showAssignments, setShowAssignments] = useState(true);
  const [showCapacity, setShowCapacity] = useState(true);
  const [asOfDate, setAsOfDate] = useState<string>(() => new Date().toLocaleDateString('en-CA'));

  const teams = useOKRStore((s: OKRStore) => s.teams);
  const addTeam = useOKRStore((s: OKRStore) => s.addTeam);
  const updateTeam = useOKRStore((s: OKRStore) => s.updateTeam);
  const deleteTeam = useOKRStore((s: OKRStore) => s.deleteTeam);

  const orgTeams = useMemo(
    () => teams.filter(t => (!t.orgId || t.orgId === orgId) && (isAdmin || t.shared !== false || t.createdBy === userEmail)),
    [teams, orgId, userEmail, isAdmin]
  );
  const rootTeams = useMemo(
    () => orgTeams.filter(t => !t.parentId).sort((a, b) => a.name.localeCompare(b.name)),
    [orgTeams]
  );

  const [showAddModal, setShowAddModal] = useState(false);
  const [parentTeamId, setParentTeamId] = useState<string | undefined>(undefined);
  const [newTeamName, setNewTeamName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isSelf, setIsSelf] = useState(false);

  const [editTarget, setEditTarget] = useState<Team | null>(null);
  const [editName, setEditName] = useState('');
  const [editLeadEmail, setEditLeadEmail] = useState<string>('');
  const [editParentId, setEditParentId] = useState<string>('');
  const [editMemberEmails, setEditMemberEmails] = useState<string[]>([]);
  const [editIsSelf, setEditIsSelf] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [orgUsers, setOrgUsers] = useState<User[]>([]);

  // Team Assignments
  const [assignments, setAssignments] = useState<TeamAssignment[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignEditId, setAssignEditId] = useState<string | null>(null);
  const [assignWho, setAssignWho] = useState('');
  const [assignTeamId, setAssignTeamId] = useState('');
  const [assignSelf, setAssignSelf] = useState(false);
  const [assignCapacity, setAssignCapacity] = useState('');
  const [assignStart, setAssignStart] = useState('');
  const [assignEnd, setAssignEnd] = useState('');
  const [assignError, setAssignError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch(`${API_URL}/api/users`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setOrgUsers(data.users || []);
        }
      } catch (err) {
        console.error('Failed to fetch users:', err);
      }
    };
    fetchUsers();
  }, []);

  const getLeadName = (email?: string): string | null => {
    if (!email) return null;
    const u = orgUsers.find(u => u.email === email);
    return u?.name || email;
  };

  const getMemberNames = (emails?: string[]): string[] => {
    if (!emails || emails.length === 0) return [];
    return emails.map(e => orgUsers.find(u => u.email === e)?.name || e);
  };

  const loadAssignments = async () => {
    try {
      const res = await fetch(`${API_URL}/api/assignments`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setAssignments(data.assignments || []);
      }
    } catch (err) {
      console.error('Failed to fetch assignments:', err);
    }
  };

  useEffect(() => { loadAssignments(); }, []);

  const teamName = (id: string): string => orgTeams.find(t => t.id === id)?.name || '(deleted team)';

  // Hierarchical <option> list (indented by depth) for the assignment team picker.
  const visibleTeamIds = useMemo(() => new Set(orgTeams.map(t => t.id)), [orgTeams]);
  const renderTeamOptions = (parentId: string | undefined, depth: number): React.ReactNode[] =>
    orgTeams
      .filter(t => depth === 0 ? (!t.parentId || !visibleTeamIds.has(t.parentId)) : t.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap(t => [
        <option key={t.id} value={t.id}>{`${'  '.repeat(depth)}${depth > 0 ? '↳ ' : ''}${t.name}`}</option>,
        ...renderTeamOptions(t.id, depth + 1),
      ]);
  const fmtDate = (d?: string): string => {
    if (!d) return '—';
    const dt = new Date(`${d}T00:00:00`);
    return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const sortedAssignments = useMemo(
    () => [...assignments].sort((a, b) => {
      const an = getLeadName(a.who) || a.who;
      const bn = getLeadName(b.who) || b.who;
      return an.localeCompare(bn) || (a.startDate || '').localeCompare(b.startDate || '');
    }),
    // getLeadName depends on orgUsers; recompute when either changes
    [assignments, orgUsers] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Total capacity assigned per individual, and that total as a % of a 40 SP/week baseline.
  const CAPACITY_BASELINE = 40;
  const capacityByUser = useMemo(
    () => {
      // Only count assignments active as of the selected date: started on/before
      // it, and not yet ended (open-ended assignments count as active).
      const ref = asOfDate || new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd
      const isActive = (a: TeamAssignment) =>
        (!a.startDate || a.startDate <= ref) && (!a.endDate || a.endDate >= ref);
      const totals = new Map<string, number>();
      for (const a of assignments) {
        if (!isActive(a)) continue;
        totals.set(a.who, (totals.get(a.who) || 0) + (Number(a.capacitySpPerWeek) || 0));
      }
      return Array.from(totals.entries())
        .map(([who, total]) => ({ who, name: getLeadName(who) || who, total, pct: Math.round((total / CAPACITY_BASELINE) * 100) }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    },
    [assignments, orgUsers, asOfDate] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const openAddAssignment = () => {
    setAssignEditId(null);
    setAssignWho(''); setAssignTeamId(''); setAssignSelf(false); setAssignCapacity(''); setAssignStart(''); setAssignEnd('');
    setAssignError(null);
    setShowAssignModal(true);
  };

  const openEditAssignment = (a: TeamAssignment) => {
    setAssignEditId(a.id);
    setAssignWho(a.who);
    setAssignTeamId(a.teamId);
    setAssignSelf(!!a.isSelf);
    setAssignCapacity(a.capacitySpPerWeek != null ? String(a.capacitySpPerWeek) : '');
    setAssignStart(a.startDate || '');
    setAssignEnd(a.endDate || '');
    setAssignError(null);
    setShowAssignModal(true);
  };

  const saveAssignment = async () => {
    setAssignError(null);
    if (!assignWho) { setAssignError('Select who is assigned.'); return; }
    if (!assignSelf && !assignTeamId) { setAssignError('Select a team, or mark this as self capacity.'); return; }
    if (!assignStart) { setAssignError('Start date is required.'); return; }
    if (assignEnd && assignEnd < assignStart) { setAssignError('End date cannot be before the start date.'); return; }
    const body = {
      who: assignWho,
      teamId: assignSelf ? '' : assignTeamId,
      isSelf: assignSelf,
      capacitySpPerWeek: assignCapacity === '' ? 0 : Number(assignCapacity),
      startDate: assignStart,
      endDate: assignEnd || '',
    };
    try {
      const url = assignEditId ? `${API_URL}/api/assignments/${assignEditId}` : `${API_URL}/api/assignments`;
      const res = await fetch(url, {
        method: assignEditId ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(t || `HTTP ${res.status}`); }
      await loadAssignments();
      setShowAssignModal(false);
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : String(err));
    }
  };

  const deleteAssignment = async (id: string) => {
    if (!window.confirm('Delete this assignment?')) return;
    try {
      const res = await fetch(`${API_URL}/api/assignments/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) await loadAssignments();
    } catch (err) {
      console.error('Failed to delete assignment:', err);
    }
  };

  const openAdd = (parentId?: string) => {
    setParentTeamId(parentId);
    setNewTeamName('');
    setIsPrivate(false);
    setIsSelf(false);
    setShowAddModal(true);
  };

  const handleAdd = async () => {
    if (!newTeamName.trim()) return;
    await addTeam({ name: newTeamName.trim(), parentId: parentTeamId, type: isSelf ? 'self' : undefined }, { orgId, userEmail, shared: !isPrivate });
    setShowAddModal(false);
  };

  const openEdit = (team: Team) => {
    setEditTarget(team);
    setEditName(team.name);
    setEditLeadEmail(team.leadEmail || '');
    setEditParentId(team.parentId || '');
    setEditMemberEmails(team.memberEmails || []);
    setEditIsSelf(team.type === 'self');
    setMemberSearch('');
  };

  const validParentOptions = useMemo(() => {
    if (!editTarget) return orgTeams;
    const descendantIds = new Set<string>();
    const collect = (id: string) => {
      orgTeams.forEach(t => {
        if (t.parentId === id && !descendantIds.has(t.id)) {
          descendantIds.add(t.id);
          collect(t.id);
        }
      });
    };
    collect(editTarget.id);
    return orgTeams
      .filter(t => t.id !== editTarget.id && !descendantIds.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [orgTeams, editTarget]);

  const handleEditSave = async () => {
    if (!editTarget) return;
    const trimmedName = editName.trim();
    const updates: Partial<Team> = {};
    if (trimmedName && trimmedName !== editTarget.name) updates.name = trimmedName;
    const newLead = editLeadEmail || undefined;
    if (newLead !== editTarget.leadEmail) updates.leadEmail = newLead;
    const newParent = editParentId || undefined;
    if (newParent !== editTarget.parentId) updates.parentId = newParent;
    const prevIsSelf = editTarget.type === 'self';
    if (editIsSelf !== prevIsSelf) updates.type = editIsSelf ? 'self' : 'standard';
    if (editIsSelf) {
      // Self (individual contributor) teams cannot have other members.
      if ((editTarget.memberEmails || []).length > 0) updates.memberEmails = [];
    } else {
      const prevMembers = [...(editTarget.memberEmails || [])].sort();
      const nextMembers = [...editMemberEmails].sort();
      if (prevMembers.length !== nextMembers.length || prevMembers.some((e, i) => e !== nextMembers[i])) {
        updates.memberEmails = editMemberEmails;
      }
    }
    if (Object.keys(updates).length > 0) {
      await updateTeam(editTarget.id, updates);
    }
    setEditTarget(null);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Delete this team? Sub-teams will also be removed.')) {
      await deleteTeam(id);
    }
  };

  const parentName = parentTeamId ? teams.find(t => t.id === parentTeamId)?.name : null;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className={`p-4 ${showAllTeams ? 'border-b border-gray-200' : ''} flex items-center justify-between`}>
          <button onClick={() => setShowAllTeams(v => !v)} className="flex items-center gap-2 text-left">
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${showAllTeams ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">All Teams</h2>
              <p className="text-sm text-gray-500 mt-1">
                {orgTeams.length} {orgTeams.length === 1 ? 'team' : 'teams'} total
              </p>
            </div>
          </button>
          {isAdmin && (
            <Button onClick={() => openAdd()}>+ Add Team</Button>
          )}
        </div>

        {showAllTeams && (rootTeams.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No teams yet. {isAdmin ? 'Click "Add Team" to create one.' : 'Ask an admin to add one.'}
          </div>
        ) : (
          <div>
            {rootTeams.map(team => (
              <TeamRow
                key={team.id}
                team={team}
                teams={orgTeams}
                depth={0}
                isAdmin={isAdmin}
                leadName={getLeadName(team.leadEmail)}
                memberNames={getMemberNames(team.memberEmails)}
                onAddChild={(pid) => openAdd(pid)}
                onEdit={openEdit}
                onDelete={handleDelete}
                getLeadName={getLeadName}
                getMemberNames={getMemberNames}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Team Assignments */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className={`p-4 ${showAssignments ? 'border-b border-gray-200' : ''} flex items-center justify-between`}>
          <button onClick={() => setShowAssignments(v => !v)} className="flex items-center gap-2 text-left">
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${showAssignments ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Team Assignments</h2>
              <p className="text-sm text-gray-500 mt-1">
                {assignments.length} {assignments.length === 1 ? 'assignment' : 'assignments'}
              </p>
            </div>
          </button>
          {isAdmin && (
            <Button onClick={openAddAssignment}>+ Add Assignment</Button>
          )}
        </div>

        {showAssignments && (sortedAssignments.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No assignments yet. {isAdmin ? 'Click "Add Assignment" to create one.' : 'Ask an admin to add one.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200">
                  <th className="py-2 px-4">Who</th>
                  <th className="py-2 px-4">Team</th>
                  <th className="py-2 px-4 whitespace-nowrap">Capacity (SP/week)</th>
                  <th className="py-2 px-4">Start</th>
                  <th className="py-2 px-4">End</th>
                  {isAdmin && <th className="py-2 px-4 w-px"></th>}
                </tr>
              </thead>
              <tbody>
                {sortedAssignments.map(a => (
                  <tr key={a.id} className="group border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-4 text-gray-900">{getLeadName(a.who) || a.who}</td>
                    <td className="py-2 px-4 text-gray-700">
                      {a.isSelf
                        ? <span className="inline-flex items-center px-2 py-0.5 text-xs rounded bg-indigo-50 border border-indigo-200 text-indigo-700">Self (individual)</span>
                        : teamName(a.teamId)}
                    </td>
                    <td className="py-2 px-4 text-gray-700">{a.capacitySpPerWeek}</td>
                    <td className="py-2 px-4 text-gray-700 whitespace-nowrap">{fmtDate(a.startDate)}</td>
                    <td className="py-2 px-4 text-gray-500 whitespace-nowrap">{fmtDate(a.endDate)}</td>
                    {isAdmin && (
                      <td className="py-2 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEditAssignment(a)} className="text-gray-400 hover:text-blue-600 p-1" title="Edit assignment">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button onClick={() => deleteAssignment(a.id)} className="text-gray-400 hover:text-red-600 p-1" title="Delete assignment">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Capacity Assigned by Individual */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className={`p-4 ${showCapacity ? 'border-b border-gray-200' : ''} flex items-center justify-between gap-3`}>
          <button onClick={() => setShowCapacity(v => !v)} className="flex items-center gap-2 text-left min-w-0">
            <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${showCapacity ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900">Capacity Assigned by Individual</h2>
              <p className="text-sm text-gray-500 mt-1">Total SP/week from assignments active as of the selected date, as a % of {CAPACITY_BASELINE} SP/week</p>
            </div>
          </button>
          <label className="flex items-center gap-2 text-sm text-gray-600 flex-shrink-0">
            As of
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value || new Date().toLocaleDateString('en-CA'))}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
        </div>
        {showCapacity && (capacityByUser.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No assignments yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200">
                  <th className="py-2 px-4">Who</th>
                  <th className="py-2 px-4 whitespace-nowrap">Capacity assigned (SP/week)</th>
                  <th className="py-2 px-4 w-1/2">% of {CAPACITY_BASELINE}</th>
                </tr>
              </thead>
              <tbody>
                {capacityByUser.map(row => {
                  const over = row.pct > 100;
                  return (
                    <tr key={row.who} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-4 text-gray-900">{row.name}</td>
                      <td className="py-2 px-4 text-gray-700">{row.total}</td>
                      <td className="py-2 px-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden max-w-xs">
                            <div className={`h-full ${over ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, row.pct)}%` }} />
                          </div>
                          <span className={`text-xs font-medium ${over ? 'text-red-600' : 'text-gray-600'}`}>{row.pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title={parentTeamId ? 'Add Sub-team' : 'Add Team'}>
        <div className="space-y-4">
          {parentName && (
            <div className="text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded">
              Parent: <span className="font-medium">{parentName}</span>
            </div>
          )}
          <input
            type="text"
            placeholder={parentTeamId ? 'Sub-team name' : 'Team name'}
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Private (only visible to me)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={isSelf}
              onChange={(e) => setIsSelf(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Self (individual contributor) — no other members
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowAddModal(false)}>Cancel</Button>
            <Button onClick={handleAdd}>{parentTeamId ? 'Add Sub-team' : 'Add Team'}</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={editTarget !== null} onClose={() => setEditTarget(null)} title="Edit Team">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Lead / DRI</label>
            <select
              value={editLeadEmail}
              onChange={(e) => setEditLeadEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— None —</option>
              {[...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
                <option key={u.email} value={u.email}>{u.name || u.email}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Parent team</label>
            <select
              value={editParentId}
              onChange={(e) => setEditParentId(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Top-level (no parent) —</option>
              {validParentOptions.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={editIsSelf}
              onChange={(e) => { setEditIsSelf(e.target.checked); if (e.target.checked) setEditMemberEmails([]); }}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Self (individual contributor) — no other members
          </label>
          {editIsSelf ? (
            <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
              Individual contributor — no other members can be assigned to this team.
            </div>
          ) : (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Members ({editMemberEmails.length})</label>
            {editMemberEmails.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {editMemberEmails.map(email => {
                  const u = orgUsers.find(uu => uu.email === email);
                  return (
                    <span key={email} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded">
                      {u?.name || email}
                      <button
                        type="button"
                        onClick={() => setEditMemberEmails(prev => prev.filter(e => e !== email))}
                        className="text-blue-500 hover:text-blue-700"
                        title="Remove"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <input
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search to add a member…"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="mt-1 max-h-40 overflow-y-auto border border-gray-200 rounded-md">
              {[...orgUsers]
                .filter(u => !editMemberEmails.includes(u.email))
                .filter(u => {
                  const q = memberSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (u.name || '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
                })
                .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
                .slice(0, 30)
                .map(u => (
                  <button
                    key={u.email}
                    type="button"
                    onClick={() => { setEditMemberEmails(prev => [...prev, u.email]); setMemberSearch(''); }}
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                  >
                    {u.name || u.email} <span className="text-gray-400 text-xs">{u.email}</span>
                  </button>
                ))}
              {orgUsers.filter(u => !editMemberEmails.includes(u.email)).length === 0 && (
                <div className="px-3 py-2 text-xs text-gray-400">All users are already members.</div>
              )}
            </div>
          </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={handleEditSave}>Save</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showAssignModal} onClose={() => setShowAssignModal(false)} title={assignEditId ? 'Edit Assignment' : 'Add Assignment'}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Who</label>
            <select
              value={assignWho}
              onChange={(e) => setAssignWho(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select a person —</option>
              {[...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
                <option key={u.email} value={u.email}>{u.name || u.email}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={assignSelf}
              onChange={(e) => { setAssignSelf(e.target.checked); if (e.target.checked) setAssignTeamId(''); }}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Self / individual capacity (not tied to a team)
          </label>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Team</label>
            <select
              value={assignTeamId}
              onChange={(e) => setAssignTeamId(e.target.value)}
              disabled={assignSelf}
              className="w-full border border-gray-300 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <option value="">{assignSelf ? '— Self (no team) —' : '— Select a team —'}</option>
              {renderTeamOptions(undefined, 0)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Capacity assigned (SP per week)</label>
            <input
              type="number"
              min="0"
              step="any"
              value={assignCapacity}
              onChange={(e) => setAssignCapacity(e.target.value)}
              placeholder="e.g. 8"
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Start date</label>
              <input
                type="date"
                value={assignStart}
                onChange={(e) => setAssignStart(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">End date <span className="text-gray-400">(optional)</span></label>
              <input
                type="date"
                value={assignEnd}
                min={assignStart || undefined}
                onChange={(e) => setAssignEnd(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          {assignError && <p className="text-sm text-red-600">{assignError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowAssignModal(false)}>Cancel</Button>
            <Button onClick={saveAssignment}>{assignEditId ? 'Save' : 'Add Assignment'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
