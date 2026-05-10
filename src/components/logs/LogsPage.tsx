import { useMemo } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import type { Objective, ObjectiveHistoryEntry, FieldChange } from '../../types';

interface LogsPageProps {
  onNavigateToObjective: (objectiveId: string) => void;
}

const FIELD_TO_KEY: Record<string, keyof Objective> = {
  title: 'title',
  description: 'description',
  level: 'level',
  type: 'type',
  period: 'periodId',
  team: 'teamId',
  tags: 'tagIds',
  parent: 'parentId',
  visibility: 'shared',
  owner: 'ownerId',
  assignee: 'assigneeId',
  resolved: 'resolvedAt',
  status: 'workflowStatus',
  nextStepDate: 'nextStepDate',
  nextStep: 'nextStep',
  storyPoints: 'storyPoints',
  valuePoints: 'valuePoints',
  isKeyResult: 'isKeyResult',
  link: 'link',
};

function isUndoableEntry(entry: { changes: FieldChange[] }): boolean {
  if (entry.changes.length === 0) return false;
  return entry.changes.every(c => FIELD_TO_KEY[c.field] !== undefined && 'oldRaw' in c);
}

interface LogEntry {
  entryId: string;
  objectiveId: string;
  objectiveTitle: string;
  timestamp: string;
  userEmail: string;
  action: 'created' | 'updated';
  changes: FieldChange[];
}

const FIELD_LABELS: Record<string, string> = {
  title: 'title',
  description: 'description',
  level: 'level',
  period: 'period',
  team: 'team',
  tags: 'tags',
  parent: 'parent',
  visibility: 'visibility',
  owner: 'owner',
  assignee: 'assignee',
  resolvedAt: 'resolved date',
  workflowStatus: 'status',
  nextStepDate: 'next step date',
  nextStep: 'next step',
  storyPoints: 'story points',
  valuePoints: 'value points',
  link: 'link',
  isKeyResult: 'key result flag',
  type: 'type',
};

function formatFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function formatValue(value: string | number | boolean | undefined): string {
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

function summarizeChanges(changes: FieldChange[]): string {
  if (changes.length === 0) return '';
  return changes.map(c => formatFieldLabel(c.field)).join(', ');
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

function formatExactTimestamp(timestamp: string): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function LogsPage({ onNavigateToObjective }: LogsPageProps) {
  const objectives = useOKRStore((state: OKRStore) => state.objectives);
  const updateObjective = useOKRStore((state: OKRStore) => state.updateObjective);
  const { user } = useAuth();
  const userEmail = user?.email || '';

  const handleUndo = async (objectiveId: string, changes: FieldChange[]) => {
    const patch: Partial<Objective> = {};
    for (const c of changes) {
      const key = FIELD_TO_KEY[c.field];
      if (!key) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[key] = c.oldRaw;
    }
    await updateObjective(objectiveId, patch, userEmail);
  };

  const logEntries = useMemo<LogEntry[]>(() => {
    const entries: LogEntry[] = [];
    objectives.forEach((obj: Objective) => {
      if (!obj.history) return;
      obj.history.forEach((h: ObjectiveHistoryEntry) => {
        entries.push({
          entryId: h.id,
          objectiveId: obj.id,
          objectiveTitle: obj.title,
          timestamp: h.timestamp,
          userEmail: h.userEmail,
          action: h.action,
          changes: h.changes,
        });
      });
    });
    return entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [objectives]);

  if (logEntries.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center h-64 text-gray-400 text-sm">
        No activity logged yet.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Activity Log</h2>
      <div className="space-y-0 divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden bg-white">
        {logEntries.map((entry) => (
          <div key={entry.entryId} className="px-4 py-3 flex gap-4 hover:bg-gray-50 transition-colors">
            {/* Timestamp */}
            <div className="flex-shrink-0 w-44 text-right">
              <div className="text-xs text-gray-400" title={formatTimestamp(entry.timestamp)}>
                {timeAgo(entry.timestamp)}
              </div>
              <div className="text-[11px] text-gray-400 font-mono">
                {formatExactTimestamp(entry.timestamp)}
              </div>
            </div>

            {/* Action dot */}
            <div className="flex-shrink-0 flex flex-col items-center pt-1">
              <span className={`w-2 h-2 rounded-full ${entry.action === 'created' ? 'bg-green-400' : 'bg-blue-400'}`} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-1.5 text-sm">
                <button
                  onClick={() => onNavigateToObjective(entry.objectiveId)}
                  className="font-medium text-blue-600 hover:text-blue-800 hover:underline truncate max-w-xs text-left"
                  title={entry.objectiveTitle}
                >
                  {entry.objectiveTitle}
                </button>
                {entry.action === 'created' ? (
                  <span className="text-gray-500">was created</span>
                ) : (
                  <>
                    <span className="text-gray-500">—</span>
                    <span className="text-gray-600">{summarizeChanges(entry.changes)} updated</span>
                  </>
                )}
              </div>

              {/* Change details */}
              {entry.action === 'updated' && entry.changes.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {entry.changes.map((change, i) => (
                    <div key={i} className="flex items-baseline gap-1.5 text-xs text-gray-400">
                      <span className="font-medium text-gray-500">{formatFieldLabel(change.field)}:</span>
                      {change.oldValue !== undefined && change.oldValue !== '' && (
                        <>
                          <span className="line-through">{formatValue(change.oldValue)}</span>
                          <span>→</span>
                        </>
                      )}
                      <span className="text-gray-600">{formatValue(change.newValue)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-0.5 text-xs text-gray-400 flex items-center gap-3">
                <span>{entry.userEmail}</span>
                {entry.action === 'updated' && isUndoableEntry(entry) && (
                  <button
                    onClick={() => handleUndo(entry.objectiveId, entry.changes)}
                    className="text-blue-600 hover:text-blue-700 hover:underline"
                  >
                    Undo
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
