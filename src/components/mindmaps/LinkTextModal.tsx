import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import type { MindmapListItem } from './types';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Props {
  selection: string;  // the text being turned into a link
  excludeId: string;  // current mindmap — linking text to its own map is a no-op
  onPick: (mindmapId: string) => void;   // link to an existing mindmap
  onCreate: (title: string) => void;     // create a new mindmap and link to it
  onClose: () => void;
}

// Turn the selected text of a note into a link to a mindmap: pick an existing
// one, or spin up a new mindmap named after the selection.
export function LinkTextModal({ selection, excludeId, onPick, onCreate, onClose }: Props) {
  const [items, setItems] = useState<MindmapListItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/mindmaps`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { mindmaps: [] }))
      .then(d => { if (!cancelled) setItems(d.mindmaps || []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(m => m.id !== excludeId && (!q || m.title.toLowerCase().includes(q)));
  }, [items, search, excludeId]);

  // A new mindmap is named after whatever you typed to search, falling back to
  // the selected text.
  const newTitle = (search.trim() || selection.trim()).slice(0, 200);

  return (
    <Modal isOpen onClose={onClose} title="Link text to a mindmap">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Linking <span className="font-medium text-gray-900">“{selection.length > 60 ? `${selection.slice(0, 60)}…` : selection}”</span>
        </p>
        <input
          type="text"
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search mindmaps…"
          className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <div className="max-h-64 overflow-y-auto border border-gray-100 rounded">
          {loading ? (
            <div className="px-3 py-3 text-xs text-gray-400">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-400">No mindmaps found.</div>
          ) : filtered.map(m => (
            <button
              key={m.id}
              onClick={() => onPick(m.id)}
              className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50"
            >
              <span className="flex-1 truncate text-gray-800">{m.title}</span>
              <span className="text-[11px] text-gray-400">{m.noteCount} note{m.noteCount === 1 ? '' : 's'}</span>
            </button>
          ))}
        </div>
        <button
          disabled={!newTitle || creating}
          onClick={() => { setCreating(true); onCreate(newTitle); }}
          className="w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-50 flex items-center gap-2 text-gray-700 disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          <span className="truncate">{creating ? 'Creating…' : `New mindmap “${newTitle}”`}</span>
        </button>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
