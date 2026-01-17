import { useState, useEffect, useMemo } from 'react';
import type { Objective, ObjectiveLevel, ObjectiveLink, Period, Team, Tag, User, ObjectiveHistoryEntry } from '../../types';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../common/Button';

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const API_URL = import.meta.env.VITE_API_URL || '';

interface ObjectiveFormProps {
  objective?: Objective;
  parentId?: string;
  parentObjective?: Objective;
  defaultLevel?: ObjectiveLevel;
  onClose: () => void;
}

export function ObjectiveForm({ objective, parentId, parentObjective, defaultLevel, onClose }: ObjectiveFormProps) {
  // When creating a child, copy properties from parent
  const [title, setTitle] = useState(objective?.title || '');
  const [description, setDescription] = useState(objective?.description || '');
  const [level, setLevel] = useState<ObjectiveLevel>(
    objective?.level || defaultLevel || 'company'
  );
  const [teamId, setTeamId] = useState(objective?.teamId || parentObjective?.teamId || '');
  const [periodId, setPeriodId] = useState(objective?.periodId || parentObjective?.periodId || '');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(objective?.tagIds || []);
  const [isPrivate, setIsPrivate] = useState(objective?.shared === false);
  const [ownerId, setOwnerId] = useState(objective?.ownerId || parentObjective?.ownerId || '');
  const [assigneeId, setAssigneeId] = useState(objective?.assigneeId || parentObjective?.assigneeId || '');
  const [storyPoints, setStoryPoints] = useState(objective?.storyPoints?.toString() || '');
  const [valuePoints, setValuePoints] = useState(objective?.valuePoints?.toString() || '');
  const [linkUrl, setLinkUrl] = useState(objective?.link?.url || '');
  const [linkDescription, setLinkDescription] = useState(objective?.link?.description || '');
  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const { organization, user, isSuperAdmin, isOrgAdmin } = useAuth();
  const teams = useOKRStore((state: OKRStore) => state.teams);
  const periods = useOKRStore((state: OKRStore) => state.periods);
  const tags = useOKRStore((state: OKRStore) => state.tags);
  const activePeriodId = useOKRStore((state: OKRStore) => state.activePeriodId);
  const addObjective = useOKRStore((state: OKRStore) => state.addObjective);
  const updateObjective = useOKRStore((state: OKRStore) => state.updateObjective);

  const orgId = organization?.id || '';
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;

  // Find current user's ID from orgUsers (for owner/assignee permission checks)
  const currentUserId = useMemo(
    () => orgUsers.find((u: User) => u.email === userEmail)?.id,
    [orgUsers, userEmail]
  );

  // Permission checks for story points and value points
  const canEditStoryPoints = currentUserId === assigneeId;
  const canEditValuePoints = currentUserId === ownerId;

  // Filter items by organization and visibility (admins see all, others see shared or owned)
  const orgTeams = useMemo(
    () => teams.filter((t: Team) =>
      (!t.orgId || t.orgId === orgId) && (isAdmin || t.shared !== false || t.createdBy === userEmail)
    ),
    [teams, orgId, userEmail, isAdmin]
  );
  const orgPeriods = useMemo(
    () => periods.filter((p: Period) =>
      (!p.orgId || p.orgId === orgId) && (isAdmin || p.shared !== false || p.createdBy === userEmail)
    ),
    [periods, orgId, userEmail, isAdmin]
  );
  const orgTags = useMemo(
    () => tags.filter((t: Tag) =>
      (!t.orgId || t.orgId === orgId) && (isAdmin || t.shared !== false || t.createdBy === userEmail)
    ),
    [tags, orgId, userEmail, isAdmin]
  );

  useEffect(() => {
    if (!periodId && activePeriodId) {
      setPeriodId(activePeriodId);
    } else if (!periodId && orgPeriods.length > 0) {
      setPeriodId(orgPeriods[0].id);
    }
  }, [activePeriodId, orgPeriods, periodId]);

  // Fetch org users for owner/assignee dropdowns
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

  // Set default owner to current user when creating new objective
  useEffect(() => {
    if (!objective && user && orgUsers.length > 0 && !ownerId) {
      const currentUser = orgUsers.find(u => u.email === user.email);
      if (currentUser) {
        setOwnerId(currentUser.id);
      }
    }
  }, [objective, user, orgUsers, ownerId]);

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !periodId) return;

    try {
      // Parse story points and value points
      const parsedStoryPoints = storyPoints.trim() ? parseFloat(storyPoints) : undefined;
      const parsedValuePoints = valuePoints.trim() ? parseFloat(valuePoints) : undefined;

      // Build link object if URL is provided
      const linkObj: ObjectiveLink | undefined = linkUrl.trim()
        ? { url: linkUrl.trim(), description: linkDescription.trim() || undefined }
        : undefined;

      if (objective) {
        const updates: Partial<Objective> = {
          title: title.trim(),
          description: description.trim() || undefined,
          level,
          teamId: teamId || undefined,
          ownerId: ownerId || undefined,
          assigneeId: assigneeId || undefined,
          tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
          periodId,
          shared: !isPrivate,
          link: linkObj,
        };
        // Only include points if user has permission to edit them
        if (canEditStoryPoints && parsedStoryPoints !== undefined && !isNaN(parsedStoryPoints) && parsedStoryPoints >= 0) {
          updates.storyPoints = parsedStoryPoints;
        }
        if (canEditValuePoints && parsedValuePoints !== undefined && !isNaN(parsedValuePoints) && parsedValuePoints >= 0) {
          updates.valuePoints = parsedValuePoints;
        }
        await updateObjective(objective.id, updates, userEmail);
      } else {
        await addObjective({
          title: title.trim(),
          description: description.trim() || undefined,
          level,
          parentId,
          teamId: teamId || undefined,
          ownerId: ownerId || undefined,
          assigneeId: assigneeId || undefined,
          tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
          periodId,
          storyPoints: parsedStoryPoints !== undefined && !isNaN(parsedStoryPoints) && parsedStoryPoints >= 0 ? parsedStoryPoints : undefined,
          valuePoints: parsedValuePoints !== undefined && !isNaN(parsedValuePoints) && parsedValuePoints >= 0 ? parsedValuePoints : undefined,
          link: linkObj,
          workflowStatus: 'todo',
        }, { orgId, userEmail, shared: !isPrivate });
      }
      onClose();
    } catch (error) {
      console.error('Failed to save objective:', error);
    }
  };

  const levelOptions: { value: ObjectiveLevel; label: string }[] = [
    { value: 'company', label: 'Company' },
    { value: 'team', label: 'Team' },
    { value: 'individual', label: 'Individual' },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Title *
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter objective title"
          className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Enter objective description (optional)"
          rows={3}
          className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Level *
          </label>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as ObjectiveLevel)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {levelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Period *
          </label>
          <select
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          >
            <option value="">Select period</option>
            {orgPeriods.map((period: Period) => (
              <option key={period.id} value={period.id}>
                {period.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(level === 'team' || level === 'individual') && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Team
          </label>
          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select team (optional)</option>
            {orgTeams.map((team: Team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Owner
          </label>
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select owner</option>
            {orgUsers.map((u: User) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Assignee
          </label>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Unassigned</option>
            {orgUsers.map((u: User) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Story Points
            {!canEditStoryPoints && assigneeId && (
              <span className="text-xs text-gray-400 ml-1">(assignee only)</span>
            )}
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={storyPoints}
            onChange={(e) => setStoryPoints(e.target.value)}
            placeholder="0"
            disabled={!canEditStoryPoints && !!assigneeId}
            className={`w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              !canEditStoryPoints && assigneeId ? 'bg-gray-50 text-gray-500' : ''
            }`}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Value Points
            {!canEditValuePoints && ownerId && (
              <span className="text-xs text-gray-400 ml-1">(owner only)</span>
            )}
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={valuePoints}
            onChange={(e) => setValuePoints(e.target.value)}
            placeholder="0"
            disabled={!canEditValuePoints && !!ownerId}
            className={`w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              !canEditValuePoints && ownerId ? 'bg-gray-50 text-gray-500' : ''
            }`}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Link URL
          </label>
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Link Description
            <span className="text-xs text-gray-400 ml-1">(optional)</span>
          </label>
          <input
            type="text"
            value={linkDescription}
            onChange={(e) => setLinkDescription(e.target.value)}
            placeholder="Display text for the link"
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {orgTags.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Tags
          </label>
          <div className="flex flex-wrap gap-2">
            {orgTags.map((tag: Tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm transition-colors ${
                  selectedTagIds.includes(tag.id)
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

      <div className="flex items-center gap-2 pt-2">
        <input
          type="checkbox"
          id="isPrivate"
          checked={isPrivate}
          onChange={(e) => setIsPrivate(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="isPrivate" className="text-sm text-gray-600">
          Private (only visible to me)
        </label>
      </div>

      {/* History Section */}
      {objective && objective.history && objective.history.length > 0 && (
        <div className="pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            <svg
              className={`w-4 h-4 transition-transform ${showHistory ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            History ({objective.history.length} {objective.history.length === 1 ? 'entry' : 'entries'})
          </button>
          {showHistory && (
            <div className="mt-3 space-y-3 max-h-64 overflow-y-auto">
              {[...objective.history].reverse().map((entry: ObjectiveHistoryEntry) => (
                <div key={entry.id} className="bg-gray-50 rounded-md p-3 text-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-gray-900">
                      {entry.action === 'created' ? 'Created' : 'Updated'}
                    </span>
                    <span className="text-xs text-gray-500">{formatDate(entry.timestamp)}</span>
                  </div>
                  <div className="text-xs text-gray-500 mb-2">by {entry.userEmail}</div>
                  {entry.changes.length > 0 && (
                    <ul className="space-y-1">
                      {entry.changes.map((change, idx) => (
                        <li key={idx} className="text-gray-600">
                          <span className="font-medium capitalize">{change.field}</span>
                          {change.oldValue !== undefined ? (
                            <>
                              : <span className="text-red-600 line-through">{String(change.oldValue)}</span>
                              {' → '}
                              <span className="text-green-600">{String(change.newValue)}</span>
                            </>
                          ) : (
                            <>: <span className="text-green-600">{String(change.newValue)}</span></>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">
          {objective ? 'Update' : 'Create'} Objective
        </Button>
      </div>
    </form>
  );
}
