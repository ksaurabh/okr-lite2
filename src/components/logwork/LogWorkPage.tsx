import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import type { Objective } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';

interface WorkLogEntry {
  id: string;
  message: string;
  createdAt: string;
  startTime: string | null;
  endTime: string | null;
  timeSpentMinutes: number | null;
}

interface Todo {
  id: string;
  text: string;
  objectiveId: string | null;
  order: number;
  createdAt: string;
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

// ── Objective Picker Panel ──

interface ObjectivePickerProps {
  todoId: string;
  currentObjectiveId: string | null;
  onSelect: (todoId: string, objectiveId: string | null) => void;
  onClose: () => void;
}

function ObjectivePicker({ todoId, currentObjectiveId, onSelect, onClose }: ObjectivePickerProps) {
  const [search, setSearch] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const objectives = useOKRStore((state: OKRStore) => state.objectives);

  const toggleCollapse = (id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const objectiveTree = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchingIds = new Set<string>();

    if (q) {
      const matched = objectives.filter((o: Objective) => o.title.toLowerCase().includes(q));
      matched.forEach((o: Objective) => {
        matchingIds.add(o.id);
        let current = o;
        while (current.parentId) {
          matchingIds.add(current.parentId);
          const parent = objectives.find((p: Objective) => p.id === current.parentId);
          if (!parent) break;
          current = parent;
        }
      });
    }

    const visible = q ? objectives.filter((o: Objective) => matchingIds.has(o.id)) : objectives;
    const roots = visible.filter((o: Objective) => !o.parentId || !visible.find((p: Objective) => p.id === o.parentId));
    const childrenMap = new Map<string, Objective[]>();
    visible.forEach((o: Objective) => {
      if (o.parentId && visible.find((p: Objective) => p.id === o.parentId)) {
        const siblings = childrenMap.get(o.parentId) || [];
        siblings.push(o);
        childrenMap.set(o.parentId, siblings);
      }
    });

    const result: { objective: Objective; depth: number; hasChildren: boolean }[] = [];
    const walk = (nodes: Objective[], depth: number) => {
      nodes.forEach((node) => {
        const children = childrenMap.get(node.id);
        const hasChildren = !!children && children.length > 0;
        result.push({ objective: node, depth, hasChildren });
        if (hasChildren && !collapsedIds.has(node.id)) {
          walk(children, depth + 1);
        }
      });
    };
    walk(roots, 0);
    return result;
  }, [objectives, search, collapsedIds]);

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between flex-shrink-0">
        <h2 className="text-lg font-semibold text-gray-900">Link to Objective</h2>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
          title="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-shrink-0">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search objectives..."
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          autoFocus
        />
      </div>

