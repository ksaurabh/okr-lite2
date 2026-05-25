import { useEffect, useMemo, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { Modal, Button } from '../common';
import type { Team, User } from '../../types';

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

  const [editTarget, setEditTarget] = useState<Team | null>(null);
  const [editName, setEditName] = useState('');
  const [editLeadEmail, setEditLeadEmail] = useState<string>('');
  const [editParentId, setEditParentId] = useState<string>('');
  const [editMemberEmails, setEditMemberEmails] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [orgUsers, setOrgUsers] = useState<User[]>([]);

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

  const openAdd = (parentId?: string) => {
    setParentTeamId(parentId);
    setNewTeamName('');
    setIsPrivate(false);
    setShowAddModal(true);
  };

  const handleAdd = async () => {
    if (!newTeamName.trim()) return;
    await addTeam({ name: newTeamName.trim(), parentId: parentTeamId }, { orgId, userEmail, shared: !isPrivate });
    setShowAddModal(false);
  };

  const openEdit = (team: Team) => {
    setEditTarget(team);
    setEditName(team.name);
    setEditLeadEmail(team.leadEmail || '');
    setEditParentId(team.parentId || '');
    setEditMemberEmails(team.memberEmails || []);
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
    const prevMembers = [...(editTarget.memberEmails || [])].sort();
    const nextMembers = [...editMemberEmails].sort();
    if (prevMembers.length !== nextMembers.length || prevMembers.some((e, i) => e !== nextMembers[i])) {
      updates.memberEmails = editMemberEmails;
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
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">All Teams</h2>
            <p className="text-sm text-gray-500 mt-1">
              {orgTeams.length} {orgTeams.length === 1 ? 'team' : 'teams'} total
            </p>
          </div>
          {isAdmin && (
            <Button onClick={() => openAdd()}>+ Add Team</Button>
          )}
        </div>

        {rootTeams.length === 0 ? (
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
        )}
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
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={handleEditSave}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
