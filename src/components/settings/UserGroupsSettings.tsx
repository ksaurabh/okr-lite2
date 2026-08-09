import { useEffect, useMemo, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '';

interface OrgUser { id: string; email: string; name: string; }
interface Group { id: string; name: string; memberEmails?: string[] }

// Admin-only management of org user groups. Groups are used to grant access to
// mindmap views (a group's members see only the notes of views granted to them).
export function UserGroupsSettings() {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [newName, setNewName] = useState('');
  const [managingId, setManagingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const loadGroups = () => {
    fetch(`${API_URL}/api/groups`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { groups: [] }))
      .then(d => setGroups(d.groups || []))
      .catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`${API_URL}/api/groups`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : { groups: [] }))
        .then(d => { if (!cancelled) setGroups(d.groups || []); })
        .catch(() => {});
      fetch(`${API_URL}/api/users`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : { users: [] }))
        .then(d => { if (!cancelled) setUsers(d.users || []); })
        .catch(() => {});
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const createGroup = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/groups`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (r.ok) { setNewName(''); loadGroups(); }
    } finally { setBusy(false); }
  };

  const renameGroup = async (g: Group, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === g.name) return;
    await fetch(`${API_URL}/api/groups/${g.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    }).catch(() => {});
    loadGroups();
  };

  const deleteGroup = async (g: Group) => {
    await fetch(`${API_URL}/api/groups/${g.id}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    if (managingId === g.id) setManagingId(null);
    loadGroups();
  };

  const toggleMember = async (g: Group, email: string) => {
    const cur = new Set((g.memberEmails || []).map(e => e.toLowerCase()));
    const e = email.toLowerCase();
    if (cur.has(e)) cur.delete(e); else cur.add(e);
    const memberEmails = Array.from(cur);
    // Optimistic
    setGroups(prev => prev.map(x => (x.id === g.id ? { ...x, memberEmails } : x)));
    await fetch(`${API_URL}/api/groups/${g.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberEmails }),
    }).catch(() => {});
  };

  const managing = groups.find(g => g.id === managingId) || null;
  const managingSet = useMemo(
    () => new Set((managing?.memberEmails || []).map(e => e.toLowerCase())),
    [managing],
  );
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter(u => u.email)
      .filter(u => !q || (u.name || '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }, [users, search]);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <button type="button" onClick={() => setOpen(!open)} className="w-full p-4 flex items-center justify-between hover:bg-gray-50">
        <h2 className="text-base font-semibold text-gray-900">User groups</h2>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="p-4 border-t border-gray-200 space-y-4">
          <p className="text-xs text-gray-500">Groups of people you can grant mindmap views to. Members of a granted group see only that view’s notes.</p>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createGroup(); }}
              placeholder="New group name"
              className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
            <button type="button" onClick={createGroup} disabled={busy || !newName.trim()} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">Add group</button>
          </div>

          {groups.length === 0 ? (
            <div className="text-xs text-gray-400">No groups yet.</div>
          ) : (
            <div className="border border-gray-100 rounded divide-y divide-gray-100">
              {groups.map(g => (
                <div key={g.id}>
                  <div className="px-3 py-2 flex items-center gap-2">
                    <input
                      defaultValue={g.name}
                      onBlur={e => renameGroup(g, e.target.value)}
                      className="flex-1 text-sm font-medium text-gray-800 bg-transparent px-2 py-1 rounded hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    <span className="text-[11px] text-gray-400 whitespace-nowrap">{(g.memberEmails || []).length} member{(g.memberEmails || []).length === 1 ? '' : 's'}</span>
                    <button type="button" onClick={() => { setManagingId(managingId === g.id ? null : g.id); setSearch(''); }} className="text-xs text-blue-600 hover:underline px-1.5">{managingId === g.id ? 'Close' : 'Members'}</button>
                    <button type="button" onClick={() => deleteGroup(g)} className="text-xs text-gray-500 hover:text-red-600 px-1.5">Delete</button>
                  </div>
                  {managingId === g.id && (
                    <div className="px-3 pb-3 space-y-2 bg-gray-50">
                      <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search people…"
                        className="w-full text-sm border border-gray-300 rounded px-3 py-1.5"
                      />
                      <div className="max-h-56 overflow-y-auto border border-gray-100 rounded bg-white">
                        {filteredUsers.map(u => (
                          <label key={u.email} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                            <input type="checkbox" checked={managingSet.has(u.email.toLowerCase())} onChange={() => toggleMember(g, u.email)} className="rounded border-gray-300" />
                            <span className="flex-1 truncate text-gray-800">{u.name || u.email}</span>
                            {u.name && <span className="text-xs text-gray-400 truncate">{u.email}</span>}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
