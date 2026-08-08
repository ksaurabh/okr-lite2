import { useEffect, useMemo, useState } from 'react';
import type { MindmapListItem } from './types';
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

type PromptState =
  | { mode: 'create' }
  | { mode: 'rename'; item: MindmapListItem }
  | null;

export function MindmapsPage() {
  const [items, setItems] = useState<MindmapListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [ownerFilter, setOwnerFilter] = useState(''); // creatorEmail or ''
  const [starredOnly, setStarredOnly] = useState(false);
  const [search, setSearch] = useState('');

  const [prompt, setPrompt] = useState<PromptState>(null);
  const [confirmDelete, setConfirmDelete] = useState<MindmapListItem | null>(null);

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
      .then(d => { setItems(d.mindmaps || []); setError(null); })
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

  // Owner AND starred AND search compose, all client-side over the fetched list.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(m => {
      if (ownerFilter && m.creatorEmail !== ownerFilter) return false;
      if (starredOnly && !m.starred) return false;
      if (q && !m.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, ownerFilter, starredOnly, search]);

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

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
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
                    {m.mine ? (
                      <>
                        <button onClick={() => setPrompt({ mode: 'rename', item: m })} className="text-xs text-gray-500 hover:text-blue-600 px-1.5">Rename</button>
                        <button onClick={() => setConfirmDelete(m)} className="text-xs text-gray-500 hover:text-red-600 px-1.5">Delete</button>
                      </>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
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