      {currentObjectiveId && (
        <button
          onClick={() => onSelect(todoId, null)}
          className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg border border-red-200 flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Remove link
        </button>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 border border-gray-200 rounded-lg bg-white">
        {objectiveTree.length === 0 ? (
          <p className="px-3 py-4 text-sm text-gray-400 text-center">No objectives found</p>
        ) : (
          <div className="py-1">
            {objectiveTree.map(({ objective: obj, depth, hasChildren }) => (
              <div
                key={obj.id}
                className={`flex items-center hover:bg-gray-50 ${currentObjectiveId === obj.id ? 'bg-blue-50' : ''}`}
                style={{ paddingLeft: `${8 + depth * 16}px` }}
              >
                {hasChildren ? (
                  <button
                    onClick={() => toggleCollapse(obj.id)}
                    className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-gray-400 hover:text-gray-600"
                  >
                    <svg className={`w-3 h-3 transition-transform ${collapsedIds.has(obj.id) ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ) : (
                  <span className="w-5 flex-shrink-0" />
                )}
                <button
                  onClick={() => onSelect(todoId, obj.id)}
                  className={`flex-1 text-left py-2 pr-3 pl-1 text-sm truncate ${currentObjectiveId === obj.id ? 'text-blue-700 font-medium' : 'text-gray-700'}`}
                >
                  {obj.title}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Todos Panel ──

interface TodosPanelProps {
  onStartTodo: (todoText: string) => void;
  linkingTodoId: string | null;
  onLinkTodo: (todoId: string | null) => void;
  onTodosChange: (todos: Todo[]) => void;
  todos: Todo[];
}

function TodosPanel({ onStartTodo, linkingTodoId, onLinkTodo, onTodosChange, todos }: TodosPanelProps) {
  const [newTodoText, setNewTodoText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editTodoText, setEditTodoText] = useState('');
  const dragItemRef = useRef<string | null>(null);
  const dragOverItemRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const objectives = useOKRStore((state: OKRStore) => state.objectives);

  const getObjectiveTitle = useCallback((objectiveId: string | null) => {
    if (!objectiveId) return null;
    const obj = objectives.find((o: Objective) => o.id === objectiveId);
    return obj?.title || null;
  }, [objectives]);

  const fetchTodos = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/todos`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        onTodosChange((data.todos || []).sort((a: Todo, b: Todo) => a.order - b.order));
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [onTodosChange]);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  const handleAddTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTodoText.trim();
    if (!trimmed) return;

    try {
      const response = await fetch(`${API_URL}/api/users/me/todos`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      if (response.ok) {
        const data = await response.json();
        onTodosChange((data.todos || []).sort((a: Todo, b: Todo) => a.order - b.order));
        setNewTodoText('');
      }
    } catch {
      // ignore
    }
  };

  const handleUpdateTodo = async (todoId: string) => {
    const trimmed = editTodoText.trim();
    if (!trimmed) return;

    try {
      const response = await fetch(`${API_URL}/api/users/me/todos/${todoId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      if (response.ok) {
        const data = await response.json();
        onTodosChange((data.todos || []).sort((a: Todo, b: Todo) => a.order - b.order));
        setEditingTodoId(null);
        setEditTodoText('');
      }
    } catch {
      // ignore
    }
  };

  const handleDeleteTodo = async (todoId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/todos/${todoId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        onTodosChange((data.todos || []).sort((a: Todo, b: Todo) => a.order - b.order));
      }
    } catch {
      // ignore
    }
  };

  const handleDragStart = (todoId: string) => {
    dragItemRef.current = todoId;
  };

  const handleDragOver = (e: React.DragEvent, todoId: string) => {
    e.preventDefault();
    dragOverItemRef.current = todoId;
    setDragOverId(todoId);
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverId(null);

    const dragId = dragItemRef.current;
    const dropId = dragOverItemRef.current;
    if (!dragId || !dropId || dragId === dropId) return;

    const newTodos = [...todos];
    const dragIndex = newTodos.findIndex(t => t.id === dragId);
    const dropIndex = newTodos.findIndex(t => t.id === dropId);
    if (dragIndex === -1 || dropIndex === -1) return;

    const [dragged] = newTodos.splice(dragIndex, 1);
    newTodos.splice(dropIndex, 0, dragged);
    onTodosChange(newTodos);

    const orderedIds = newTodos.map(t => t.id);
    try {
      const response = await fetch(`${API_URL}/api/users/me/todos/reorder`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
      if (response.ok) {
        const data = await response.json();
        onTodosChange((data.todos || []).sort((a: Todo, b: Todo) => a.order - b.order));
      }
    } catch {
      // ignore
    }

    dragItemRef.current = null;
    dragOverItemRef.current = null;
  };

  const handleDragEnd = () => {
    setDragOverId(null);
    dragItemRef.current = null;
    dragOverItemRef.current = null;
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Todos</h2>

      <form onSubmit={handleAddTodo} className="flex gap-2">
        <input
          type="text"
          value={newTodoText}
          onChange={(e) => setNewTodoText(e.target.value)}
          placeholder="Add a todo..."
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          type="submit"
          disabled={!newTodoText.trim()}
          className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Add
        </button>
      </form>

      {isLoading ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : todos.length === 0 ? (
        <p className="text-gray-500 text-sm">No todos yet.</p>
      ) : (
        <ul className="space-y-2">
          {todos.map((todo) => {
            if (editingTodoId === todo.id) {
              return (
                <li key={todo.id} className="p-3 bg-white border border-blue-300 rounded-lg space-y-2">
                  <input
                    type="text"
                    value={editTodoText}
                    onChange={(e) => setEditTodoText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateTodo(todo.id); if (e.key === 'Escape') { setEditingTodoId(null); setEditTodoText(''); } }}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUpdateTodo(todo.id)}
                      disabled={!editTodoText.trim()}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setEditingTodoId(null); setEditTodoText(''); }}
                      className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800 border border-gray-300 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              );
            }

            const linkedTitle = getObjectiveTitle(todo.objectiveId);

            return (
              <li
                key={todo.id}
                draggable
                onDragStart={() => handleDragStart(todo.id)}
                onDragOver={(e) => handleDragOver(e, todo.id)}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                className={`p-3 bg-white border rounded-lg cursor-grab active:cursor-grabbing transition-colors ${
                  linkingTodoId === todo.id ? 'border-blue-400 bg-blue-50' :
                  dragOverId === todo.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 6a2 2 0 112 0 2 2 0 01-2 0zm0 6a2 2 0 112 0 2 2 0 01-2 0zm0 6a2 2 0 112 0 2 2 0 01-2 0zm6-12a2 2 0 112 0 2 2 0 01-2 0zm0 6a2 2 0 112 0 2 2 0 01-2 0zm0 6a2 2 0 112 0 2 2 0 01-2 0z" />
                  </svg>
                  <span className="flex-1 text-sm text-gray-900 min-w-0 truncate">{todo.text}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => onLinkTodo(linkingTodoId === todo.id ? null : todo.id)}
                      className={`transition-colors ${todo.objectiveId ? 'text-blue-500 hover:text-blue-700' : 'text-gray-300 hover:text-blue-500'}`}
                      title={todo.objectiveId ? 'Change linked objective' : 'Link to objective'}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                    </button>
                    <button
                      onClick={() => onStartTodo(todo.text)}
                      className="text-green-500 hover:text-green-700 transition-colors"
                      title="Start working"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => { setEditingTodoId(todo.id); setEditTodoText(todo.text); }}
                      className="text-gray-300 hover:text-blue-500 transition-colors"
                      title="Edit"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteTodo(todo.id)}
                      className="text-gray-300 hover:text-red-500 transition-colors"
                      title="Delete"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                {linkedTitle && (
                  <div className="mt-1.5 ml-6 flex items-center gap-1">
                    <svg className="w-3 h-3 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <span className="text-xs text-blue-600 truncate">{linkedTitle}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Work Log Panel ──

interface WorkLogPanelProps {
  workLogs: WorkLogEntry[];
  onWorkLogsChange: (logs: WorkLogEntry[]) => void;
}

function WorkLogPanel({ workLogs, onWorkLogsChange }: WorkLogPanelProps) {
  const [message, setMessage] = useState('');
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
        onWorkLogsChange(data.workLogs || []);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [onWorkLogsChange]);

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
        onWorkLogsChange(data.workLogs || []);
        setMessage('');
      }
    } catch {
      // ignore
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStop = async (entry: WorkLogEntry) => {
    const now = new Date();
    const startDate = new Date(entry.startTime!);
    const diffMs = now.getTime() - startDate.getTime();
    const timeSpentMinutes = Math.round(diffMs / 60000);

    try {
      const response = await fetch(`${API_URL}/api/users/me/worklogs/${entry.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endTime: now.toISOString(),
          timeSpentMinutes,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        onWorkLogsChange(data.workLogs || []);
      }
    } catch {
      // ignore
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
        onWorkLogsChange(data.workLogs || []);
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
        onWorkLogsChange(data.workLogs || []);
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

  const isInProgress = (entry: WorkLogEntry) => entry.startTime && !entry.endTime;

  const sorted = [...workLogs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Log Work</h2>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What are you working on?"
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          disabled={isSubmitting}
        />
        <button
          type="submit"
          disabled={!message.trim() || isSubmitting}
          className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Saving...' : 'Submit'}
        </button>
      </form>

      {isLoading ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : sorted.length === 0 ? (
        <p className="text-gray-500 text-sm">No work logged yet.</p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((entry) => {
            if (editingId === entry.id) {
              return (
                <li key={entry.id} className="p-3 bg-white border border-blue-300 rounded-lg space-y-3">
                  <input
                    type="text"
                    value={editMessage}
                    onChange={(e) => setEditMessage(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs text-gray-600">Time spent:</label>
                    <input
                      type="number"
                      min="0"
                      value={editSpentHours}
                      onChange={(e) => setEditSpentHours(e.target.value)}
                      placeholder="0"
                      className="w-14 px-2 py-1 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
                    />
                    <span className="text-xs text-gray-500">h</span>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={editSpentMinutes}
                      onChange={(e) => setEditSpentMinutes(e.target.value)}
                      placeholder="0"
                      className="w-14 px-2 py-1 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
                    />
                    <span className="text-xs text-gray-500">m</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs text-gray-600">Start:</label>
                    <input
                      type="datetime-local"
                      value={editStartTime}
                      onChange={(e) => setEditStartTime(e.target.value)}
                      className="px-2 py-1 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <label className="text-xs text-gray-600">End:</label>
                    <input
                      type="datetime-local"
                      value={editEndTime}
                      onChange={(e) => setEditEndTime(e.target.value)}
                      className="px-2 py-1 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUpdate(entry.id)}
                      disabled={!editMessage.trim()}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelEditing}
                      className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800 border border-gray-300 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              );
            }

            const inProgress = isInProgress(entry);
            const range = formatTimeRange(entry);
            return (
              <li
                key={entry.id}
                className={`flex items-start justify-between gap-2 p-3 bg-white border rounded-lg ${
                  inProgress ? 'border-green-300 bg-green-50' : 'border-gray-200'
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm text-gray-900">{entry.message}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {inProgress && (
                      <span className="text-xs font-medium text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                        In Progress
                      </span>
                    )}
                    <p className="text-xs text-gray-400" title={new Date(entry.createdAt).toLocaleString()}>
                      {formatRelative(entry.createdAt)}
                    </p>
                    {inProgress && entry.startTime && (
                      <span className="text-xs text-gray-500">
                        started {formatTime(entry.startTime)}
                      </span>
                    )}
                    {entry.timeSpentMinutes != null && (
                      <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                        {formatDuration(entry.timeSpentMinutes)}
                      </span>
                    )}
                    {range && (
                      <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                        {range.start} – {range.end} ({range.duration})
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                  {inProgress && (
                    <button
                      onClick={() => handleStop(entry)}
                      className="text-red-500 hover:text-red-700 transition-colors"
                      title="Stop"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="6" y="6" width="12" height="12" rx="1" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => startEditing(entry)}
                    className="text-gray-300 hover:text-blue-500 transition-colors"
                    title="Edit"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors"
                    title="Delete"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

// ── Main Page ──

export function LogWorkPage() {
  const [workLogs, setWorkLogs] = useState<WorkLogEntry[]>([]);
  const [linkingTodoId, setLinkingTodoId] = useState<string | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);

  const handleStartTodo = async (todoText: string) => {
    const now = new Date().toISOString();
    try {
      const response = await fetch(`${API_URL}/api/users/me/worklogs`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Starting: ${todoText}`,
          startTime: now,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        setWorkLogs(data.workLogs || []);
      }
    } catch {
      // ignore
    }
  };

  const handleLinkObjective = async (todoId: string, objectiveId: string | null) => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/todos/${todoId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectiveId }),
      });
      if (response.ok) {
        const data = await response.json();
        setTodos((data.todos || []).sort((a: Todo, b: Todo) => a.order - b.order));
      }
    } catch {
      // ignore
    }
    setLinkingTodoId(null);
  };

  const linkingTodo = linkingTodoId ? todos.find(t => t.id === linkingTodoId) : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <TodosPanel
        onStartTodo={handleStartTodo}
        linkingTodoId={linkingTodoId}
        onLinkTodo={setLinkingTodoId}
        onTodosChange={setTodos}
        todos={todos}
      />
      {linkingTodo ? (
        <ObjectivePicker
          todoId={linkingTodo.id}
          currentObjectiveId={linkingTodo.objectiveId}
          onSelect={handleLinkObjective}
          onClose={() => setLinkingTodoId(null)}
        />
      ) : (
        <WorkLogPanel workLogs={workLogs} onWorkLogsChange={setWorkLogs} />
      )}
    </div>
  );
}
