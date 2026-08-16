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

// Folders come back as a flat list; these walk it as a tree.
function childFolders(folders: MindmapFolder[], parentId: string | null): MindmapFolder[] {
  return folders
    .filter(f => (f.parentId || null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Depth-first order with a depth per row, for indented pickers.
function flattenFolders(folders: MindmapFolder[], parentId: string | null = null, depth = 0): Array<{ folder: MindmapFolder; depth: number }> {
  return childFolders(folders, parentId).flatMap(f => [
    { folder: f, depth },
    ...flattenFolders(folders, f.id, depth + 1),
  ]);
}

// A folder and everything under it.
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

// Root-to-folder chain, for the breadcrumb and for labelling search hits.
function folderPath(folders: MindmapFolder[], id: string | null): MindmapFolder[] {
  const byId = new Map(folders.map(f => [f.id, f]));
  const out: MindmapFolder[] = [];
  let cur = id ? byId.get(id) : undefined;
  while (cur && out.length < 50) {
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

// Picks a destination folder (or the top level). `excludeIds` hides destinations
// that would create a cycle when moving a folder.
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
              <option key={folder.id} value={folder.id}>{`${'  '.repeat(depth)}${folder.name}`}</option>
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

function FolderIcon() {
  return (
    <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path d="M2 5a2 2 0 012-2h3.6a2 2 0 011.4.6L10.6 5H16a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" />
    </svg>
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

export function MindmapsPage() {
  const [items, setItems] = useState<MindmapListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [ownerFilter, setOwnerFilter] = useState(''); // creatorEmail or ''
  const [starredOnly, setStarredOnly] = useState(false);
  const [search, setSearch] = useState('');

  const [folders, setFolders] = useState<MindmapFolder[]>([]);
  // The folder being browsed, file-explorer style; null = top level.
  const [cwd, setCwd] = useState<string | null>(null);

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

  // Filters turn the listing into a search: instead of the current folder's own
  // contents, it shows every match beneath it, each labelled with its folder —
  // the way a file explorer searches a directory tree.
  const filtering = !!(search.trim() || ownerFilter || starredOnly);

  const matchesFilters = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (m: MindmapListItem) => {
      if (ownerFilter && m.creatorEmail !== ownerFilter) return false;
      if (starredOnly && !m.starred) return false;
      if (q && !m.title.toLowerCase().includes(q)) return false;
      return true;
    };
  }, [search, ownerFilter, starredOnly]);

  // Folders shown as rows: the current folder's children, or (while filtering)
  // every descendant folder whose name matches the query.
  const visibleFolders = useMemo(() => {
    if (!filtering) return childFolders(folders, cwd);
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const scope = cwd ? subtreeIds(folders, cwd) : null;
    return folders
      .filter(f => (!scope || (scope.has(f.id) && f.id !== cwd)) && f.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [folders, cwd, filtering, search]);

  // Mindmaps shown as rows: those filed directly in the current folder, or
  // (while filtering) every match anywhere beneath it.
  const visibleItems = useMemo(() => {
    const scope = filtering && cwd ? subtreeIds(folders, cwd) : null;
    return items
      .filter(m => {
        if (filtering) {
          if (scope && !(m.folderId && scope.has(m.folderId))) return false;
        } else if ((m.folderId || null) !== cwd) {
          return false;
        }
        return matchesFilters(m);
      })
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }, [items, folders, cwd, filtering, matchesFilters]);

  // Mindmap count per folder, including its descendants.
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of folders) {
      const ids = subtreeIds(folders, f.id);
      counts.set(f.id, items.filter(m => m.folderId && ids.has(m.folderId)).length);
    }
    return counts;
  }, [folders, items]);

  const breadcrumb = useMemo(() => folderPath(folders, cwd), [folders, cwd]);
  const foldersById = useMemo(() => new Map(folders.map(f => [f.id, f])), [folders]);

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
      // Create it where the user is looking: file it into the current folder.
      if (cwd) {
        await fetch(`${API_URL}/api/mindmaps/${d.mindmap.id}/folder`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderId: cwd }),
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
      // Don't strand the browser inside a folder that no longer exists.
      if (cwd && subtreeIds(folders, folder.id).has(cwd)) setCwd(folder.parentId || null);
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

  // Where a search hit lives, shown beside its title so a flat result list still
  // says which folder each row came from.
  const locationLabel = (folderId: string | null) => {
    if (!folderId) return 'Top level';
    return folderPath(folders, folderId).map(f => f.name).join(' / ') || 'Top level';
  };

  const empty = visibleFolders.length === 0 && visibleItems.length === 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Mindmaps</h1>
          <p className="text-sm text-gray-500">Sticky-note canvases for brainstorming and planning.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPrompt({ mode: 'createFolder', parentId: cwd })}
            className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            + New folder
          </button>
          <button
            onClick={() => setPrompt({ mode: 'create' })}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + New mindmap
          </button>
        </div>
      </div>

      {banner && (
        <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{banner}</div>
      )}

      {/* Breadcrumb trail for the folder being browsed. */}
      <div className="flex items-center flex-wrap gap-1 mb-3 text-sm">
        <button
          onClick={() => setCwd(null)}
          className={cwd === null ? 'text-gray-900 font-medium' : 'text-blue-600 hover:underline'}
        >
          Mindmaps
        </button>
        {breadcrumb.map((f, i) => (
          <span key={f.id} className="flex items-center gap-1">
            <span className="text-gray-300">/</span>
            <button
              onClick={() => setCwd(f.id)}
              className={i === breadcrumb.length - 1 ? 'text-gray-900 font-medium' : 'text-blue-600 hover:underline'}
            >
              {f.name}
            </button>
          </span>
        ))}
      </div>

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
          placeholder={cwd ? 'Search this folder…' : 'Search titles…'}
          className="text-sm border border-gray-300 rounded px-3 py-1.5 flex-1 min-w-[160px] focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 py-10 text-center">Loading…</div>
      ) : error ? (
        <div className="text-sm text-red-600 py-10 text-center">{error}</div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="w-8" />
                <th className="text-left font-medium px-3 py-2">Name</th>
                <th className="text-left font-medium px-3 py-2">Creator</th>
                <th className="text-right font-medium px-3 py-2">Notes</th>
                <th className="text-left font-medium px-3 py-2">Updated</th>
                <th className="text-left font-medium px-3 py-2">Access</th>
                <th className="text-right font-medium px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* Up one level, like ".." in a file explorer. */}
              {!filtering && cwd && (
                <tr className="border-t border-gray-100 hover:bg-gray-50">
                  <td />
                  <td className="px-3 py-2" colSpan={6}>
                    <button
                      onClick={() => setCwd(foldersById.get(cwd)?.parentId || null)}
                      className="text-gray-500 hover:text-blue-600"
                    >
                      ← Up one level
                    </button>
                  </td>
                </tr>
              )}

              {/* Folders first, then mindmaps — file-explorer ordering. */}
              {visibleFolders.map(f => (
                <tr key={f.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td />
                  <td className="px-3 py-2">
                    <button onClick={() => { setSearch(''); setCwd(f.id); }} className="flex items-center gap-2 text-gray-900 font-medium hover:text-blue-600">
                      <FolderIcon />
                      <span className="truncate">{f.name}</span>
                    </button>
                    {filtering && (
                      <div className="text-[11px] text-gray-400 pl-6">in {locationLabel(f.parentId)}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-300">—</td>
                  <td className="px-3 py-2 text-right text-gray-500">{folderCounts.get(f.id) ?? 0}</td>
                  <td className="px-3 py-2 text-gray-300">—</td>
                  <td className="px-3 py-2 text-gray-300">—</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setPicker({ mode: 'moveFolder', folder: f })} className="text-xs text-gray-500 hover:text-blue-600 px-1.5">Move</button>
                    <button onClick={() => setPrompt({ mode: 'renameFolder', folder: f })} className="text-xs text-gray-500 hover:text-blue-600 px-1.5">Rename</button>
                    <button onClick={() => setConfirmDeleteFolder(f)} className="text-xs text-gray-500 hover:text-red-600 px-1.5">Delete</button>
                  </td>
                </tr>
              ))}

              {visibleItems.map(m => (
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
                    {filtering && (
                      <div className="text-[11px] text-gray-400">in {locationLabel(m.folderId)}</div>
                    )}
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

              {empty && (
                <tr className="border-t border-gray-100">
                  <td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-400">
                    {filtering
                      ? 'Nothing matches your filters.'
                      : cwd
                        ? 'This folder is empty.'
                        : 'No mindmaps yet. Create one to get started.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

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
          title="New folder"
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
          rootLabel="Top level"
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
              : `Delete “${confirmDeleteFolder.name}”? Its mindmaps move to the top level, along with its subfolders. No mindmaps are deleted.`
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
