import { useState, useEffect, useCallback } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '';

interface WorkLogEntry {
  id: string;
  message: string;
  createdAt: string;
  startTime: string | null;
  endTime: string | null;
  timeSpentMinutes: number | null;
}

function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function LogWorkPage() {
  const [message, setMessage] = useState('');
  const [workLogs, setWorkLogs] = useState<WorkLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editSpentHours, setEditSpentHours] = useState('');
  const [editSpentMinutes, setEditSpentMinutes] = useState('');

  const fetchWorkLogs = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/worklogs`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setWorkLogs(data.workLogs || []);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkLogs();
  }, [fetchWorkLogs]);

  const getTimeSpentMinutes = (h: string, m: string): number | null => {
    const hours = parseInt(h) || 0;
    const mins = parseInt(m) || 0;
    if (hours === 0 && mins === 0) return null;
    return hours * 60 + mins;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/api/users/me/worklogs`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      if (response.ok) {
        const data = await response.json();
        setWorkLogs(data.workLogs || []);
        setMessage('');
      }
    } catch {
      // ignore
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEditing = (entry: WorkLogEntry) => {
    setEditingId(entry.id);
    setEditMessage(entry.message);
    setEditStartTime(entry.startTime ? toLocalDatetime(entry.startTime) : '');
    setEditEndTime(entry.endTime ? toLocalDatetime(entry.endTime) : '');
    if (entry.timeSpentMinutes != null) {
      setEditSpentHours(String(Math.floor(entry.timeSpentMinutes / 60)));
      setEditSpentMinutes(String(entry.timeSpentMinutes % 60));
    } else {
      setEditSpentHours('');
      setEditSpentMinutes('');
    }
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditMessage('');
    setEditStartTime('');
    setEditEndTime('');
    setEditSpentHours('');
    setEditSpentMinutes('');
  };

  const handleUpdate = async (entryId: string) => {
    const trimmed = editMessage.trim();
    if (!trimmed) return;

    const timeSpentMinutes = getTimeSpentMinutes(editSpentHours, editSpentMinutes);

    const payload = {
      message: trimmed,
      startTime: editStartTime ? new Date(editStartTime).toISOString() : null,
      endTime: editEndTime ? new Date(editEndTime).toISOString() : null,
      timeSpentMinutes,
    };

    try {
      const response = await fetch(`${API_URL}/api/users/me/worklogs/${entryId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const data = await response.json();
        setWorkLogs(data.workLogs || []);
        cancelEditing();
      }
    } catch {
      // ignore
    }
  };

  const handleDelete = async (entryId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/worklogs/${entryId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setWorkLogs(data.workLogs || []);
      }
    } catch {
      // ignore
    }
  };

  const formatRelative = (iso: string) => {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatTimeRange = (entry: WorkLogEntry) => {
    if (!entry.startTime || !entry.endTime) return null;
    const start = formatTime(entry.startTime);
    const end = formatTime(entry.endTime);

    const startDate = new Date(entry.startTime);
    const endDate = new Date(entry.endTime);
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffMins = Math.round(diffMs / 60000);

    return { start, end, duration: formatDuration(diffMins) };
  };

  // Sort most recent first
  const sorted = [...workLogs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Log Work</h1>

      <form onSubmit={handleSubmit} className="flex gap-3">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What are you working on?"
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          disabled={isSubmitting}
        />
        <button
          type="submit"
          disabled={!message.trim() || isSubmitting}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Saving...' : 'Submit'}
        </button>
      </form>

      {isLoading ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : sorted.length === 0 ? (
        <p className="text-gray-500 text-sm">No work logged yet. Start by entering what you're working on above.</p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((entry) => {
            if (editingId === entry.id) {
              return (
                <li key={entry.id} className="p-4 bg-white border border-blue-300 rounded-lg space-y-3">
                  <input
                    type="text"
                    value={editMessage}
                    onChange={(e) => setEditMessage(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-sm text-gray-600">Time spent:</label>
                    <input
                      type="number"
                      min="0"
                      value={editSpentHours}
                      onChange={(e) => setEditSpentHours(e.target.value)}
                      placeholder="0"
                      className="w-16 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
                    />
                    <span className="text-sm text-gray-500">h</span>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={editSpentMinutes}
                      onChange={(e) => setEditSpentMinutes(e.target.value)}
                      placeholder="0"
                      className="w-16 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
                    />
                    <span className="text-sm text-gray-500">m</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-sm text-gray-600">Start:</label>
                    <input
                      type="datetime-local"
                      value={editStartTime}
                      onChange={(e) => setEditStartTime(e.target.value)}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <label className="text-sm text-gray-600">End:</label>
                    <input
                      type="datetime-local"
                      value={editEndTime}
                      onChange={(e) => setEditEndTime(e.target.value)}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUpdate(entry.id)}
                      disabled={!editMessage.trim()}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelEditing}
                      className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              );
            }

            const range = formatTimeRange(entry);
            return (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-3 p-4 bg-white border border-gray-200 rounded-lg"
              >
                <div className="min-w-0">
                  <p className="text-gray-900">{entry.message}</p>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <p className="text-xs text-gray-400" title={new Date(entry.createdAt).toLocaleString()}>
                      {formatRelative(entry.createdAt)}
                    </p>
                    {entry.timeSpentMinutes != null && (
                      <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                        {formatDuration(entry.timeSpentMinutes)}
                      </span>
                    )}
                    {range && (
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                        {range.start} – {range.end} ({range.duration})
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                  <button
                    onClick={() => startEditing(entry)}
                    className="text-gray-300 hover:text-blue-500 transition-colors"
                    title="Edit"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
