import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import type { MindmapListItem } from './types';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Props {
  hasLink: boolean;
  excludeId: string; // current mindmap — don't offer to link a note to its own map
  onClose: () => void;
  onOpenLinked: () => void;
  onUnlink: () => void;
  onCreateFromNote: () => void;
  onLinkExisting: (mindmapId: string) => void;
}

// Manage a note's link to another mindmap: open/unlink an existing link, or
// create a new link (to an existing mindmap, or a fresh one made from the note).
export function NoteLinkModal({ hasLink, excludeId, onClose, onOpenLinked, onUnlink, onCreateFromNote, onLinkExisting }: Props) {
  const [picking, setPicking] = useState(false);
  const [items, setItems] = useState<MindmapListItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!picking) return;
    let cancelled = false;
    const loadList = () => {
      setLoading(true);
      fetch(`${API_URL}/api/mindmaps`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : { mindmaps: [] }))
        .then(d => { if (!cancelled) setItems(d.mindmaps || []); })
        .catch(() => { if (!cancelled) setItems([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    loadList();
    return () => { cancelled = true; };
  }, [picking]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(m => m.id !== excludeId && (!q || m.title.toLowerCase().includes(q)));
  }, [items, search, excludeId]);

  return (
    <Modal isOpen onClose={onClose} title={picking ? 'Link to a mindmap' : 'Note link'}>
      {picking ? (
        <div className="space-y-3">
          <input
            type="text"
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search mindmaps…"
            className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="max-h-72 overflow-y-auto border border-gray-100 rounded">
            {loading ? (
              <div className="px-3 py-3 text-xs text-gray-400">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400">No mindmaps found.</div>
            ) : filtered.map(m => (
              <button
                key={m.id}
                onClick={() => { onLinkExisting(m.id); onClose(); }}
                className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50"
              >
                <span className="flex-1 truncate text-gray-800">{m.title}</span>
                <span className="text-[11px] text-gray-400">{m.noteCount} note{m.noteCount === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setPicking(false)}>Back</Button>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {hasLink && (
            <>
              <button onClick={() => { onOpenLinked(); onClose(); }} className="w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-50 flex items-center gap-2 text-blue-700">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                Open linked mindmap
              </button>
              <button onClick={() => { onUnlink(); onClose(); }} className="w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-50 flex items-center gap-2 text-gray-700">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656m3-3l.707-.707M17 14l.707-.707a4 4 0 000-5.656 4 4 0 00-5.656 0" /></svg>
                Unlink
              </button>
              <div className="border-t border-gray-100 my-1" />
            </>
          )}
          <button onClick={() => setPicking(true)} className="w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-50 flex items-center gap-2 text-gray-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 015.656 0 4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656" /></svg>
            {hasLink ? 'Link to a different mindmap…' : 'Link to an existing mindmap…'}
          </button>
          <button onClick={() => { onCreateFromNote(); onClose(); }} className="w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-50 flex items-center gap-2 text-gray-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New mindmap from this note
          </button>
        </div>
      )}
    </Modal>
  );
}
