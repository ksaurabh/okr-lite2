import { useEffect, useMemo, useState } from 'react';
import type { MindmapFolder, MindmapListItem } from './types';
import { navigateTo } from './nav';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

const API_URL = import.meta.env.VITE_API_URL || '';

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// In-app text-entry modal (replaces window.prompt).
function TextPromptModal({ title, label, initial, submitLabel, onSubmit, onClose }: {
  title: string; label: string; initial: string; submitLabel: string;
  onSubmit: (value: string) => void; onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Modal isOpen onClose={onClose} title={title}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">{label}</label>
          <input
            type="text"
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSubmit(value); }}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit(value)}>{submitLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}

// In-app confirmation modal (replaces window.confirm).
function ConfirmModal({ title, message, confirmLabel, onConfirm, onClose }: {
  title: string; message: string; confirmLabel: string; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal isOpen onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}

// Folders come back as a flat list; these two walk it as a tree.
function childFolders(folders: MindmapFolder[], parentId: string | null): MindmapFolder[] {
  return folders
    .filter(f => (f.parentId || null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Depth-first order with a depth per row, for indented rendering and pickers.
function flattenFolders(folders: MindmapFolder[], parentId: string | null = null, depth = 0): Array<{ folder: MindmapFolder; depth: number }> {
  return childFolders(folders, parentId).flatMap(f => [
    { folder: f, depth },
    ...flattenFolders(folders, f.id, depth + 1),
  ]);
}

// A folder and everything under it — a map selected in a parent folder should
// still show when you're looking at an ancestor.
function subtreeIds(folders: MindmapFolder[], rootId: string): Set<string> {
  const out = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

// Picks a destination folder (or "top level" / "no folder"). `excludeIds` hides
// destinations that would create a cycle when moving a folder.
function FolderPickerModal({ title, label, folders, initial, rootLabel, excludeIds, submitLabel, onSubmit, onClose }: {
  title: string; label: string; folders: MindmapFolder[]; initial: string | null; rootLabel: string;
  excludeIds?: Set<string>; submitLabel: string;
  onSubmit: (folderId: string | null) => void; onClose: () => void;
}) {
  const [value, setValue] = useState<string>(initial || '');
  const rows = flattenFolders(folders).filter(r => !excludeIds?.has(r.folder.id));
  return (
    <Modal isOpen onClose={onClose} title={title}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">{label}</label>
          <select
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{rootLabel}</option>
            {rows.map(({ folder, depth }) => (
              <option key={folder.id} value={folder.id}>{`${'  '.repeat(depth)}${folder.name}`}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit(value || null)}>{submitLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}

type PromptState =
  | { mode: 'create' }
  | { mode: 'rename'; item: MindmapListItem }
  | { mode: 'createFolder'; parentId: string | null }
  | { mode: 'renameFolder'; folder: MindmapFolder }
  | null;

type PickerState =
  | { mode: 'moveMindmap'; item: MindmapListItem }
  | { mode: 'moveFolder'; folder: MindmapFolder }
  | null;

// What the folder sidebar has selected: everything, only unfiled maps, or one
// folder (which includes its descendants).
type FolderSelection = { kind: 'all' } | { kind: 'unfiled' } | { kind: 'folder'; id: string };

export function MindmapsPage() {
  const [items, setItems] = useState<MindmapListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [ownerFilter, setOwnerFilter] = useState(''); // creatorEmail or ''
  const [starredOnly, setStarredOnly] = useState(false);
  const [search, setSearch] = useState('');

  const [folders, setFolders] = useState<MindmapFolder[]>([]);
  const [selection, setSelection] = useState<FolderSelection>({ kind: 'all' });

  const [prompt, setPrompt] = useState<PromptState>(null);
  const [picker, setPicker] = useState<PickerState>(null);
  const [confirmDelete, setConfirmDelete] = useState<MindmapListItem | null>(null);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<MindmapFolder | null>(null);

  // Auto-dismiss the error banner.
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(t);
  }, [banner]);

  const load = () => {
    setLoading(true);
    fetch(`${API_URL}/api/mindmaps`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Failed to load mindmaps'))))
      .then(d => { setItems(d.mindmaps || []); setFolders(d.folders || []); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Owner options = distinct creators present in the returned list. The current
  // user's own entry is labeled "(me)".
  const owners = useMemo(() => {
    const seen = new Map<string, { email: string; name: string; mine: boolean }>();
    for (const m of items) {
      if (!seen.has(m.creatorEmail)) {
        seen.set(m.creatorEmail, { email: m.creatorEmail, name: m.creatorName || m.creatorEmail, mine: m.mine });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  // Folder AND owner AND starred AND search compose, all client-side over the
  // fetched list. A folder selection includes its descendant folders.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const allowedFolders = selection.kind === 'folder' ? subtreeIds(folders, selection.id) : null;
    return items.filter(m => {
      if (selection.kind === 'unfiled' && m.folderId) return false;
      if (allowedFolders && !(m.folderId && allowedFolders.has(m.folderId))) return false;
      if (ownerFilter && m.creatorEmail !== ownerFilter) return false;
      if (starredOnly && !m.starred) return false;
      if (q && !m.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, folders, selection, ownerFilter, starredOnly, search]);

  // Count per folder (including descendants), shown next to each sidebar row.
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of folders) {
      const ids = subtreeIds(folders, f.id);
      counts.set(f.id, items.filter(m => m.folderId && ids.has(m.folderId)).length);
    }
    return counts;
  }, [folders, items]);

  const unfiledCount = useMemo(() => items.filter(m => !m.folderId).length, [items]);

  const submitCreate = async (raw: string) => {
    const title = raw.trim() || 'Untitled mindmap';
    setPrompt(null);
    try {
      const r = await fetch(`${API_URL}/api/mindmaps`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!r.ok) throw new Error('Could not create mindmap');
      const d = await r.json();
      // Create it where the user is looking: file it into the selected folder.
      if (selection.kind === 'folder') {
        await fetch(`${API_URL}/api/mindmaps/${d.mindmap.id}/folder`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderId: selection.id }),
        }).catch(() => {});
      }
      navigateTo(`/mindmap/${d.mindmap.id}`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Could not create mindmap');
    }
  };

  const submitRename = async (item: MindmapListItem, raw: string) => {
    const trimmed = raw.trim();
    setPrompt(null);
    if (!trimmed || trimmed === item.title) return;
    try {
      const r = await fetch(`${API_URL}/api/mindmaps/${item.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!r.ok) throw new Error();
      setItems(prev => prev.map(x => (x.id === item.id ? { ...x, title: trimmed } : x)));
    } catch {
      setBanner('Could not rename mindmap');
    }
  };

  // Optimistic star toggle; revert on failure.
  const toggleStar = async (m: MindmapListItem) => {
    const next = !m.starred;
    setItems(prev => prev.map(x => (x.id === m.id ? { ...x, starred: next } : x)));
    try {
      const r = await fetch(`${API_URL}/api/mindmaps/${m.id}/star`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ star: next }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setItems(prev => prev.map(x => (x.id === m.id ? { ...x, starred: !next } : x)));
    }
  };

  const doDelete = async (m: MindmapListItem) => {
    setConfirmDelete(null);
    try {
      const r = await fetch(`${API_URL}/api/mindmaps/${m.id}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error();
      setItems(prev => prev.filter(x => x.id !== m.id));
    } catch {
      setBanner('Could not delete mindmap');
    }
  };

  const createFolder = async (parentId: string | null, raw: string) => {
    const name = raw.trim();
    setPrompt(null);
    if (!name) return;
    try {
      const r = await fetch(`${API_URL}/api/mindmap-folders`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error);
      const d = await r.json();
      setFolders(d.folders || []);
      if (d.folder) setSelection({ kind: 'folder', id: d.folder.id });
    } catch (err) {
      setBanner(err instanceof Error && err.message ? err.message : 'Could not create folder');
    }
  };

  // Shared by rename and move — the server takes both fields on the same PUT.
  const updateFolder = async (folder: MindmapFolder, patch: { name?: string; parentId?: string | null }) => {
    setPrompt(null);
    setPicker(null);
    try {
      const r = await fetch(`${API_URL}/api/mindmap-folders/${folder.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error);
      const d = await r.json();
      setFolders(d.folders || []);
    } catch (err) {
      setBanner(err instanceof Error && err.message ? err.message : 'Could not update folder');
    }
  };

  const doDeleteFolder = async (folder: MindmapFolder) => {
    setConfirmDeleteFolder(null);
    try {
      const r = await fetch(`${API_URL}/api/mindmap-folders/${folder.id}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error();
      const d = await r.json();
      setFolders(d.folders || []);
      // The server moved this folder's maps up to its parent; mirror that here
      // rather than refetching the whole list.
      setItems(prev => prev.map(m => (m.folderId === folder.id ? { ...m, folderId: folder.parentId || null } : m)));
      setSelection(s => (s.kind === 'folder' && s.id === folder.id ? { kind: 'all' } : s));
    } catch {
      setBanner('Could not delete folder');
    }
  };

  const moveMindmap = async (item: MindmapListItem, folderId: string | null) => {
    setPicker(null);
    const prevFolderId = item.folderId;
    setItems(prev => prev.map(m => (m.id === item.id ? { ...m, folderId } : m)));
    try {
      const r = await fetch(`${API_URL}/api/mindmaps/${item.id}/folder`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setItems(prev => prev.map(m => (m.id === item.id ? { ...m, folderId: prevFolderId } : m)));
      setBanner('Could not move mindmap');
    }
  };

  const renderFolderRow = (folder: MindmapFolder, depth: number) => {
    const active = selection.kind === 'folder' && selection.id === folder.id;
    return (
      <div
        key={folder.id}
        className={`group flex items-center gap-1 rounded px-2 py-1 text-sm cursor-pointer ${active ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => setSelection({ kind: 'folder', id: folder.id })}
      >
        <span className="truncate flex-1">{folder.name}</span>
        <span className="text-xs text-gray-400 group-hover:hidden">{folderCounts.get(folder.id) ?? 0}</span>
        <span className="hidden group-hover:flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setPrompt({ mode: 'createFolder', parentId: folder.id })}
            className="text-xs text-gray-400 hover:text-blue-600 px-0.5"
            title="New subfolder"
          >+</button>
          <button
            onClick={() => setPrompt({ mode: 'renameFolder', folder })}
            className="text-xs text-gray-400 hover:text-blue-600 px-0.5"
            title="Rename folder"
          >✎</button>
          <button
            onClick={() => setPicker({ mode: 'moveFolder', folder })}
            className="text-xs text-gray-400 hover:text-blue-600 px-0.5"
            title="Move folder"
          >⇄</button>
          <button
            onClick={() => setConfirmDeleteFolder(folder)}
            className="text-xs text-gray-400 hover:text-red-600 px-0.5"
            title="Delete folder"
          >×</button>
        </span>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Mindmaps</h1>
          <p className="text-sm text-gray-500">Sticky-note canvases for brainstorming and planning.</p>
        </div>
        <button
          onClick={() => setPrompt({ mode: 'create' })}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + New mindmap
        </button>
      </div>

      {banner && (
        <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{banner}</div>
      )}

      <div className="flex gap-5 items-start">
      {/* Folder tree. Folders are private to me, so they organize shared maps too. */}
      <aside className="w-52 shrink-0">
        <div className="flex items-center justify-between mb-1 px-2">
          <span className="text-xs uppercase tracking-wide text-gray-400 font-medium">Folders</span>
          <button
            onClick={() => setPrompt({ mode: 'createFolder', parentId: null })}
            className="text-xs text-gray-500 hover:text-blue-600"
            title="New folder"
          >
            + New
          </button>
        </div>
        <div
          className={`rounded px-2 py-1 text-sm cursor-pointer ${selection.kind === 'all' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
          onClick={() => setSelection({ kind: 'all' })}
        >
          All mindmaps <span className="text-xs text-gray-400">{items.length}</span>
        </div>
        <div
          className={`rounded px-2 py-1 text-sm cursor-pointer ${selection.kind === 'unfiled' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
          onClick={() => setSelection({ kind: 'unfiled' })}
        >
          Unfiled <span className="text-xs text-gray-400">{unfiledCount}</span>
        </div>
        <div className="mt-1 space-y-0.5">
          {flattenFolders(folders).map(({ folder, depth }) => renderFolderRow(folder, depth))}
          {folders.length === 0 && (
            <p className="px-2 py-2 text-xs text-gray-400">No folders yet.</p>
          )}
        </div>
      </aside>

      <div className="flex-1 min-w-0">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={ownerFilter}
          onChange={e => setOwnerFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
        >
          <option value="">All owners</option>
          {owners.map(o => (
            <option key={o.email} value={o.email}>{o.name}{o.mine ? ' (me)' : ''}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={starredOnly} onChange={e => setStarredOnly(e.target.checked)} className="rounded border-gray-300" />
          Starred only
        </label>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search titles…"
          className="text-sm border border-gray-300 rounded px-3 py-1.5 flex-1 min-w-[160px] focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 py-10 text-center">Loading…</div>
      ) : error ? (
        <div className="text-sm text-red-600 py-10 text-center">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-gray-400 py-10 text-center">
          {items.length === 0 ? 'No mindmaps yet. Create one to get started.' : 'No mindmaps match your filters.'}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="w-8" />
                <th className="text-left font-medium px-3 py-2">Title</th>
                <th className="text-left font-medium px-3 py-2">Creator</th>
                <th className="text-right font-medium px-3 py-2">Notes</th>
                <th className="text-left font-medium px-3 py-2">Updated</th>
                <th className="text-left font-medium px-3 py-2">Access</th>
                <th className="text-right font-medium px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => (
                <tr key={m.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="pl-3 py-2">
                    <button
                      onClick={() => toggleStar(m)}
                      className={`text-lg leading-none ${m.starred ? 'text-amber-400' : 'text-gray-300 hover:text-amber-300'}`}
                      title={m.starred ? 'Unstar' : 'Star'}
                      aria-label={m.starred ? 'Unstar' : 'Star'}
                    >
                      {m.starred ? '★' : '☆'}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => navigateTo(`/mindmap/${m.id}`)} className="text-blue-600 hover:underline font-medium">
                      {m.title}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{m.creatorName}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{m.noteCount}</td>
                  <td className="px-3 py-2 text-gray-500">{fmtDate(m.updatedAt)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${m.mine ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                      {m.mine ? 'Mine' : 'Shared'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {/* Filing is private to me, so Move is offered on shared maps too. */}
                    <button onClick={() => setPicker({ mode: 'moveMindmap', item: m })} className="text-xs text-gray-500 hover:text-blue-600 px-1.5">Move</button>
                    {m.mine && (
                      <>
                        <button onClick={() => setPrompt({ mode: 'rename', item: m })} className="text-xs text-gray-500 hover:text-blue-600 px-1.5">Rename</button>
                        <button onClick={() => setConfirmDelete(m)} className="text-xs text-gray-500 hover:text-red-600 px-1.5">Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
      </div>

      {prompt?.mode === 'create' && (
        <TextPromptModal
          title="New mindmap"
          label="Title"
          initial="Untitled mindmap"
          submitLabel="Create"
          onSubmit={submitCreate}
          onClose={() => setPrompt(null)}
        />
      )}
      {prompt?.mode === 'rename' && (
        <TextPromptModal
          title="Rename mindmap"
          label="Title"
          initial={prompt.item.title}
          submitLabel="Save"
          onSubmit={value => submitRename(prompt.item, value)}
          onClose={() => setPrompt(null)}
        />
      )}
      {prompt?.mode === 'createFolder' && (
        <TextPromptModal
          title={prompt.parentId ? 'New subfolder' : 'New folder'}
          label="Folder name"
          initial=""
          submitLabel="Create"
          onSubmit={value => createFolder(prompt.parentId, value)}
          onClose={() => setPrompt(null)}
        />
      )}
      {prompt?.mode === 'renameFolder' && (
        <TextPromptModal
          title="Rename folder"
          label="Folder name"
          initial={prompt.folder.name}
          submitLabel="Save"
          onSubmit={value => updateFolder(prompt.folder, { name: value.trim() })}
          onClose={() => setPrompt(null)}
        />
      )}
      {picker?.mode === 'moveMindmap' && (
        <FolderPickerModal
          title="Move mindmap"
          label={`Move “${picker.item.title}” to`}
          folders={folders}
          initial={picker.item.folderId}
          rootLabel="No folder"
          submitLabel="Move"
          onSubmit={folderId => moveMindmap(picker.item, folderId)}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.mode === 'moveFolder' && (
        <FolderPickerModal
          title="Move folder"
          label={`Move “${picker.folder.name}” into`}
          folders={folders}
          initial={picker.folder.parentId}
          rootLabel="Top level"
          // A folder can't move into itself or its own descendants.
          excludeIds={subtreeIds(folders, picker.folder.id)}
          submitLabel="Move"
          onSubmit={parentId => updateFolder(picker.folder, { parentId })}
          onClose={() => setPicker(null)}
        />
      )}
      {confirmDeleteFolder && (
        <ConfirmModal
          title="Delete folder"
          message={
            confirmDeleteFolder.parentId
              ? `Delete “${confirmDeleteFolder.name}”? Its mindmaps and subfolders move up to the parent folder. No mindmaps are deleted.`
              : `Delete “${confirmDeleteFolder.name}”? Its mindmaps become unfiled and its subfolders move to the top level. No mindmaps are deleted.`
          }
          confirmLabel="Delete"
          onConfirm={() => doDeleteFolder(confirmDeleteFolder)}
          onClose={() => setConfirmDeleteFolder(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title="Delete mindmap"
          message={`Delete “${confirmDelete.title}”? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => doDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
