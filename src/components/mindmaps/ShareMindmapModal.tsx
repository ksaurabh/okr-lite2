import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import type { User } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Props {
  mindmapId: string;
  initialShared: boolean;
  initialSharedWith: string[];
  selfEmail: string;
  onClose: () => void;
  onSaved: (shared: boolean, sharedWith: string[]) => void;
}

// Choose who can see a mindmap: everyone in the org, and/or specific people.
export function ShareMindmapModal({ mindmapId, initialShared, initialSharedWith, selfEmail, onClose, onSaved }: Props) {
  const [orgWide, setOrgWide] = useState(initialShared);
  const [sharedWith, setSharedWith] = useState<string[]>(initialSharedWith);
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/users`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { users: [] }))
      .then(d => setUsers(d.users || []))
      .catch(() => setUsers([]));
  }, []);

  const selected = useMemo(() => new Set(sharedWith.map(e => e.toLowerCase())), [sharedWith]);

  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter(u => u.email && u.email.toLowerCase() !== selfEmail.toLowerCase())
      .filter(u => !q || (u.name || '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }, [users, search, selfEmail]);

  const toggle = (email: string) => {
    const e = email.toLowerCase();
    setSharedWith(prev => (prev.some(x => x.toLowerCase() === e) ? prev.filter(x => x.toLowerCase() !== e) : [...prev, e]));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${API_URL}/api/mindmaps/${mindmapId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shared: orgWide, sharedWith }),
      });
      if (!r.ok) throw new Error();
      onSaved(orgWide, sharedWith);
      onClose();
    } catch {
      setError('Could not update sharing.');
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Share mindmap">
      <div className="space-y-4">
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={orgWide} onChange={e => setOrgWide(e.target.checked)} className="mt-0.5 rounded border-gray-300" />
          <span className="text-sm text-gray-700">
            <span className="font-medium">Anyone in the organization</span>
            <span className="block text-xs text-gray-500">Everyone signed in can view this mindmap.</span>
          </span>
        </label>

        <div>
          <div className="text-sm font-medium text-gray-700 mb-1">Share with specific people</div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search people…"
            className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="max-h-64 overflow-y-auto border border-gray-100 rounded">
            {people.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400">No people found.</div>
            ) : people.map(u => (
              <label key={u.email} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={selected.has(u.email.toLowerCase())} onChange={() => toggle(u.email)} className="rounded border-gray-300" />
                <span className="flex-1 truncate text-gray-800">{u.name || u.email}</span>
                {u.name && <span className="text-xs text-gray-400 truncate">{u.email}</span>}
              </label>
            ))}
          </div>
          {sharedWith.length > 0 && (
            <div className="text-xs text-gray-500 mt-1">Shared with {sharedWith.length} {sharedWith.length === 1 ? 'person' : 'people'}.</div>
          )}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
