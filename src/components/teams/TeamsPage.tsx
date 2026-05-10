import { useMemo, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { Modal, Button } from '../common';
import type { Team } from '../../types';

interface TeamRowProps {
  team: Team;
  teams: Team[];
  depth: number;
  isAdmin: boolean;
  onAddChild: (parentId: string) => void;
  onRename: (team: Team) => void;
  onDelete: (id: string) => void;
}

function TeamRow({ team, teams, depth, isAdmin, onAddChild, onRename, onDelete }: TeamRowProps) {
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
              onClick={() => onRename(team)}
              className="text-gray-400 hover:text-blue-600 p-1"
              title="Rename"
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
              onAddChild={onAddChild}
              onRename={onRename}
              onDelete={onDelete}
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

  const [renameTarget, setRenameTarget] = useState<Team | null>(null);
  const [renameValue, setRenameValue] = useState('');

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

  const openRename = (team: Team) => {
    setRenameTarget(team);
    setRenameValue(team.name);
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== renameTarget.name) {
      await updateTeam(renameTarget.id, { name: trimmed });
    }
    setRenameTarget(null);
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
                onAddChild={(pid) => openAdd(pid)}
                onRename={openRename}
                onDelete={handleDelete}
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

      <Modal isOpen={renameTarget !== null} onClose={() => setRenameTarget(null)} title="Rename Team">
        <div className="space-y-4">
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); }}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button onClick={handleRename}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
