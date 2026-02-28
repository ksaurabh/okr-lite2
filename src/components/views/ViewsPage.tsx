import { useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import type { SavedView } from '../../types';

type View = 'dashboard' | 'objectives' | 'views' | 'checklist' | 'progress' | 'updates' | 'lists' | 'logwork' | 'teams' | 'periods' | 'tags' | 'settings' | 'admin' | 'logs';

interface ViewsPageProps {
  onViewChange: (view: View) => void;
}

export function ViewsPage({ onViewChange }: ViewsPageProps) {
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [newViewIsDefault, setNewViewIsDefault] = useState(false);

  const savedViews = useOKRStore((state: OKRStore) => state.savedViews);
  const activeViewId = useOKRStore((state: OKRStore) => state.activeViewId);
  const deleteView = useOKRStore((state: OKRStore) => state.deleteView);
  const applyView = useOKRStore((state: OKRStore) => state.applyView);
  const setDefaultView = useOKRStore((state: OKRStore) => state.setDefaultView);
  const renameView = useOKRStore((state: OKRStore) => state.renameView);
  const toggleViewStarred = useOKRStore((state: OKRStore) => state.toggleViewStarred);
  const createView = useOKRStore((state: OKRStore) => state.createView);

  const handleRename = async (viewId: string) => {
    if (editingName.trim() && editingName.trim() !== savedViews.find(v => v.id === viewId)?.name) {
      await renameView(viewId, editingName.trim());
    }
    setEditingViewId(null);
    setEditingName('');
  };

  const handleDelete = async (viewId: string) => {
    if (confirm('Are you sure you want to delete this view?')) {
      await deleteView(viewId);
    }
  };

  const handleApplyView = (viewId: string) => {
    applyView(viewId);
    onViewChange('objectives');
  };

  const handleCreateView = async () => {
    if (!newViewName.trim()) return;
    await createView(newViewName.trim(), newViewIsDefault);
    setNewViewName('');
    setNewViewIsDefault(false);
    setShowCreateForm(false);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Views</h1>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New View
        </button>
      </div>

      {/* Create View Form */}
      {showCreateForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <h3 className="text-sm font-medium text-gray-900 mb-3">Save Current Filters as View</h3>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              placeholder="View name..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateView();
                if (e.key === 'Escape') { setShowCreateForm(false); setNewViewName(''); }
              }}
            />
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <input
                type="checkbox"
                checked={newViewIsDefault}
                onChange={(e) => setNewViewIsDefault(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Default
            </label>
            <button
              onClick={() => { setShowCreateForm(false); setNewViewName(''); setNewViewIsDefault(false); }}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateView}
              disabled={!newViewName.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Views List */}
      {savedViews.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <p className="text-lg font-medium">No saved views</p>
          <p className="text-sm mt-1">Save your current filter settings as a view from the Objectives page, or click "New View" above.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-100">
            {savedViews.map((view: SavedView) => (
              <div
                key={view.id}
                className={`flex items-center justify-between px-4 py-3 hover:bg-gray-50 group ${
                  activeViewId === view.id ? 'bg-blue-50' : ''
                }`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* Star toggle */}
                  <button
                    onClick={() => toggleViewStarred(view.id)}
                    className={`p-1 flex-shrink-0 ${
                      view.starred
                        ? 'text-yellow-500 hover:text-yellow-600'
                        : 'text-gray-300 hover:text-yellow-500'
                    }`}
                    title={view.starred ? 'Unstar' : 'Star'}
                  >
                    <svg className="w-5 h-5" fill={view.starred ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                  </button>

                  {/* View name (inline editable) */}
                  {editingViewId === view.id ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => handleRename(view.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(view.id);
                        if (e.key === 'Escape') { setEditingViewId(null); setEditingName(''); }
                      }}
                      className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => handleApplyView(view.id)}
                      className="text-sm font-medium text-gray-900 hover:text-blue-600 truncate text-left"
                      title="Click to open this view"
                    >
                      {view.name}
                    </button>
                  )}

                  {/* Badges */}
                  {view.isDefault && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded flex-shrink-0">Default</span>
                  )}
                  {activeViewId === view.id && (
                    <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded flex-shrink-0">Active</span>
                  )}

                  {/* Date */}
                  <span className="text-xs text-gray-400 flex-shrink-0 ml-auto mr-2">
                    Updated {formatDate(view.updatedAt)}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100">
                  {/* Rename */}
                  <button
                    onClick={() => { setEditingViewId(view.id); setEditingName(view.name); }}
                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded"
                    title="Rename"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  {/* Set as default */}
                  {!view.isDefault && (
                    <button
                      onClick={() => setDefaultView(view.id)}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-200 rounded"
                      title="Set as default"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                  )}
                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(view.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-gray-200 rounded"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
