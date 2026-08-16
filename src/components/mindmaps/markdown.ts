// Render a sticky note's markdown source to HTML. The source is HTML-escaped
// FIRST, so note text can never inject markup — the only tags in the output are
// the ones this renderer inserts. Supports headings, bullet/numbered lists,
// bold, italic, inline code, and autolinked URLs.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Marker for a finished anchor parked while the other inline rules run, so the
// autolink rule can't chew through an href it already produced. A NUL can
// never reach here from a note's source.
const HOLD = '\u0000';

function inline(s: string): string {
  // Inline code first, so its contents aren't re-processed as emphasis.
  let out = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // [text](target) links. `mindmap:<id>` targets navigate within the app (the
  // canvas intercepts the click); http(s) targets open in a new tab. Anything
  // else is left as literal text rather than becoming an arbitrary href.
  const held: string[] = [];
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, text: string, target: string) => {
    let anchor: string;
    const mindmapTarget = /^mindmap:(mm_[A-Za-z0-9_-]+)$/.exec(target);
    if (mindmapTarget) {
      anchor = `<a href="/mindmap/${mindmapTarget[1]}" data-mindmap-link="${mindmapTarget[1]}">${text}</a>`;
    } else if (/^https?:\/\//.test(target)) {
      anchor = `<a href="${target}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    } else {
      return whole;
    }
    held.push(anchor);
    return `${HOLD}${held.length - 1}${HOLD}`;
  });
  // Autolink bare URLs (already HTML-escaped, so & is &amp; — valid in href).
  out = out.replace(
    /(https?:\/\/[^\s<]+)/g,
    (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`,
  );
  // Bold, then italic.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Put the parked anchors back.
  out = out.replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, 'g'), (_m, i: string) => held[Number(i)]);
  return out;
}

// Detect a list item, returning its nesting depth (from leading indentation),
// list type, and content. Indent it by two spaces (or a tab) per level.
function matchListItem(line: string): { depth: number; type: 'ul' | 'ol'; content: string } | null {
  const expanded = line.replace(/\t/g, '  '); // a tab counts as one indent level
  const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(expanded);
  if (!m) return null;
  const depth = Math.floor(m[1].length / 2);
  const type: 'ul' | 'ol' = /\d/.test(m[2]) ? 'ol' : 'ul';
  return { depth, type, content: m[3] };
}

export function renderNoteMarkdown(src: string): string {
  const escaped = escapeHtml(src ?? '');
  const lines = escaped.split(/\r?\n/);
  const html: string[] = [];

  // Stack of open lists, one per nesting level. `liOpen` tracks whether the
  // <li> at each level is still open (a child list nests inside an open <li>).
  const stack: Array<'ul' | 'ol'> = [];
  const liOpen: boolean[] = [];

  const closeItem = () => {
    const top = liOpen.length - 1;
    if (top >= 0 && liOpen[top]) { html.push('</li>'); liOpen[top] = false; }
  };
  const openList = (type: 'ul' | 'ol') => { html.push(`<${type}>`); stack.push(type); liOpen.push(false); };
  const closeList = () => { closeItem(); html.push(`</${stack.pop()}>`); liOpen.pop(); };
  const closeAllLists = () => { while (stack.length) closeList(); };

  for (const line of lines) {
    const item = matchListItem(line);
    if (item) {
      // Can't nest deeper than one level below what's currently open.
      const depth = Math.min(item.depth, stack.length);
      while (stack.length > depth + 1) closeList();     // came back out
      if (stack.length === depth + 1) {
        if (stack[depth] !== item.type) { closeList(); openList(item.type); }
        else closeItem();                                // sibling at same level
      } else {
        while (stack.length < depth + 1) openList(item.type); // go deeper (inside open <li>)
      }
      html.push(`<li>${inline(item.content)}`);
      liOpen[depth] = true;
      continue;
    }

    let m: RegExpExecArray | null;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      closeAllLists();
      const level = m[1].length;
      html.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if (line.trim() === '') {
      closeAllLists();
    } else {
      closeAllLists();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeAllLists();
  return html.join('');
}
