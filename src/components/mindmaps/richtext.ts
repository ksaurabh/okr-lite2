// Rich-text notes. A note whose `format` is 'html' stores sanitized HTML rather
// than markdown, so content pasted from a mail client or a document keeps its
// bold, lists, tables, colours and links instead of flattening to plain text.
//
// Everything here is allowlist-based: the untrusted HTML is parsed into an
// inert document (DOMParser never runs scripts or loads resources), then every
// tag, attribute and CSS declaration not on a list is dropped. Stored HTML is
// sanitized again on the way out, so HTML written straight into the API by a
// hostile client still can't execute in another viewer's browser.

// Tags kept as-is. Anything else is either dropped whole (below) or unwrapped,
// keeping its text.
const ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'br', 'hr',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'mark', 'sub', 'sup', 'small',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
]);

// Dropped with their contents — text inside them is markup plumbing, not
// content, and keeping it would leak CSS or script source into the note.
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'noscript', 'template', 'head', 'title', 'meta', 'link', 'base',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'canvas', 'svg', 'math',
  'form', 'input', 'textarea', 'select', 'option', 'button', 'audio', 'video', 'source',
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
};

// CSS declarations worth keeping: the ones that carry the look of pasted mail
// (emphasis, colour, alignment, quote indents) and nothing that can position an
// element over the rest of the page or load a remote resource.
const ALLOWED_STYLE_PROPS = new Set([
  'color', 'background-color', 'font-weight', 'font-style', 'font-size',
  'text-decoration', 'text-decoration-line', 'text-align', 'vertical-align',
  'list-style-type', 'white-space',
  'padding-left', 'margin-left', 'border-left', 'border', 'border-bottom', 'border-collapse',
]);
// A value carrying any of these can fetch a resource, escape the declaration,
// or smuggle script — cheaper to drop the declaration than to parse it.
const UNSAFE_STYLE_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|[<>{}\\]/i;
// Font sizes are clamped: a pasted 72pt heading would blow a note apart.
const MAX_FONT_SIZE_PX = 32;
const PT_TO_PX = 96 / 72;

const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const SAFE_IMG_SRC = /^(https:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i;
const MINDMAP_ID = /^mm_[A-Za-z0-9_-]+$/;

// Guards against a pathological paste: a deeply nested or enormous document
// would be slow to sanitize and slower to lay out.
const MAX_ELEMENTS = 4000;
export const RICH_TEXT_CAP = 100000;

function clampFontSize(value: string): string | null {
  const m = /^(\d+(?:\.\d+)?)\s*(px|pt|em|rem|%)$/i.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const px = unit === 'px' ? n
    : unit === 'pt' ? n * PT_TO_PX
    : unit === '%' ? (n / 100) * 16
    : n * 16; // em / rem
  if (!Number.isFinite(px) || px <= 0) return null;
  return px > MAX_FONT_SIZE_PX ? `${MAX_FONT_SIZE_PX}px` : `${Math.round(px)}px`;
}

function sanitizeStyle(style: string): string {
  const out: string[] = [];
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    let value = decl.slice(idx + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop) || !value || UNSAFE_STYLE_VALUE.test(value)) continue;
    if (prop === 'font-size') {
      const clamped = clampFontSize(value);
      if (!clamped) continue;
      value = clamped;
    }
    out.push(`${prop}: ${value}`);
  }
  return out.join('; ');
}

