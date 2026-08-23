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

// A markdown pipe table: a header row, a `|---|---|` divider, then body rows.
// Recognised so that a table note switched back to markdown still reads as a
// table, and so a hand-typed one renders like one.
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

function renderTableBlock(rows: string[][]): string {
  const cells = (row: string[], tag: 'td' | 'th') =>
    row.map(c => `<${tag}>${inline(c)}</${tag}>`).join('');
  const head = `<tr>${cells(rows[0], 'th')}</tr>`;
  const body = rows.slice(1).map(r => `<tr>${cells(r, 'td')}</tr>`).join('');
  return `<table class="note-table md-table"><tbody>${head}${body}</tbody></table>`;
}

export function renderNoteMarkdown(src: string): string {
  const escaped = escapeHtml(src ?? '');
  const lines = escaped.split(/\r?\n/);
  const html: string[] = [];

  // Consecutive non-blank text lines belong to one paragraph (joined by <br>),
  // so a blank line between them is a real paragraph break rather than nothing.
  let para: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    html.push(`<p>${para.join('<br>')}</p>`);
    para = [];
  };

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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Table block: this line plus the divider under it start one, and it runs
    // to the first line that isn't a pipe row.
    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      flushPara();
      closeAllLists();
      const rows = [splitTableRow(line)];
      let j = i + 2;
      for (; j < lines.length && lines[j].includes('|') && lines[j].trim() !== ''; j++) {
        rows.push(splitTableRow(lines[j]));
      }
      // Every row padded to the header's width, so the grid stays rectangular.
      const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
      for (const r of rows) while (r.length < width) r.push('');
      html.push(renderTableBlock(rows));
      i = j - 1;
      continue;
    }

    const item = matchListItem(line);
    if (item) {
      flushPara();
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
      flushPara();
      closeAllLists();
      const level = m[1].length;
      html.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if (line.trim() === '') {
      flushPara();
      closeAllLists();
    } else {
      closeAllLists();
      para.push(inline(line));
    }
  }
  flushPara();
  closeAllLists();
  return html.join('');
}
