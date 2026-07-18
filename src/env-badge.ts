// Mark the browser tab so a local instance is never mistaken for production.
// Title reads "L OKR" (local) or "P OKR" (production); the favicon is a branded
// "O" in both cases, color-coded so the icon still hints at the environment.
// "Local" = the Vite dev server, or anything served from a localhost host (so a
// locally-previewed production build still reads as local). Everything else is
// production.

const isLocalHost = /^(localhost|127\.|0\.0\.0\.0$|\[?::1\]?$)/.test(location.hostname);
const isLocal = import.meta.env.DEV || isLocalHost;

const badge = isLocal
  ? { env: 'L', color: '#d97706' } // amber — transient/dev
  : { env: 'P', color: '#2563eb' }; // blue — the live deployment

function faviconDataUri(color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="7" fill="${color}"/>` +
    `<text x="16" y="23" font-family="Arial,Helvetica,sans-serif" font-size="22" ` +
    `font-weight="bold" text-anchor="middle" fill="#ffffff">O</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function applyEnvBadge(): void {
  document.title = `${badge.env} OKR`;

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = faviconDataUri(badge.color);
}
