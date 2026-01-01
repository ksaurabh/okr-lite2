import { useState, useMemo } from 'react';
import { useOKRStore } from '../../store/okrStore';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import type { Period, PeriodType } from '../../types';

type View = 'objectives' | 'teams' | 'periods' | 'tags';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
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
}

function PeriodItem({ period, periods, onAddChild, onDelete, depth = 0 }: PeriodItemProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const childPeriods = periods.filter((p) => p.parentId === period.id);
  const hasChildren = childPeriods.length > 0;

  const canAddChild = period.type === 'quarter' || period.type === 'month';
  const childType: PeriodType = period.type === 'quarter' ? 'month' : 'week';

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
          <span className="truncate">{period.name}</span>
        </div>
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
      </div>
      {isExpanded && hasChildren && (
        <div>
          {childPeriods.map((child) => (
            <PeriodItem
              key={child.id}
              period={child}
              periods={periods}
              onAddChild={onAddChild}
              onDelete={onDelete}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newPeriodName, setNewPeriodName] = useState('');
  const [newPeriodType, setNewPeriodType] = useState<PeriodType>('quarter');
  const [newPeriodParentId, setNewPeriodParentId] = useState<string | undefined>(undefined);
  const [newPeriodStart, setNewPeriodStart] = useState('');
  const [newPeriodEnd, setNewPeriodEnd] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('bg-blue-500');

  const teams = useOKRStore((state) => state.teams);
  const periods = useOKRStore((state) => state.periods);
  const tags = useOKRStore((state) => state.tags);
  const addTeam = useOKRStore((state) => state.addTeam);
  const addPeriod = useOKRStore((state) => state.addPeriod);
  const addTag = useOKRStore((state) => state.addTag);
  const deleteTeam = useOKRStore((state) => state.deleteTeam);
  const deletePeriod = useOKRStore((state) => state.deletePeriod);
  const deleteTag = useOKRStore((state) => state.deleteTag);

  // Get root periods (quarters with no parent)
  const rootPeriods = useMemo(
    () => periods.filter((p) => !p.parentId).sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [periods]
  );

  const handleAddTeam = () => {
    if (newTeamName.trim()) {
      addTeam({ name: newTeamName.trim() });
      setNewTeamName('');
      setShowTeamModal(false);
    }
  };

  const openAddPeriodModal = (parentId?: string, type: PeriodType = 'quarter') => {
    setNewPeriodParentId(parentId);
    setNewPeriodType(type);
    setNewPeriodName('');
    setNewPeriodStart('');
    setNewPeriodEnd('');
    setShowPeriodModal(true);
  };

  const handleAddPeriod = () => {
    if (newPeriodName.trim() && newPeriodStart && newPeriodEnd) {
      addPeriod({
        name: newPeriodName.trim(),
        type: newPeriodType,
        parentId: newPeriodParentId,
        startDate: newPeriodStart,
        endDate: newPeriodEnd,
        isActive: false,
      });
      setNewPeriodName('');
      setNewPeriodStart('');
      setNewPeriodEnd('');
      setNewPeriodParentId(undefined);
      setShowPeriodModal(false);
    }
  };

  const handleAddTag = () => {
    if (newTagName.trim()) {
      addTag({ name: newTagName.trim(), color: newTagColor });
      setNewTagName('');
      setNewTagColor('bg-blue-500');
      setShowTagModal(false);
    }
  };

  const getParentPeriodName = () => {
    if (!newPeriodParentId) return null;
    const parent = periods.find((p) => p.id === newPeriodParentId);
    return parent?.name;
  };

  const navItems: { id: View; label: string; icon: string }[] = [
    { id: 'objectives', label: 'Objectives', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
    { id: 'teams', label: 'Teams', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
    { id: 'periods', label: 'Periods', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { id: 'tags', label: 'Tags', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
  ];

  return (
    <aside className="w-64 bg-gray-50 border-r border-gray-200 min-h-screen">
      <nav className="p-4">
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => onViewChange(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                  currentView === item.id
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-200'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                </svg>
                {item.label}
              </button>
            </li>
          ))}
        </ul>

        {currentView === 'teams' && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-500 uppercase">Teams</h3>
              <button
                onClick={() => setShowTeamModal(true)}
                className="text-blue-600 hover:text-blue-700 text-sm"
              >
                + Add
              </button>
            </div>
            <ul className="space-y-1">
              {teams.map((team) => (
                <li key={team.id} className="flex items-center justify-between px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 rounded">
                  <span>{team.name}</span>
                  <button
                    onClick={() => deleteTeam(team.id)}
                    className="text-gray-400 hover:text-red-600"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {currentView === 'periods' && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-500 uppercase">Periods</h3>
              <button
                onClick={() => openAddPeriodModal(undefined, 'quarter')}
                className="text-blue-600 hover:text-blue-700 text-sm"
              >
                + Quarter
              </button>
            </div>
            <div className="space-y-0.5">
              {rootPeriods.map((period) => (
                <PeriodItem
                  key={period.id}
                  period={period}
                  periods={periods}
                  onAddChild={openAddPeriodModal}
                  onDelete={deletePeriod}
                />
              ))}
              {rootPeriods.length === 0 && (
                <p className="text-xs text-gray-400 px-3 py-2">No periods yet. Add a quarter to get started.</p>
              )}
            </div>
          </div>
        )}

        {currentView === 'tags' && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-500 uppercase">Tags</h3>
              <button
                onClick={() => setShowTagModal(true)}
                className="text-blue-600 hover:text-blue-700 text-sm"
              >
                + Add
              </button>
            </div>
            <ul className="space-y-1">
              {tags.map((tag) => (
                <li key={tag.id} className="flex items-center justify-between px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 rounded">
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${tag.color}`}></span>
                    <span>{tag.name}</span>
                  </div>
                  <button
                    onClick={() => deleteTag(tag.id)}
                    className="text-gray-400 hover:text-red-600"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      <Modal isOpen={showTeamModal} onClose={() => setShowTeamModal(false)} title="Add Team">
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Team name"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowTeamModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddTeam}>Add Team</Button>
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