// Rewrite one element down to the allowlist: keep the attributes named for its
// tag, keep a filtered style, drop everything else. Links are rebuilt rather
// than trusted — in-app mindmap links keep their marker and get a href we
// generated, external links open in a new tab with no window.opener.
function sanitizeElement(el: Element) {
  const tag = el.tagName.toLowerCase();
  const keep: Record<string, string> = {};
  const allowed = ALLOWED_ATTRS[tag];
  if (allowed) {
    for (const name of allowed) {
      const v = el.getAttribute(name);
      if (v !== null) keep[name] = v;
    }
  }
  const mindmapTarget = el.getAttribute('data-mindmap-link') || '';
  const style = sanitizeStyle(el.getAttribute('style') || '');

  for (const name of Array.from(el.getAttributeNames())) el.removeAttribute(name);
  if (style) el.setAttribute('style', style);

  if (tag === 'a') {
    if (MINDMAP_ID.test(mindmapTarget)) {
      el.setAttribute('data-mindmap-link', mindmapTarget);
      el.setAttribute('href', `/mindmap/${mindmapTarget}`);
    } else if (keep.href && SAFE_URL.test(keep.href.trim())) {
      el.setAttribute('href', keep.href.trim());
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
    if (keep.title) el.setAttribute('title', keep.title);
    return;
  }
  if (tag === 'img') {
    // An image whose source we can't vouch for leaves nothing behind but its
    // alt text, so the caller sees a hole rather than a broken icon.
    if (!keep.src || !SAFE_IMG_SRC.test(keep.src.trim())) {
      el.replaceWith(...Array.from(el.childNodes), el.ownerDocument.createTextNode(keep.alt || ''));
      return;
    }
    el.setAttribute('src', keep.src.trim());
    if (keep.alt) el.setAttribute('alt', keep.alt);
    return;
  }
  for (const [name, value] of Object.entries(keep)) {
    if (/^\d{1,4}$/.test(value)) el.setAttribute(name, value);
  }
}

// Replace an element with its children, keeping the text and inline structure
// of a tag we don't recognise (Gmail wraps things in <font>, <o:p>, and friends).
function unwrap(el: Element) {
  el.replaceWith(...Array.from(el.childNodes));
}

export function sanitizeNoteHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Comments can hold conditional markup; nothing in a note needs them.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  const comments: Comment[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode as Comment);
  for (const c of comments) c.remove();

  // A static snapshot: elements unwrapped below stay in the document, so their
  // children are still visited; elements dropped whole leave the tree, and the
  // isConnected check skips their orphaned descendants. Past the element cap
  // the rest of the document is removed rather than left unexamined.
  const elements = Array.from(doc.body.querySelectorAll('*'));
  let seen = 0;
  for (const el of elements) {
    if (!el.isConnected) continue;
    if (++seen > MAX_ELEMENTS) { el.remove(); continue; }
    const tag = el.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) { el.remove(); continue; }
    if (!ALLOWED_TAGS.has(tag)) { unwrap(el); continue; }
    sanitizeElement(el);
  }
  return doc.body.innerHTML.slice(0, RICH_TEXT_CAP);
}

// Tags that mean the clipboard held real formatting rather than an editor's
// habit of wrapping plain text in a <div>.
const RICH_SELECTOR = [
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'mark', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'blockquote', 'pre', 'code', 'a', 'img', 'table', 'hr',
  '[style]',
].join(',');

// Does this HTML carry formatting worth storing as rich text? Called on the
// clipboard's text/html flavour, which even a plain-text copy often carries.
export function isRichHtml(html: string): boolean {
  const clean = sanitizeNoteHtml(html);
  if (!clean.trim()) return false;
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  return !!doc.body.querySelector(RICH_SELECTOR);
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'br', 'hr', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'table', 'ul', 'ol',
]);

// Flatten rich text back to something readable in the plain-text editor: block
// boundaries become line breaks, list items keep a bullet, cells stay on one
// row separated by tabs.
export function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(sanitizeNoteHtml(html), 'text/html');
  let out = '';
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child.textContent || '').replace(/\s+/g, ' ');
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'br') { out += '\n'; continue; }
      const block = BLOCK_TAGS.has(tag);
      if (block && out && !out.endsWith('\n')) out += '\n';
      if (tag === 'li') out += '- ';
      walk(el);
      if (tag === 'td' || tag === 'th') out += '\t';
      if (block && !out.endsWith('\n')) out += '\n';
    }
  };
  walk(doc.body);
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// First line of a note's rich text, used where a plain title is needed.
export function richTextTitle(html: string): string {
  return htmlToPlainText(html).split('\n').map(l => l.trim()).find(Boolean) || '';
}

// Sanitizing runs on every render of every rich note, so results are cached by
// source string. Notes change one at a time and the map is bounded, so this
// stays small.
const renderCache = new Map<string, string>();
const RENDER_CACHE_MAX = 200;

export function renderNoteHtml(text: string): string {
  const hit = renderCache.get(text);
  if (hit !== undefined) return hit;
  const clean = sanitizeNoteHtml(text);
  if (renderCache.size >= RENDER_CACHE_MAX) renderCache.clear();
  renderCache.set(text, clean);
  return clean;
}
