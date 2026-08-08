import { useEffect, useMemo, useState } from 'react';
import type { MindmapListItem } from './types';
import { navigateTo } from './nav';

const API_URL = import.meta.env.VITE_API_URL || '';

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function MindmapsPage() {
  const [items, setItems] = useState<MindmapListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ownerFilter, setOwnerFilter] = useState(''); // creatorEmail or ''
  const [starredOnly, setStarredOnly] = useState(false);
  const [search, setSearch] = useState('');

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

  const createNew = async () => {
    const title = (window.prompt('Mindmap title', 'Untitled mindmap') ?? '').trim();
    if (title === null) return;
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
      window.alert(err instanceof Error ? err.message : 'Could not create mindmap');
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

  const rename = async (m: MindmapListItem) => {
    const title = window.prompt('Rename mindmap', m.title);
    if (title === null) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === m.title) return;
    try {
      const r = await fetch(`${API_URL}/api/mindmaps/${m.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!r.ok) throw new Error();
      setItems(prev => prev.map(x => (x.id === m.id ? { ...x, title: trimmed } : x)));
    } catch {
      window.alert('Could not rename mindmap');
    }
  };

  const remove = async (m: MindmapListItem) => {
    if (!window.confirm(`Delete "${m.title}"? This cannot be undone.`)) return;
    try {
      const r = await fetch(`${API_URL}/api/mindmaps/${m.id}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error();
      setItems(prev => prev.filter(x => x.id !== m.id));
    } catch {
      window.alert('Could not delete mindmap');
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
          onClick={createNew}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + New mindmap
        </button>
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
                        <button onClick={() => rename(m)} className="text-xs text-gray-500 hover:text-blue-600 px-1.5">Rename</button>
                        <button onClick={() => remove(m)} className="text-xs text-gray-500 hover:text-red-600 px-1.5">Delete</button>
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
    </div>
  );
}
