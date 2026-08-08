// Client-side navigation that keeps App's path-based router in sync: push the
// URL, then fire popstate so AppContent re-reads the view from the path.
export function navigateTo(path: string): void {
  if (window.location.pathname + window.location.search !== path) {
    window.history.pushState({}, '', path);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}
