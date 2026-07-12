import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';

interface OrgNode {
  user: User;
  children: OrgNode[];
  descendants: number; // total people below this node
}

// Build a reporting forest from the flat user list. Roots are users whose
// managerId is missing or points outside the org; a shared `seen` set makes the
// walk cycle-safe and ensures each person appears exactly once.
function buildForest(users: User[]): OrgNode[] {
  const byId = new Map(users.map(u => [u.id, u]));
  const childrenOf = new Map<string, User[]>();
  const roots: User[] = [];
  for (const u of users) {
    const mid = u.managerId && u.managerId !== u.id && byId.has(u.managerId) ? u.managerId : null;
    if (mid) {
      const arr = childrenOf.get(mid);
      if (arr) arr.push(u); else childrenOf.set(mid, [u]);
    } else {
      roots.push(u);
    }
  }
  const label = (u: User) => (u.name || u.email || '').toLowerCase();
  const byName = (a: User, b: User) => label(a).localeCompare(label(b));
  const seen = new Set<string>();
  const build = (u: User): OrgNode => {
    seen.add(u.id);
    const kids = (childrenOf.get(u.id) || []).filter(c => !seen.has(c.id)).sort(byName);
    const children = kids.map(build);
    const descendants = children.reduce((n, c) => n + 1 + c.descendants, 0);
    return { user: u, children, descendants };
  };
  const forest: OrgNode[] = [];
  for (const u of roots.sort(byName)) if (!seen.has(u.id)) forest.push(build(u));
  // Any users still unvisited are trapped in a manager cycle with no acyclic
  // entry point — surface them as extra roots so nobody silently disappears.
  // Re-check `seen` inside the loop: building one cycle member marks the rest.
  for (const u of [...users].sort(byName)) if (!seen.has(u.id)) forest.push(build(u));
  return forest;
}

// Collect the ids of every node that has at least one report.
function collectParentIds(nodes: OrgNode[], out: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    if (n.children.length > 0) {
      out.add(n.user.id);
      collectParentIds(n.children, out);
    }
  }
  return out;
}

function initials(u: User): string {
  const src = (u.name || u.email || '').trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
  return chars.toUpperCase();
}

function NodeCard({ node, collapsedIds, onToggle }: {
  node: OrgNode;
  collapsedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const { user, children, descendants } = node;
  const hasKids = children.length > 0;
  const isCollapsed = collapsedIds.has(user.id);
  return (
    <li>
      <div className="inline-flex w-48 flex-col items-center gap-0.5 rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm">
        {user.picture ? (
          <img src={user.picture} alt="" className="h-9 w-9 rounded-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
            {initials(user)}
          </div>
        )}
        <div className="text-center text-sm font-semibold leading-tight text-gray-900" title={user.name}>
          {user.name || user.email}
        </div>
        {user.department ? (
          <div className="text-center text-xs text-gray-500" title={user.department}>{user.department}</div>
        ) : (
          <div className="text-center text-xs italic text-gray-300">No department</div>
        )}
        <div className="max-w-full truncate text-center text-[11px] text-gray-400" title={user.email}>{user.email}</div>
        {hasKids && (
          <button
            type="button"
            onClick={() => onToggle(user.id)}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? 'Show reports' : 'Hide reports'}
            className="mt-1 inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-100"
          >
            <svg className={`h-3 w-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {isCollapsed ? descendants : 'hide'}
          </button>
        )}
      </div>
      {hasKids && !isCollapsed && (
        <ul>
          {children.map(child => (
            <NodeCard key={child.user.id} node={child} collapsedIds={collapsedIds} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OrgChartPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, exclRes] = await Promise.all([
        fetch(`${API_URL}/api/users`, { credentials: 'include' }),
        fetch(`${API_URL}/api/excluded-emails`, { credentials: 'include' }),
      ]);
      if (!usersRes.ok) { setError(`Failed to load users (${usersRes.status}).`); return; }
      const data = await usersRes.json();
      setUsers(Array.isArray(data.users) ? data.users : []);
      // Emails an admin excluded from the reporting structure are hidden here too.
      const excl = exclRes.ok ? await exclRes.json().catch(() => ({})) : {};
      setExcluded(new Set((excl.excludedEmails || []).map((e: string) => String(e).toLowerCase())));
    } catch (e) {
      setError(`Couldn't reach the server: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visibleUsers = useMemo(
    () => users.filter(u => !excluded.has((u.email || '').toLowerCase())),
    [users, excluded]
  );
  const forest = useMemo(() => buildForest(visibleUsers), [visibleUsers]);
  const parentIds = useMemo(() => collectParentIds(forest), [forest]);

  const toggle = useCallback((id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setCollapsedIds(new Set()), []);
  const collapseAll = useCallback(() => setCollapsedIds(new Set(parentIds)), [parentIds]);

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Org Chart</h1>
          <p className="text-sm text-gray-500">
            Reporting structure from Google Workspace — {visibleUsers.length} people
            {forest.length > 1 && `, ${forest.length} at the top`}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={expandAll} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Expand all</button>
          <button onClick={collapseAll} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Collapse all</button>
          <button onClick={load} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Refresh</button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="py-8 text-sm text-gray-500">Loading org chart…</p>
      ) : forest.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          No users yet. Sync from Google Workspace and set manager relationships in the Admin panel to populate the org chart.
        </div>
      ) : (
        <div className="overflow-x-auto pb-6">
          <div className="orgchart min-w-full">
            <ul>
              {forest.map(node => (
                <NodeCard key={node.user.id} node={node} collapsedIds={collapsedIds} onToggle={toggle} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
