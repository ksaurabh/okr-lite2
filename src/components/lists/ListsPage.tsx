import { useState, useEffect, useCallback, useRef } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import type { Objective, User, WorkflowStatus } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';

type View = 'dashboard' | 'objectives' | 'checklist' | 'progress' | 'updates' | 'lists' | 'logwork' | 'teams' | 'periods' | 'tags' | 'settings' | 'admin';

interface ListsPageProps {
  onViewChange: (view: View) => void;
}

const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  todo: 'To Do',
  planning: 'In Planning',
  in_progress: 'In Progress',
  acceptance: 'In Acceptance',
  done: 'Done',
  archived: 'Archived',
};

const LIST_COLORS = [
  '#6b7280', // gray
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
];

const LIST_COLUMN_WIDTHS_KEY = 'okr-list-column-widths';

interface ListColumnWidths {
  name: number;
  parent: number;
  owner: number;
  assignee: number;
  status: number;
}

const DEFAULT_LIST_COLUMN_WIDTHS: ListColumnWidths = {
  name: 300,
  parent: 200,
  owner: 150,
  assignee: 150,
  status: 120,
};

function loadListColumnWidths(): ListColumnWidths {
  try {
    const data = localStorage.getItem(LIST_COLUMN_WIDTHS_KEY);
    if (data) {
      return { ...DEFAULT_LIST_COLUMN_WIDTHS, ...JSON.parse(data) };
    }
  } catch {
    // ignore
  }
  return DEFAULT_LIST_COLUMN_WIDTHS;
}

function saveListColumnWidths(widths: ListColumnWidths): void {
  try {
    localStorage.setItem(LIST_COLUMN_WIDTHS_KEY, JSON.stringify(widths));
  } catch {
    // ignore
  }
}

