import { useState, useEffect, useMemo } from 'react';
import type { Objective, ObjectiveLevel, Period, Team, Tag } from '../../types';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../common/Button';

interface ObjectiveFormProps {
  objective?: Objective;
  parentId?: string;
  defaultLevel?: ObjectiveLevel;
  onClose: () => void;
}

export function ObjectiveForm({ objective, parentId, defaultLevel, onClose }: ObjectiveFormProps) {
  const [title, setTitle] = useState(objective?.title || '');
  const [description, setDescription] = useState(objective?.description || '');
  const [level, setLevel] = useState<ObjectiveLevel>(
    objective?.level || defaultLevel || 'company'
  );
  const [teamId, setTeamId] = useState(objective?.teamId || '');
  const [periodId, setPeriodId] = useState(objective?.periodId || '');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(objective?.tagIds || []);

  const { organization } = useAuth();
  const teams = useOKRStore((state: OKRStore) => state.teams);
  const periods = useOKRStore((state: OKRStore) => state.periods);
  const tags = useOKRStore((state: OKRStore) => state.tags);
  const activePeriodId = useOKRStore((state: OKRStore) => state.activePeriodId);
  const addObjective = useOKRStore((state: OKRStore) => state.addObjective);
  const updateObjective = useOKRStore((state: OKRStore) => state.updateObjective);

  const orgId = organization?.id || '';

  // Filter items by organization
  const orgTeams = useMemo(
    () => teams.filter((t: Team) => !t.orgId || t.orgId === orgId),
    [teams, orgId]
  );
  const orgPeriods = useMemo(
    () => periods.filter((p: Period) => !p.orgId || p.orgId === orgId),
    [periods, orgId]
  );
  const orgTags = useMemo(
    () => tags.filter((t: Tag) => !t.orgId || t.orgId === orgId),
    [tags, orgId]
  );

  useEffect(() => {
    if (!periodId && activePeriodId) {
      setPeriodId(activePeriodId);
    } else if (!periodId && orgPeriods.length > 0) {
      setPeriodId(orgPeriods[0].id);
    }
  }, [activePeriodId, orgPeriods, periodId]);

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !periodId) return;

    if (objective) {
      updateObjective(objective.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        level,
        teamId: teamId || undefined,
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        periodId,
      });
    } else {
      addObjective({
        title: title.trim(),
        description: description.trim() || undefined,
        level,
        parentId,
        teamId: teamId || undefined,
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        periodId,
      }, orgId);
    }

    onClose();
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
