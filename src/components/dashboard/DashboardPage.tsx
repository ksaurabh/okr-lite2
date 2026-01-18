import { useMemo, useState, useEffect, useCallback } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import type { Objective, User, ObjectiveType, NextStepDateFilter } from '../../types';

type View = 'dashboard' | 'objectives' | 'checklist' | 'progress' | 'updates' | 'teams' | 'periods' | 'tags' | 'settings' | 'admin';

const API_URL = import.meta.env.VITE_API_URL || '';

interface NextStepByOwnerStats {
  ownerId: string | undefined;
  ownerName: string;
  total: number;
  notSet: number;
  inPast: number;
  today: number;
  next7d: number;
  inFuture: number;
}

interface TypesByOwnerStats {
  ownerId: string | undefined;
  ownerName: string;
  initiatives: number;
  sagas: number;
  epics: number;
  stories: number;
  subtasks: number;
  total: number;
}

interface NextStepByAssigneeStats {
  assigneeId: string | undefined;
  assigneeName: string;
  total: number;
  notSet: number;
  inPast: number;
  today: number;
  next7d: number;
  inFuture: number;
}

// Widget wrapper component for consistent sizing
function DashboardWidget({ children, title, subtitle, headerAction }: { children: React.ReactNode; title: string; subtitle?: string; headerAction?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 h-full flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          {headerAction && <div className="flex-shrink-0">{headerAction}</div>}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}

// Type filter options
const TYPE_OPTIONS: { value: ObjectiveType | 'all'; label: string }[] = [
  { value: 'all', label: 'All Types' },
  { value: 'initiative', label: 'Initiatives' },
  { value: 'saga', label: 'Sagas' },
  { value: 'epic', label: 'Epics' },
  { value: 'story', label: 'Stories' },
  { value: 'subtask', label: 'Subtasks' },
];

// Items by Next Step widget
interface ItemsByNextStepWidgetProps {
  orgObjectives: Objective[];
  orgUsers: User[];
  onCellClick: (ownerId: string | undefined, nextStepFilter: NextStepDateFilter | null, typeFilter: ObjectiveType | null) => void;
}

function ItemsByNextStepWidget({ orgObjectives, orgUsers, onCellClick }: ItemsByNextStepWidgetProps) {
  const [selectedType, setSelectedType] = useState<ObjectiveType | 'all'>('all');

  const filteredObjectives = useMemo(() => {
    // Exclude done and archived items
    let result = orgObjectives.filter(obj => obj.workflowStatus !== 'done' && obj.workflowStatus !== 'archived');
    if (selectedType !== 'all') {
      result = result.filter(obj => obj.type === selectedType);
    }
    return result;
  }, [orgObjectives, selectedType]);

  const itemsByNextStep = useMemo(() => {
    const now = Date.now();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * twentyFourHoursMs;

    const grouped = new Map<string | undefined, { total: number; notSet: number; inPast: number; today: number; next7d: number; inFuture: number }>();

    filteredObjectives.forEach((obj: Objective) => {
      const key = obj.ownerId;
      if (!grouped.has(key)) {
        grouped.set(key, { total: 0, notSet: 0, inPast: 0, today: 0, next7d: 0, inFuture: 0 });
      }
      const counts = grouped.get(key)!;
      counts.total++;

      if (!obj.nextStepDate) {
        counts.notSet++;
      } else {
        const [year, month, day] = obj.nextStepDate.split('-').map(Number);
        const stepDate = new Date(year, month - 1, day);
        stepDate.setHours(0, 0, 0, 0);
        const stepMs = stepDate.getTime();
        // Use end of the step date (midnight of next day) for comparison
        const stepEndMs = stepMs + twentyFourHoursMs;
        const diffFromNow = stepEndMs - now;

        if (diffFromNow < 0) {
          // Past: step date ended more than 24 hours ago
          counts.inPast++;
        } else if (diffFromNow < twentyFourHoursMs) {
          // Today: within 24 hours
          counts.today++;
        } else if (diffFromNow < sevenDaysMs) {
          // Next 7 days (excluding today)
          counts.next7d++;
        } else {
          counts.inFuture++;
        }
      }
    });

    const stats: NextStepByOwnerStats[] = [];
    grouped.forEach((counts, ownerId) => {
      const owner = orgUsers.find((u: User) => u.id === ownerId);
      stats.push({
        ownerId,
        ownerName: owner?.name || (ownerId ? 'Unknown' : 'Unassigned'),
        ...counts,
      });
    });

    stats.sort((a, b) => b.total - a.total);
    return stats;
  }, [filteredObjectives, orgUsers]);

  const totals = useMemo(() => {
    return itemsByNextStep.reduce(
      (acc, stat) => ({
        total: acc.total + stat.total,
        notSet: acc.notSet + stat.notSet,
        inPast: acc.inPast + stat.inPast,
        today: acc.today + stat.today,
        next7d: acc.next7d + stat.next7d,
        inFuture: acc.inFuture + stat.inFuture,
      }),
      { total: 0, notSet: 0, inPast: 0, today: 0, next7d: 0, inFuture: 0 }
    );
  }, [itemsByNextStep]);

  const typeFilter = selectedType === 'all' ? null : selectedType;

  return (
    <DashboardWidget
      title="Items by Next Step & Owner"
      subtitle={`${totals.total} items across ${itemsByNextStep.length} owners`}
      headerAction={
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value as ObjectiveType | 'all')}
          className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {TYPE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      }
    >
      {itemsByNextStep.length === 0 ? (
        <div className="p-4 text-center text-gray-500">
          <p className="text-xs">No items found</p>
        </div>
      ) : (
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th scope="col" className="px-2 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                Owner
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider">
                Total
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="Not Set">
                None
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="In the Past">
                Past
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="Today">
                Today
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="Next 7 Days">
                7d
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="In the Future">
                Future
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {itemsByNextStep.map((stat) => (
              <tr key={stat.ownerId || 'unassigned'} className="hover:bg-gray-50">
                <td className="px-2 py-2 whitespace-nowrap text-gray-900 truncate max-w-[100px]" title={stat.ownerName}>
                  {stat.ownerName}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right font-medium">
                  <button
                    onClick={() => onCellClick(stat.ownerId, null, typeFilter)}
                    className="text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {stat.total}
                  </button>
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right">
                  {stat.notSet ? (
                    <button
                      onClick={() => onCellClick(stat.ownerId, 'not_set', typeFilter)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.notSet}
                    </button>
                  ) : '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right">
                  {stat.inPast ? (
                    <button
                      onClick={() => onCellClick(stat.ownerId, 'past', typeFilter)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.inPast}
                    </button>
                  ) : '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right">
                  {stat.today ? (
                    <button
                      onClick={() => onCellClick(stat.ownerId, 'today', typeFilter)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.today}
                    </button>
                  ) : '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right">
                  {stat.next7d ? (
                    <button
                      onClick={() => onCellClick(stat.ownerId, 'next_7d', typeFilter)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.next7d}
                    </button>
                  ) : '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right">
                  {stat.inFuture ? (
                    <button
                      onClick={() => onCellClick(stat.ownerId, 'future', typeFilter)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.inFuture}
                    </button>
                  ) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 sticky bottom-0">
            <tr>
              <td className="px-2 py-2 font-medium text-gray-900">
                Total
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                <button
                  onClick={() => onCellClick(undefined, null, typeFilter)}
                  className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                >
                  {totals.total}
                </button>
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.notSet ? (
                  <button
                    onClick={() => onCellClick(undefined, 'not_set', typeFilter)}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                  >
                    {totals.notSet}
                  </button>
                ) : totals.notSet}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.inPast ? (
                  <button
                    onClick={() => onCellClick(undefined, 'past', typeFilter)}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                  >
                    {totals.inPast}
                  </button>
                ) : totals.inPast}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.today ? (
                  <button
                    onClick={() => onCellClick(undefined, 'today', typeFilter)}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                  >
                    {totals.today}
                  </button>
                ) : totals.today}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.next7d ? (
                  <button
                    onClick={() => onCellClick(undefined, 'next_7d', typeFilter)}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                  >
                    {totals.next7d}
                  </button>
                ) : totals.next7d}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.inFuture ? (
                  <button
                    onClick={() => onCellClick(undefined, 'future', typeFilter)}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                  >
                    {totals.inFuture}
                  </button>
                ) : totals.inFuture}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </DashboardWidget>
  );
}

// Items by Next Step and Assignee widget
interface ItemsByNextStepAndAssigneeWidgetProps {
  orgObjectives: Objective[];
  orgUsers: User[];
  onCellClick: (assigneeId: string | undefined, ownerId: string | undefined, nextStepFilter: NextStepDateFilter | null, typeFilter: ObjectiveType | null) => void;
}

function ItemsByNextStepAndAssigneeWidget({ orgObjectives, orgUsers, onCellClick }: ItemsByNextStepAndAssigneeWidgetProps) {
  const [selectedType, setSelectedType] = useState<ObjectiveType | 'all'>('all');
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | 'all'>('all');

  const filteredObjectives = useMemo(() => {
    // Exclude done and archived items
    let result = orgObjectives.filter(obj => obj.workflowStatus !== 'done' && obj.workflowStatus !== 'archived');
    if (selectedType !== 'all') {
      result = result.filter(obj => obj.type === selectedType);
    }
    if (selectedOwnerId !== 'all') {
      result = result.filter(obj => obj.ownerId === selectedOwnerId);
    }
    return result;
  }, [orgObjectives, selectedType, selectedOwnerId]);

  const itemsByNextStep = useMemo(() => {
    const now = Date.now();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * twentyFourHoursMs;

    const grouped = new Map<string | undefined, { total: number; notSet: number; inPast: number; today: number; next7d: number; inFuture: number }>();

    filteredObjectives.forEach((obj: Objective) => {
      const key = obj.assigneeId;
      if (!grouped.has(key)) {
        grouped.set(key, { total: 0, notSet: 0, inPast: 0, today: 0, next7d: 0, inFuture: 0 });
      }
      const counts = grouped.get(key)!;
      counts.total++;

      if (!obj.nextStepDate) {
        counts.notSet++;
      } else {
        const [year, month, day] = obj.nextStepDate.split('-').map(Number);
        const stepDate = new Date(year, month - 1, day);
        stepDate.setHours(0, 0, 0, 0);
        const stepMs = stepDate.getTime();
        // Use end of the step date (midnight of next day) for comparison
        const stepEndMs = stepMs + twentyFourHoursMs;
        const diffFromNow = stepEndMs - now;

        if (diffFromNow < 0) {
          // Past: step date ended more than 24 hours ago
          counts.inPast++;
        } else if (diffFromNow < twentyFourHoursMs) {
          // Today: within 24 hours
          counts.today++;
        } else if (diffFromNow < sevenDaysMs) {
          // Next 7 days (excluding today)
          counts.next7d++;
        } else {
          counts.inFuture++;
        }
      }
    });

    const stats: NextStepByAssigneeStats[] = [];
    grouped.forEach((counts, assigneeId) => {
      const assignee = orgUsers.find((u: User) => u.id === assigneeId);
      stats.push({
        assigneeId,
        assigneeName: assignee?.name || (assigneeId ? 'Unknown' : 'Unassigned'),
        ...counts,
      });
    });

    stats.sort((a, b) => b.total - a.total);
    return stats;
  }, [filteredObjectives, orgUsers]);

  const totals = useMemo(() => {
    return itemsByNextStep.reduce(
      (acc, stat) => ({
        total: acc.total + stat.total,
        notSet: acc.notSet + stat.notSet,
        inPast: acc.inPast + stat.inPast,
        today: acc.today + stat.today,
        next7d: acc.next7d + stat.next7d,
        inFuture: acc.inFuture + stat.inFuture,
      }),
      { total: 0, notSet: 0, inPast: 0, today: 0, next7d: 0, inFuture: 0 }
    );
  }, [itemsByNextStep]);

  const typeFilter = selectedType === 'all' ? null : selectedType;
  const ownerIdForFilter = selectedOwnerId === 'all' ? undefined : selectedOwnerId;

  return (
    <DashboardWidget
      title="Items by Next Step & Assignee"
      subtitle={`${totals.total} items across ${itemsByNextStep.length} assignees`}
      headerAction={
        <div className="flex gap-1">
          <select
            value={selectedOwnerId}
            onChange={(e) => setSelectedOwnerId(e.target.value)}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[100px]"
          >
            <option value="all">All Owners</option>
            {orgUsers.map(user => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value as ObjectiveType | 'all')}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {TYPE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      }
    >
      {itemsByNextStep.length === 0 ? (
        <div className="p-4 text-center text-gray-500">
          <p className="text-xs">No items found</p>
        </div>
      ) : (
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th scope="col" className="px-2 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                Assignee
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider">
                Total
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="Not Set">
                None
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="In the Past">
                Past
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="Today">
                Today
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="Next 7 Days">
                7d
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="In the Future">
                Future
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {itemsByNextStep.map((stat) => (
              <tr key={stat.assigneeId || 'unassigned'} className="hover:bg-gray-50">
                <td className="px-2 py-2 whitespace-nowrap text-gray-900 truncate max-w-[100px]" title={stat.assigneeName}>
                  {stat.assigneeName}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right font-medium">
                  <button
                    onClick={() => onCellClick(stat.assigneeId, ownerIdForFilter, null, typeFilter)}
                    className="text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {stat.total}
                  </button>
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right">
                  {stat.notSet ? (
                    <button
                      onClick={() => onCellClick(stat.assigneeId, ownerIdForFilter, 'not_set', typeFilter)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.notSet}
                    </button>
                  ) : '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right">
                  {stat.inPast ? (
                    <button
                      onClick={() => onCellClick(stat.assigneeId, ownerIdForFilter, 'past', typeFilter)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.inPast}
                    </button>
                  ) : '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right">
                  {stat.today ? (
                    <button
                      onClick={() => onCellClick(stat.assigneeId, ownerIdForFilter, 'today', typeFilter)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.today}
                    </button>
                  ) : '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right">
                  {stat.next7d ? (
                    <button
                      onClick={() => onCellClick(stat.assigneeId, ownerIdForFilter, 'next_7d', typeFilter)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.next7d}
                    </button>
                  ) : '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right">
                  {stat.inFuture ? (
                    <button
                      onClick={() => onCellClick(stat.assigneeId, ownerIdForFilter, 'future', typeFilter)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.inFuture}
                    </button>
                  ) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 sticky bottom-0">
            <tr>
              <td className="px-2 py-2 font-medium text-gray-900">
                Total
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.total}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.notSet}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.inPast}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.today}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.next7d}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.inFuture}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </DashboardWidget>
  );
}

// Types by Owner widget
function TypesByOwnerWidget({ orgObjectives, orgUsers }: { orgObjectives: Objective[]; orgUsers: User[] }) {
  const typesByOwner = useMemo(() => {
    const grouped = new Map<string | undefined, { initiatives: number; sagas: number; epics: number; stories: number; subtasks: number }>();

    orgObjectives.forEach((obj: Objective) => {
      const key = obj.ownerId;
      if (!grouped.has(key)) {
        grouped.set(key, { initiatives: 0, sagas: 0, epics: 0, stories: 0, subtasks: 0 });
      }
      const counts = grouped.get(key)!;
      if (obj.type === 'initiative') counts.initiatives++;
      else if (obj.type === 'saga') counts.sagas++;
      else if (obj.type === 'epic') counts.epics++;
      else if (obj.type === 'story') counts.stories++;
      else if (obj.type === 'subtask') counts.subtasks++;
    });

    const stats: TypesByOwnerStats[] = [];
    grouped.forEach((counts, ownerId) => {
      const owner = orgUsers.find((u: User) => u.id === ownerId);
      const total = counts.initiatives + counts.sagas + counts.epics + counts.stories + counts.subtasks;
      if (total > 0) {
        stats.push({
          ownerId,
          ownerName: owner?.name || (ownerId ? 'Unknown' : 'Unassigned'),
          ...counts,
          total,
        });
      }
    });

    stats.sort((a, b) => b.total - a.total);
    return stats;
  }, [orgObjectives, orgUsers]);

  const totals = useMemo(() => {
    return typesByOwner.reduce(
      (acc, stat) => ({
        initiatives: acc.initiatives + stat.initiatives,
        sagas: acc.sagas + stat.sagas,
        epics: acc.epics + stat.epics,
        stories: acc.stories + stat.stories,
        subtasks: acc.subtasks + stat.subtasks,
        total: acc.total + stat.total,
      }),
      { initiatives: 0, sagas: 0, epics: 0, stories: 0, subtasks: 0, total: 0 }
    );
  }, [typesByOwner]);

  return (
    <DashboardWidget
      title="Items by Type & Owner"
      subtitle={`${totals.total} items across ${typesByOwner.length} owners`}
    >
      {typesByOwner.length === 0 ? (
        <div className="p-4 text-center text-gray-500">
          <p className="text-xs">No items with types assigned</p>
        </div>
      ) : (
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th scope="col" className="px-2 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                Owner
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="Initiatives">
                Init
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="Sagas">
                Saga
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="Epics">
                Epic
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="Stories">
                Story
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="Subtasks">
                Sub
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {typesByOwner.map((stat) => (
              <tr key={stat.ownerId || 'unassigned'} className="hover:bg-gray-50">
                <td className="px-2 py-2 whitespace-nowrap text-gray-900 truncate max-w-[100px]" title={stat.ownerName}>
                  {stat.ownerName}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-gray-900 text-right">
                  {stat.initiatives || '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-gray-900 text-right">
                  {stat.sagas || '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-gray-900 text-right">
                  {stat.epics || '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-gray-900 text-right">
                  {stat.stories || '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-gray-900 text-right">
                  {stat.subtasks || '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-gray-900 text-right font-medium">
                  {stat.total}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 sticky bottom-0">
            <tr>
              <td className="px-2 py-2 font-medium text-gray-900">
                Total
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.initiatives}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.sagas}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.epics}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.stories}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.subtasks}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.total}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </DashboardWidget>
  );
}

// Items by Type and Next Step widget (filter by owner)
interface TypeByNextStepStats {
  type: ObjectiveType;
  typeLabel: string;
  total: number;
  notSet: number;
  inPast: number;
  today: number;
  next7d: number;
  inFuture: number;
}

interface ItemsByTypeAndNextStepWidgetProps {
  orgObjectives: Objective[];
  orgUsers: User[];
  onCellClick: (ownerId: string | undefined, nextStepFilter: NextStepDateFilter | null, typeFilter: ObjectiveType | null) => void;
}

function ItemsByTypeAndNextStepWidget({ orgObjectives, orgUsers, onCellClick }: ItemsByTypeAndNextStepWidgetProps) {
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | 'all'>('all');

  const filteredObjectives = useMemo(() => {
    // Exclude done and archived items
    let result = orgObjectives.filter(obj => obj.workflowStatus !== 'done' && obj.workflowStatus !== 'archived');
    if (selectedOwnerId !== 'all') {
      result = result.filter(obj => obj.ownerId === selectedOwnerId);
    }
    return result;
  }, [orgObjectives, selectedOwnerId]);

  const typesByNextStep = useMemo(() => {
    const now = Date.now();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * twentyFourHoursMs;

    const typeLabels: Record<ObjectiveType, string> = {
      initiative: 'Initiative',
      saga: 'Saga',
      epic: 'Epic',
      story: 'Story',
      subtask: 'Subtask',
    };

    const types: ObjectiveType[] = ['initiative', 'saga', 'epic', 'story', 'subtask'];
    const stats: TypeByNextStepStats[] = types.map(type => ({
      type,
      typeLabel: typeLabels[type],
      total: 0,
      notSet: 0,
      inPast: 0,
      today: 0,
      next7d: 0,
      inFuture: 0,
    }));

    const typeIndexMap = new Map(types.map((t, i) => [t, i]));

    filteredObjectives.forEach((obj: Objective) => {
      if (!obj.type) return;
      const idx = typeIndexMap.get(obj.type);
      if (idx === undefined) return;

      const stat = stats[idx];
      stat.total++;

      if (!obj.nextStepDate) {
        stat.notSet++;
      } else {
        const [year, month, day] = obj.nextStepDate.split('-').map(Number);
        const stepDate = new Date(year, month - 1, day);
        stepDate.setHours(0, 0, 0, 0);
        const stepMs = stepDate.getTime();
        const stepEndMs = stepMs + twentyFourHoursMs;
        const diffFromNow = stepEndMs - now;

        if (diffFromNow < 0) {
          stat.inPast++;
        } else if (diffFromNow < twentyFourHoursMs) {
          stat.today++;
        } else if (diffFromNow < sevenDaysMs) {
          stat.next7d++;
        } else {
          stat.inFuture++;
        }
      }
    });

    return stats;
  }, [filteredObjectives]);

  const totals = useMemo(() => {
    return typesByNextStep.reduce(
      (acc, stat) => ({
        total: acc.total + stat.total,
        notSet: acc.notSet + stat.notSet,
        inPast: acc.inPast + stat.inPast,
        today: acc.today + stat.today,
        next7d: acc.next7d + stat.next7d,
        inFuture: acc.inFuture + stat.inFuture,
      }),
      { total: 0, notSet: 0, inPast: 0, today: 0, next7d: 0, inFuture: 0 }
    );
  }, [typesByNextStep]);

  const ownerName = selectedOwnerId === 'all'
    ? 'All Owners'
    : orgUsers.find(u => u.id === selectedOwnerId)?.name || 'Unknown';

  // Get owner ID for filter (undefined if "all" selected)
  const ownerIdForFilter = selectedOwnerId === 'all' ? undefined : selectedOwnerId;

  return (
    <DashboardWidget
      title="Items by Type & Next Step"
      subtitle={`${totals.total} items (${ownerName})`}
      headerAction={
        <select
          value={selectedOwnerId}
          onChange={(e) => setSelectedOwnerId(e.target.value)}
          className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[120px]"
        >
          <option value="all">All Owners</option>
          {orgUsers.map(user => (
            <option key={user.id} value={user.id}>{user.name}</option>
          ))}
        </select>
      }
    >
      {totals.total === 0 ? (
        <div className="p-4 text-center text-gray-500">
          <p className="text-xs">No items found</p>
        </div>
      ) : (
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th scope="col" className="px-2 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                Type
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider">
                Total
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="Not Set">
                None
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="In the Past">
                Past
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="Today">
                Today
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="Next 7 Days">
                7d
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium text-gray-500 uppercase tracking-wider" title="In the Future">
                Future
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {typesByNextStep.map((stat) => (
              <tr key={stat.type} className="hover:bg-gray-50">
                <td className="px-2 py-2 whitespace-nowrap text-gray-900">
                  {stat.typeLabel}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right font-medium">
                  {stat.total ? (
                    <button
                      onClick={() => onCellClick(ownerIdForFilter, null, stat.type)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.total}
                    </button>
                  ) : '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right">
                  {stat.notSet ? (
                    <button
                      onClick={() => onCellClick(ownerIdForFilter, 'not_set', stat.type)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.notSet}
                    </button>
                  ) : '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right">
                  {stat.inPast ? (
                    <button
                      onClick={() => onCellClick(ownerIdForFilter, 'past', stat.type)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.inPast}
                    </button>
                  ) : '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right">
                  {stat.today ? (
                    <button
                      onClick={() => onCellClick(ownerIdForFilter, 'today', stat.type)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.today}
                    </button>
                  ) : '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right">
                  {stat.next7d ? (
                    <button
                      onClick={() => onCellClick(ownerIdForFilter, 'next_7d', stat.type)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.next7d}
                    </button>
                  ) : '-'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-right">
                  {stat.inFuture ? (
                    <button
                      onClick={() => onCellClick(ownerIdForFilter, 'future', stat.type)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {stat.inFuture}
                    </button>
                  ) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 sticky bottom-0">
            <tr>
              <td className="px-2 py-2 font-medium text-gray-900">
                Total
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.total}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.notSet}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.inPast}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.today}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.next7d}
              </td>
              <td className="px-2 py-2 font-medium text-gray-900 text-right">
                {totals.inFuture}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </DashboardWidget>
  );
}

// Empty placeholder widget
function EmptyWidget() {
  return (
    <div className="bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 h-full flex items-center justify-center">
      <p className="text-xs text-gray-400">Empty</p>
    </div>
  );
}

interface DashboardPageProps {
  onViewChange: (view: View) => void;
}

export function DashboardPage({ onViewChange }: DashboardPageProps) {
  const [orgUsers, setOrgUsers] = useState<User[]>([]);

  const { organization, user, isSuperAdmin, isOrgAdmin } = useAuth();
  const orgId = organization?.id || '';
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;

  const clearAllFilters = useOKRStore((state: OKRStore) => state.clearAllFilters);
  const setFilterOwners = useOKRStore((state: OKRStore) => state.setFilterOwners);
  const setFilterAssignees = useOKRStore((state: OKRStore) => state.setFilterAssignees);
  const toggleFilterAssigneeNotSet = useOKRStore((state: OKRStore) => state.toggleFilterAssigneeNotSet);
  const setFilterNextStepDate = useOKRStore((state: OKRStore) => state.setFilterNextStepDate);
  const toggleFilterType = useOKRStore((state: OKRStore) => state.toggleFilterType);
  const toggleFilterWorkflowStatus = useOKRStore((state: OKRStore) => state.toggleFilterWorkflowStatus);

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

  const objectives = useOKRStore((state: OKRStore) => state.objectives);

  const orgObjectives = useMemo(
    () => objectives.filter((o: Objective) =>
      (!o.orgId || o.orgId === orgId) && (isAdmin || o.shared !== false || o.createdBy === userEmail)
    ),
    [objectives, orgId, userEmail, isAdmin]
  );

  const handleNextStepCellClick = useCallback((ownerId: string | undefined, nextStepFilter: NextStepDateFilter | null, typeFilter: ObjectiveType | null) => {
    clearAllFilters();
    if (ownerId) {
      setFilterOwners([ownerId]);
    }
    if (nextStepFilter) {
      setFilterNextStepDate(nextStepFilter);
    }
    if (typeFilter) {
      toggleFilterType(typeFilter);
    }
    // Set workflow status filter to exclude done and archived (select active statuses)
    toggleFilterWorkflowStatus('todo');
    toggleFilterWorkflowStatus('planning');
    toggleFilterWorkflowStatus('in_progress');
    toggleFilterWorkflowStatus('acceptance');
    onViewChange('objectives');
  }, [clearAllFilters, setFilterOwners, setFilterNextStepDate, toggleFilterType, toggleFilterWorkflowStatus, onViewChange]);

  const handleAssigneeCellClick = useCallback((assigneeId: string | undefined, ownerId: string | undefined, nextStepFilter: NextStepDateFilter | null, typeFilter: ObjectiveType | null) => {
    clearAllFilters();
    if (assigneeId) {
      setFilterAssignees([assigneeId]);
    } else {
      // Apply "Assignee Not Set" filter when clicking on unassigned row
      toggleFilterAssigneeNotSet();
    }
    if (ownerId) {
      setFilterOwners([ownerId]);
    }
    if (nextStepFilter) {
      setFilterNextStepDate(nextStepFilter);
    }
    if (typeFilter) {
      toggleFilterType(typeFilter);
    }
    // Set workflow status filter to exclude done and archived (select active statuses)
    toggleFilterWorkflowStatus('todo');
    toggleFilterWorkflowStatus('planning');
    toggleFilterWorkflowStatus('in_progress');
    toggleFilterWorkflowStatus('acceptance');
    onViewChange('objectives');
  }, [clearAllFilters, setFilterAssignees, toggleFilterAssigneeNotSet, setFilterOwners, setFilterNextStepDate, toggleFilterType, toggleFilterWorkflowStatus, onViewChange]);

  // Calculate row height as roughly 1/3 of viewport height minus header space
  // Using calc with vh units for responsive sizing
  const cellHeight = 'calc((100vh - 180px) / 3)';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Overview of your OKR metrics</p>
      </div>

      {/* 3x3 Grid */}
      <div
        className="grid grid-cols-3 gap-4"
        style={{ gridAutoRows: cellHeight }}
      >
        {/* Row 1 */}
        {/* Cell (1,1) - Items by Next Step */}
        <ItemsByNextStepWidget orgObjectives={orgObjectives} orgUsers={orgUsers} onCellClick={handleNextStepCellClick} />

        {/* Cell (1,2) - Items by Type & Owner */}
        <TypesByOwnerWidget orgObjectives={orgObjectives} orgUsers={orgUsers} />

        {/* Cell (1,3) - Items by Type & Next Step */}
        <ItemsByTypeAndNextStepWidget orgObjectives={orgObjectives} orgUsers={orgUsers} onCellClick={handleNextStepCellClick} />

        {/* Row 2 */}
        {/* Cell (2,1) - Items by Next Step & Assignee */}
        <ItemsByNextStepAndAssigneeWidget orgObjectives={orgObjectives} orgUsers={orgUsers} onCellClick={handleAssigneeCellClick} />

        {/* Cell (2,2) - Empty */}
        <EmptyWidget />

        {/* Cell (2,3) - Empty */}
        <EmptyWidget />

        {/* Row 3 */}
        {/* Cell (3,1) - Empty */}
        <EmptyWidget />

        {/* Cell (3,2) - Empty */}
        <EmptyWidget />

        {/* Cell (3,3) - Empty */}
        <EmptyWidget />
      </div>
    </div>
  );
}
