import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { User } from '../../types';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

interface OrgNode {
  user: User;
  children: OrgNode[];
  descendants: number; // total people below this node
}

// Build a reporting forest from the flat user list. Roots are users whose
// managerId is missing or points outside the set; a shared `seen` set makes the
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

// Renders the reporting hierarchy of `users` as a top-down graph with per-node
// expand/collapse. Self-contained (no data fetching) so it can be embedded.
export function OrgChart({ users }: { users: User[] }) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 8, y: 8 });
  const [dragging, setDragging] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  // Latest zoom/pan, so the once-attached wheel listener reads current values.
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  useEffect(() => { zoomRef.current = zoom; panRef.current = pan; }, [zoom, pan]);

  const forest = useMemo(() => buildForest(users), [users]);
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

  // Scale so the graph's natural width fits the viewport (only shrinks; a small
  // chart is left at 100%). Resets the pan to the top-left.
  const fitToWidth = useCallback(() => {
    const vp = viewportRef.current, content = contentRef.current;
    if (!vp || !content) return;
    const cw = content.scrollWidth;
    const vw = vp.clientWidth;
    if (!cw || !vw) return;
    setZoom(clampZoom(Math.min(1, (vw - 16) / cw)));
    setPan({ x: 8, y: 8 });
  }, []);

  // Fit on first render and whenever the underlying people change.
  useLayoutEffect(() => { fitToWidth(); }, [forest, fitToWidth]);

  // Zoom around a viewport point (keeps that point stationary).
  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    const z = zoomRef.current, p = panRef.current;
    const nz = clampZoom(z * factor);
    if (nz === z) return;
    const ratio = nz / z;
    setZoom(nz);
    setPan({ x: cx - ratio * (cx - p.x), y: cy - ratio * (cy - p.y) });
  }, []);

  const zoomButton = (factor: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    zoomAt(factor, vp.clientWidth / 2, vp.clientHeight / 2);
  };

  // Ctrl/⌘+wheel (or plain wheel) zooms toward the cursor. Native non-passive
  // listener so we can preventDefault the page scroll.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return; // let controls work
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPan({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) });
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  if (forest.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
        No users to chart yet. Sync from Google Workspace and set manager relationships to populate the org chart.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-gray-500">
          {users.length} people{forest.length > 1 && `, ${forest.length} at the top`}
          <span className="ml-2 text-gray-400">· drag to pan, scroll to zoom</span>
        </span>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-gray-300 bg-white">
            <button onClick={() => zoomButton(1 / 1.2)} title="Zoom out" className="px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50">−</button>
            <span className="w-11 text-center text-xs tabular-nums text-gray-500">{Math.round(zoom * 100)}%</span>
            <button onClick={() => zoomButton(1.2)} title="Zoom in" className="px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50">+</button>
          </div>
          <button onClick={fitToWidth} className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Fit width</button>
          <button onClick={expandAll} className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Expand all</button>
          <button onClick={collapseAll} className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Collapse all</button>
        </div>
      </div>
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        className="relative h-[70vh] overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
        style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
      >
        <div ref={contentRef} className="inline-block origin-top-left" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <div className="orgchart">
            <ul>
              {forest.map(node => (
                <NodeCard key={node.user.id} node={node} collapsedIds={collapsedIds} onToggle={toggle} />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
