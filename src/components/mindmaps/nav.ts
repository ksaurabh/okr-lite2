// Client-side navigation that keeps App's path-based router in sync: push the
// URL (optionally with history state), then fire popstate so AppContent re-reads
// the view from the path.
export function navigateTo(path: string, state?: unknown): void {
  window.history.pushState(state ?? {}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

// Breadcrumb of mindmaps visited via note links, carried in history state so a
// linked-to mindmap can offer "back to the prior mindmap".
export interface MindmapCrumb { id: string; title: string; }

export function getMindmapBackStack(): MindmapCrumb[] {
  const s = window.history.state as { mindmapStack?: MindmapCrumb[] } | null;
  return Array.isArray(s?.mindmapStack) ? s!.mindmapStack : [];
}

// Navigate to another mindmap, pushing the current one onto the back stack.
export function navigateToMindmap(targetId: string, from: MindmapCrumb): void {
  navigateTo(`/mindmap/${targetId}`, { mindmapStack: [...getMindmapBackStack(), from] });
}

// Navigate back to the previous mindmap in the stack (popping it).
export function navigateBackToMindmap(): void {
  const stack = getMindmapBackStack();
  const prev = stack[stack.length - 1];
  if (!prev) return;
  navigateTo(`/mindmap/${prev.id}`, { mindmapStack: stack.slice(0, -1) });
}