export function ListsPage({ onViewChange }: ListsPageProps) {
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [newListName, setNewListName] = useState('');
  const [newListColor, setNewListColor] = useState(LIST_COLORS[0]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingColorListId, setEditingColorListId] = useState<string | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [isListsCollapsed, setIsListsCollapsed] = useState(false);
  const [columnWidths, setColumnWidths] = useState<ListColumnWidths>(loadListColumnWidths);
  const [resizingColumn, setResizingColumn] = useState<keyof ListColumnWidths | null>(null);
  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(0);

  const lists = useOKRStore((state: OKRStore) => state.lists);
  const objectives = useOKRStore((state: OKRStore) => state.objectives);
  const fetchLists = useOKRStore((state: OKRStore) => state.fetchLists);
  const createList = useOKRStore((state: OKRStore) => state.createList);
  const deleteList = useOKRStore((state: OKRStore) => state.deleteList);
  const renameList = useOKRStore((state: OKRStore) => state.renameList);
  const updateListColor = useOKRStore((state: OKRStore) => state.updateListColor);
  const removeItemFromList = useOKRStore((state: OKRStore) => state.removeItemFromList);
  const reorderListItems = useOKRStore((state: OKRStore) => state.reorderListItems);
  const setFilterObjective = useOKRStore((state: OKRStore) => state.setFilterObjective);
  const clearAllFilters = useOKRStore((state: OKRStore) => state.clearAllFilters);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  // Fetch users for owner/assignee display
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch(`${API_URL}/api/users`, { credentials: 'include' });
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

  // Column resize handlers
  const handleResizeStart = useCallback((column: keyof ListColumnWidths, e: React.MouseEvent) => {
    e.preventDefault();
    setResizingColumn(column);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = columnWidths[column];
  }, [columnWidths]);

  useEffect(() => {
    if (!resizingColumn) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      const newWidth = Math.max(100, resizeStartWidth.current + delta);
      setColumnWidths(prev => {
        const updated = { ...prev, [resizingColumn]: newWidth };
        saveListColumnWidths(updated);
        return updated;
      });
    };

    const handleMouseUp = () => {
      setResizingColumn(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn]);

  const selectedList = lists.find(l => l.id === selectedListId);

  const handleCreateList = async () => {
    if (!newListName.trim()) return;
    const list = await createList(newListName.trim(), newListColor);
    if (list) {
      setNewListName('');
      setNewListColor(LIST_COLORS[0]);
      setIsCreating(false);
      setSelectedListId(list.id);
    }
  };

  const handleColorChange = async (listId: string, color: string) => {
    await updateListColor(listId, color);
    setEditingColorListId(null);
  };

  const handleDeleteList = async (listId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this list?')) {
      await deleteList(listId);
      if (selectedListId === listId) {
        setSelectedListId(null);
      }
    }
  };

  const handleRenameList = async () => {
    if (!editingListId || !editingName.trim()) return;
    await renameList(editingListId, editingName.trim());
    setEditingListId(null);
    setEditingName('');
  };

  const handleRemoveItem = async (objectiveId: string) => {
    if (!selectedListId) return;
    await removeItemFromList(selectedListId, objectiveId);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, objectiveId: string) => {
    setDraggedItemId(objectiveId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetObjectiveId: string) => {
    e.preventDefault();
    if (!draggedItemId || !selectedList || draggedItemId === targetObjectiveId) {
      setDraggedItemId(null);
      return;
    }

    const items = [...selectedList.items];
    const draggedIndex = items.findIndex(i => i.objectiveId === draggedItemId);
    const targetIndex = items.findIndex(i => i.objectiveId === targetObjectiveId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedItemId(null);
      return;
    }

    // Remove dragged item and insert at target position
    const [draggedItem] = items.splice(draggedIndex, 1);
    items.splice(targetIndex, 0, draggedItem);

    // Update order values
    const reorderedItems = items.map((item, index) => ({
      objectiveId: item.objectiveId,
      order: index,
    }));

    await reorderListItems(selectedListId!, reorderedItems);
    setDraggedItemId(null);
  };

  const handleDragEnd = () => {
    setDraggedItemId(null);
  };

  const getObjective = useCallback((objectiveId: string): Objective | undefined => {
    return objectives.find(o => o.id === objectiveId);
  }, [objectives]);

  const getUserName = useCallback((userId: string | undefined): string => {
    if (!userId) return '-';
    const user = orgUsers.find(u => u.id === userId);
    return user?.name || '-';
  }, [orgUsers]);

  const handleNavigateToObjective = useCallback((objectiveId: string) => {
    clearAllFilters();
    setFilterObjective(objectiveId);
    onViewChange('objectives');
  }, [clearAllFilters, setFilterObjective, onViewChange]);

  // Sort items by order
  const sortedItems = selectedList?.items
    ? [...selectedList.items].sort((a, b) => a.order - b.order)
    : [];

  return (
    <div className="flex h-full">
      {/* Lists sidebar */}
      <div className={`border-r border-gray-200 bg-gray-50 flex flex-col h-full max-h-full transition-all duration-200 ${isListsCollapsed ? 'w-12' : 'w-64'}`}>
        {isListsCollapsed ? (
          /* Collapsed sidebar */
          <div className="flex flex-col items-center py-4">
            <button
              onClick={() => setIsListsCollapsed(false)}
              className="p-2 text-gray-400 hover:text-gray-600 rounded"
              title="Expand sidebar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        ) : (
          /* Expanded sidebar */
          <>
            <div className="p-4 border-b border-gray-200 flex-shrink-0 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Lists</h2>
              <button
                onClick={() => setIsListsCollapsed(true)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
                title="Collapse sidebar"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>

            {/* New List button at top */}
            <div className="p-2 border-b border-gray-200 flex-shrink-0">
              {isCreating ? (
                <div className="p-2 bg-white rounded-md border border-gray-200">
                  <input
                    type="text"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateList();
                      if (e.key === 'Escape') {
                        setIsCreating(false);
                        setNewListName('');
                        setNewListColor(LIST_COLORS[0]);
                      }
                    }}
                    placeholder="List name"
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    autoFocus
                  />
                  <div className="flex items-center gap-1 mt-2">
                    {LIST_COLORS.map(color => (
                      <button
                        key={color}
                        onClick={() => setNewListColor(color)}
                        className={`w-5 h-5 rounded-full border-2 ${newListColor === color ? 'border-gray-800' : 'border-transparent'}`}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      onClick={() => {
                        setIsCreating(false);
                        setNewListName('');
                        setNewListColor(LIST_COLORS[0]);
                      }}
                      className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateList}
                      disabled={!newListName.trim()}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      Create
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsCreating(true)}
                  className="w-full px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-md flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New List
                </button>
              )}
            </div>

            {/* Scrollable list of lists */}
            <div className="flex-1 overflow-auto p-2 min-h-0">
              {lists.length === 0 ? (
                <p className="text-sm text-gray-500 p-2">No lists yet</p>
              ) : (
                <div className="space-y-1">
                  {lists.map(list => (
                    <div
                      key={list.id}
                      onClick={() => setSelectedListId(list.id)}
                      className={`flex items-center justify-between px-3 py-2 rounded-md cursor-pointer group ${
                        selectedListId === list.id
                          ? 'bg-blue-100 text-blue-800'
                          : 'hover:bg-gray-100 text-gray-700'
                      }`}
                    >
                      {editingListId === list.id ? (
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={handleRenameList}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameList();
                            if (e.key === 'Escape') {
                              setEditingListId(null);
                              setEditingName('');
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 px-1 py-0.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                          autoFocus
                        />
                      ) : (
                        <>
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingColorListId(editingColorListId === list.id ? null : list.id);
                              }}
                              className="w-3 h-3 rounded-full mr-2 flex-shrink-0"
                              style={{ backgroundColor: list.color || '#6b7280' }}
                              title="Change color"
                            />
                            {editingColorListId === list.id && (
                              <div
                                className="absolute left-0 top-5 z-10 bg-white rounded-md shadow-lg border border-gray-200 p-1.5 flex gap-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {LIST_COLORS.map(color => (
                                  <button
                                    key={color}
                                    onClick={() => handleColorChange(list.id, color)}
                                    className={`w-5 h-5 rounded-full border-2 ${list.color === color ? 'border-gray-800' : 'border-transparent hover:border-gray-400'}`}
                                    style={{ backgroundColor: color }}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                          <span className="text-sm truncate flex-1">{list.name}</span>
                          <span className="text-xs text-gray-500 mr-2">{list.items.length}</span>
                          <div className="hidden group-hover:flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingListId(list.id);
                                setEditingName(list.name);
                              }}
                              className="p-1 text-gray-400 hover:text-gray-600"
                              title="Rename"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => handleDeleteList(list.id, e)}
                              className="p-1 text-gray-400 hover:text-red-600"
                              title="Delete"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* List content */}
      <div className="flex-1 overflow-auto">
        {selectedList ? (
          <div className="p-4">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{selectedList.name}</h2>

            {sortedItems.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p>No items in this list</p>
                <p className="text-sm mt-1">Add items from the Objectives page using the bookmark icon</p>
              </div>
            ) : (
              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="w-8 py-2"></th>
                    <th className="w-8 py-2 text-xs font-medium text-gray-500 text-left">#</th>
                    <th className="py-2 pl-2 text-xs font-medium text-gray-500 text-left relative" style={{ width: columnWidths.name }}>
                      Name
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group"
                        onMouseDown={(e) => handleResizeStart('name', e)}
                      >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-300 group-hover:bg-blue-400" />
                      </div>
                    </th>
                    <th className="py-2 pl-3 text-xs font-medium text-gray-500 text-left relative" style={{ width: columnWidths.parent }}>
                      Parent
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group"
                        onMouseDown={(e) => handleResizeStart('parent', e)}
                      >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-300 group-hover:bg-blue-400" />
                      </div>
                    </th>
                    <th className="py-2 pl-3 text-xs font-medium text-gray-500 text-left relative" style={{ width: columnWidths.owner }}>
                      Owner
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group"
                        onMouseDown={(e) => handleResizeStart('owner', e)}
                      >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-300 group-hover:bg-blue-400" />
                      </div>
                    </th>
                    <th className="py-2 pl-3 text-xs font-medium text-gray-500 text-left relative" style={{ width: columnWidths.assignee }}>
                      Assignee
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group"
                        onMouseDown={(e) => handleResizeStart('assignee', e)}
                      >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-300 group-hover:bg-blue-400" />
                      </div>
                    </th>
                    <th className="py-2 pl-3 text-xs font-medium text-gray-500 text-left relative" style={{ width: columnWidths.status }}>
                      Status
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group"
                        onMouseDown={(e) => handleResizeStart('status', e)}
                      >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-300 group-hover:bg-blue-400" />
                      </div>
                    </th>
                    <th className="w-8 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item, index) => {
                    const objective = getObjective(item.objectiveId);
                    if (!objective) return null;
                    const parentObjective = objective.parentId ? getObjective(objective.parentId) : null;

                    return (
                      <tr
                        key={item.objectiveId}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.objectiveId)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, item.objectiveId)}
                        onDragEnd={handleDragEnd}
                        className={`border-b border-gray-100 hover:bg-gray-50 cursor-move ${
                          draggedItemId === item.objectiveId ? 'opacity-50' : ''
                        }`}
                      >
                        <td className="py-2 px-1">
                          <div className="text-gray-400 cursor-grab active:cursor-grabbing">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                            </svg>
                          </div>
                        </td>
                        <td className="py-2 text-xs text-gray-400">{index + 1}</td>
                        <td className="py-2 pl-2 pr-4 overflow-hidden" style={{ width: columnWidths.name }}>
                          <button
                            onClick={() => handleNavigateToObjective(objective.id)}
                            className="text-sm text-blue-600 hover:text-blue-800 hover:underline truncate block text-left w-full"
                            title={`Go to ${objective.title}`}
                          >
                            {objective.title}
                          </button>
                        </td>
                        <td className="py-2 pl-3 pr-4 overflow-hidden" style={{ width: columnWidths.parent }}>
                          {parentObjective ? (
                            <button
                              onClick={() => handleNavigateToObjective(parentObjective.id)}
                              className="text-sm text-blue-600 hover:text-blue-800 hover:underline truncate block text-left w-full"
                              title={`Go to ${parentObjective.title}`}
                            >
                              {parentObjective.title}
                            </button>
                          ) : (
                            <span className="text-sm text-gray-500 truncate block">-</span>
                          )}
                        </td>
                        <td className="py-2 pl-3 pr-4 overflow-hidden" style={{ width: columnWidths.owner }}>
                          <span className="text-sm text-gray-500 truncate block">{getUserName(objective.ownerId)}</span>
                        </td>
                        <td className="py-2 pl-3 pr-4 overflow-hidden" style={{ width: columnWidths.assignee }}>
                          <span className="text-sm text-gray-500 truncate block">{getUserName(objective.assigneeId)}</span>
                        </td>
                        <td className="py-2 pl-3 pr-4 overflow-hidden" style={{ width: columnWidths.status }}>
                          <span className="text-sm text-gray-500 truncate block">{WORKFLOW_STATUS_LABELS[objective.workflowStatus || 'todo']}</span>
                        </td>
                        <td className="py-2 px-1">
                          <button
                            onClick={() => handleRemoveItem(item.objectiveId)}
                            className="p-1 text-gray-400 hover:text-red-600"
                            title="Remove from list"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              <p className="text-lg font-medium">Select a list</p>
              <p className="text-sm mt-1">Choose a list from the sidebar or create a new one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
