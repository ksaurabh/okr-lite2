import { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import type { MindmapView, MindmapGroup, MindmapFrame } from './types';

const API_URL = import.meta.env.VITE_API_URL || '';

function newViewId() { return `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; }

interface Props {
  initialViews: MindmapView[];
  frames: MindmapFrame[];
  boardTags: string[];
  onSave: (views: MindmapView[]) => void;
  onClose: () => void;
}

// Create/edit per-mindmap views: a named tag filter (include or exclude) granted
// to user groups. Members of a granted group see only that view's notes.
export function ManageViewsModal({ initialViews, frames, boardTags, onSave, onClose }: Props) {
  const [views, setViews] = useState<MindmapView[]>(initialViews);
  const [groups, setGroups] = useState<MindmapGroup[]>([]);
  const [editing, setEditing] = useState<MindmapView | null>(null);
  const [defaultViewId, setDefaultViewId] = useState<string | null>(
    initialViews.find(v => v.isDefault)?.id || null
  );

  const frameName = (id: string) => frames.find(f => f.id === id)?.name || 'frame';

  // Ensure "Everything" view exists on load and is default if no default is set
  useEffect(() => {
    const everythingView = views.find(v => v.name === 'Everything');
    const hasDefault = views.some(v => v.isDefault);

    if (!everythingView) {
      const newEverythingView: MindmapView = {
        id: newViewId(),
        name: 'Everything',
        mode: 'exclude',
        frameIds: [],
        tags: [],
        groupIds: [],
        isDefault: !hasDefault,
      };
      setViews(prev => [...prev, newEverythingView]);
      if (!hasDefault) setDefaultViewId(newEverythingView.id);
    } else if (!hasDefault) {
      // If Everything exists but no default, make Everything the default
      setViews(prev => prev.map(v => v.id === everythingView.id ? { ...v, isDefault: true } : v));
      setDefaultViewId(everythingView.id);
    }
  }, []); // Run once on mount

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`${API_URL}/api/groups`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : { groups: [] }))
        .then(d => { if (!cancelled) setGroups(d.groups || []); })
        .catch(() => { if (!cancelled) setGroups([]); });
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const groupName = (id: string) => groups.find(g => g.id === id)?.name || 'group';

  const startAdd = () => setEditing({ id: newViewId(), name: '', mode: 'exclude', frameIds: [], tags: [], groupIds: [], isDefault: false });
  const startEdit = (v: MindmapView) => setEditing({ ...v, frameIds: [...(v.frameIds || [])], tags: [...(v.tags || [])], groupIds: [...v.groupIds], isDefault: v.isDefault || false });

  const setAsDefault = (id: string) => {
    setViews(prev => prev.map(v => ({ ...v, isDefault: v.id === id })));
    setDefaultViewId(id);
  };

  const removeView = (id: string) => {
    const viewToRemove = views.find(v => v.id === id);
    if (viewToRemove?.name === 'Everything') return; // Don't allow deleting Everything view
    setViews(prev => prev.filter(v => v.id !== id));
    if (defaultViewId === id) {
      // If removing the default, make Everything the new default
      const everythingView = views.find(v => v.name === 'Everything');
      if (everythingView) {
        setViews(prev => prev.map(v => v.id === everythingView.id ? { ...v, isDefault: true } : v));
        setDefaultViewId(everythingView.id);
      }
    }
  };

  const commitEditing = () => {
    if (!editing) return;
    const name = editing.name.trim() || 'Untitled view';
    const clean = { ...editing, name };
    setViews(prev => {
      const updated = prev.some(v => v.id === clean.id)
        ? prev.map(v => (v.id === clean.id ? clean : v))
        : [...prev, clean];
      // Ensure only one view is marked as default
      const hasDefault = updated.some(v => v.isDefault);
      if (!hasDefault) {
        const everythingView = updated.find(v => v.name === 'Everything');
        if (everythingView) {
          return updated.map(v => v.id === everythingView.id ? { ...v, isDefault: true } : v);
        }
      }
      return updated;
    });
    setEditing(null);
  };

  const toggleFrame = (id: string) => setEditing(e => e && ({ ...e, frameIds: e.frameIds.includes(id) ? e.frameIds.filter(x => x !== id) : [...e.frameIds, id] }));
  const toggleTag = (t: string) => setEditing(e => e && ({ ...e, tags: e.tags.includes(t) ? e.tags.filter(x => x !== t) : [...e.tags, t] }));
  const toggleGroup = (id: string) => setEditing(e => e && ({ ...e, groupIds: e.groupIds.includes(id) ? e.groupIds.filter(x => x !== id) : [...e.groupIds, id] }));

  return (
    <Modal isOpen onClose={onClose} title="Views & access">
      {editing ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">View name</label>
            <input
              autoFocus
              value={editing.name}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g. Engineering"
              className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <div className="text-sm text-gray-600 mb-1">Notes to show</div>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={editing.mode === 'include'} onChange={() => setEditing({ ...editing, mode: 'include' })} />
                Only the selected frames/tags
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={editing.mode === 'exclude'} onChange={() => setEditing({ ...editing, mode: 'exclude' })} />
                Everything except them
              </label>
            </div>
          </div>

          <div>
            <div className="text-sm text-gray-600 mb-1">Frames</div>
            {frames.length === 0 ? (
              <div className="text-xs text-gray-400">No frames on this board yet. Create frames to group notes.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {frames.map(f => (
                  <button
                    key={f.id}
                    onClick={() => toggleFrame(f.id)}
                    className={`text-xs rounded px-2 py-0.5 border ${editing.frameIds.includes(f.id) ? 'bg-indigo-50 text-indigo-700 border-indigo-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-sm text-gray-600 mb-1">Tags <span className="text-xs text-gray-400 font-normal">(optional)</span></div>
            {boardTags.length === 0 ? (
              <div className="text-xs text-gray-400">No tags on this board.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {boardTags.map(t => (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    className={`text-xs rounded-full px-2 py-0.5 border ${editing.tags.includes(t) ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-sm text-gray-600 mb-1">Grant to groups</div>
            {groups.length === 0 ? (
              <div className="text-xs text-gray-400">No groups yet. An admin can create groups in Settings.</div>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                {groups.map(g => (
                  <label key={g.id} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={editing.groupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} className="rounded border-gray-300" />
                    {g.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={commitEditing}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Members of a group granted a view see only that view’s notes when they open this mindmap. People not in any granted group see the whole board.
          </p>
          <div className="border border-gray-100 rounded divide-y divide-gray-100">
            {views.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400">No views yet.</div>
            ) : views.map(v => (
              <div key={v.id} className="px-3 py-2 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-gray-800">{v.name}</div>
                    {v.isDefault && (
                      <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Default</span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {v.mode === 'include' ? 'Only' : 'Except'}: {[
                      ...(v.frameIds || []).map(frameName),
                      ...(v.tags || []),
                    ].join(', ') || '—'}
                    {' · '}
                    {v.groupIds.length ? v.groupIds.map(groupName).join(', ') : 'no groups'}
                  </div>
                </div>
                {!v.isDefault && (
                  <button
                    onClick={() => setAsDefault(v.id)}
                    className="text-xs text-gray-500 hover:text-blue-600 px-1.5"
                    title="Set as default view"
                  >
                    Set default
                  </button>
                )}
                <button onClick={() => startEdit(v)} className="text-xs text-gray-500 hover:text-blue-600 px-1.5">Edit</button>
                {v.name !== 'Everything' && (
                  <button onClick={() => removeView(v.id)} className="text-xs text-gray-500 hover:text-red-600 px-1.5">Delete</button>
                )}
              </div>
            ))}
          </div>
          <button onClick={startAdd} className="text-sm text-blue-600 hover:underline">+ Add view</button>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => { onSave(views); onClose(); }}>Save</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
