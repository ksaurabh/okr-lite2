// Table notes. A note whose `format` is 'table' stores a JSON grid rather than
// markdown or HTML, so a table pasted out of a spreadsheet stays a table: cells
// stay addressable, columns keep their widths, and pasting more data into it
// fills cells instead of dumping markup into the note.
//
// Cell content is plain text. Anything pasted in is flattened on the way (the
// clipboard's HTML is only read for its grid structure), so a table note can
// never carry markup and never needs sanitizing on the way out.

export interface NoteTable {
  cols: number[];      // column widths in world px, one per column
  rows: string[][];    // row-major cells; every row has cols.length entries
  header: boolean;     // treat the first row as a header row
}

export const TABLE_MIN_COL_W = 48;
export const TABLE_DEFAULT_COL_W = 120;
export const TABLE_ROW_H = 28;      // world px per row, used to size a new note
export const TABLE_MAX_COLS = 40;
export const TABLE_MAX_ROWS = 500;
const CELL_CAP = 2000;

function cell(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, CELL_CAP) : '';
}

// Force a grid into shape: every row the same length as `cols`, sizes finite
// and clamped, dimensions capped. Used on everything that comes from outside —
// stored JSON, the clipboard, another client.
export function normalizeTable(t: Partial<NoteTable> | null | undefined): NoteTable {
  const rawRows = Array.isArray(t?.rows) ? t!.rows.slice(0, TABLE_MAX_ROWS) : [];
  const rows = rawRows.map(r => (Array.isArray(r) ? r.map(cell) : []));
  const widest = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const rawCols = Array.isArray(t?.cols) ? t!.cols : [];
  const colCount = Math.min(Math.max(widest, rawCols.length, 1), TABLE_MAX_COLS);
  const cols: number[] = [];
  for (let i = 0; i < colCount; i++) {
    const w = Number(rawCols[i]);
    cols.push(Number.isFinite(w) ? Math.max(TABLE_MIN_COL_W, Math.round(w)) : TABLE_DEFAULT_COL_W);
  }
  const shaped = rows.map(r => {
    const out = r.slice(0, colCount);
    while (out.length < colCount) out.push('');
    return out;
  });
  if (shaped.length === 0) shaped.push(cols.map(() => ''));
  return { cols, rows: shaped, header: t?.header !== false };
}

export function parseNoteTable(text: string): NoteTable {
  try {
    return normalizeTable(JSON.parse(text || '{}'));
  } catch {
    // Not JSON — the note was hand-edited or came from an older client. Read
    // whatever tabular shape the text has rather than showing an empty grid.
    return tableFromText(text) || normalizeTable(null);
  }
}

export function serializeNoteTable(t: NoteTable): string {
  return JSON.stringify(normalizeTable(t));
}

export function emptyTable(rows = 3, colCount = 3): NoteTable {
  return normalizeTable({
    cols: Array.from({ length: colCount }, () => TABLE_DEFAULT_COL_W),
    rows: Array.from({ length: rows }, () => Array.from({ length: colCount }, () => '')),
    header: true,
  });
}

// ---- Reading a grid out of pasted content ----

// Flatten one cell of pasted HTML to text: <br> and block ends become spaces,
// so a multi-line cell stays on its own row.
function cellText(el: Element): string {
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

// The first <table> in a clipboard's text/html flavour, expanded so that
// colspan/rowspan cells fill the grid they cover. Returns null when there is no
// table (or it has no cells) so callers can fall back to the plain-text path.
export function tableFromHtml(html: string): NoteTable | null {
  if (!html || !/<table/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;

  const grid: string[][] = [];
  const at = (r: number, c: number) => {
    while (grid.length <= r) grid.push([]);
    return grid[r][c];
  };
  const put = (r: number, c: number, v: string) => {
    while (grid.length <= r) grid.push([]);
    const row = grid[r];
    while (row.length < c) row.push('');
    row[c] = v;
  };

  const trs = Array.from(table.querySelectorAll('tr'));
  let firstRowIsHeader = false;
  trs.forEach((tr, r) => {
    let c = 0;
    const cells = Array.from(tr.children).filter(el => /^t[dh]$/i.test(el.tagName));
    if (r === 0 && cells.length > 0 && cells.every(el => el.tagName.toLowerCase() === 'th')) {
      firstRowIsHeader = true;
    }
    for (const el of cells) {
      while (at(r, c) !== undefined) c++; // skip cells a rowspan above already filled
      const colspan = Math.min(Math.max(parseInt(el.getAttribute('colspan') || '1', 10) || 1, 1), TABLE_MAX_COLS);
      const rowspan = Math.min(Math.max(parseInt(el.getAttribute('rowspan') || '1', 10) || 1, 1), TABLE_MAX_ROWS);
      const text = cellText(el);
      for (let dr = 0; dr < rowspan; dr++) {
        for (let dc = 0; dc < colspan; dc++) {
          // A merged cell's text goes in its top-left; the rest is left blank.
          put(r + dr, c + dc, dr === 0 && dc === 0 ? text : '');
        }
      }
      c += colspan;
    }
  });

  const rows = grid.filter(r => r.length > 0).map(r => Array.from(r, v => v ?? ''));
  if (rows.length === 0) return null;
  const colCount = Math.min(rows.reduce((m, r) => Math.max(m, r.length), 0), TABLE_MAX_COLS);
  if (colCount === 0) return null;
  return normalizeTable({
    cols: Array.from({ length: colCount }, () => TABLE_DEFAULT_COL_W),
    rows,
    header: firstRowIsHeader,
  });
}

// Split a CSV line on commas outside quotes, unescaping "" inside a field.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

const MD_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

// A grid out of plain text: tab-separated (what a spreadsheet puts on the
// clipboard), a markdown pipe table, or comma-separated. Returns null when the
// text isn't tabular — a single column of lines is a list, not a table.
export function tableFromText(text: string): NoteTable | null {
  const lines = (text || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (lines.length === 0) return null;

  let rows: string[][] | null = null;
  let header = false;

  if (lines.some(l => l.includes('\t'))) {
    rows = lines.map(l => l.split('\t').map(s => s.trim()));
  } else if (lines.filter(l => l.includes('|')).length >= 2 && lines.some(l => MD_DIVIDER.test(l))) {
    // Markdown pipe table: the divider row marks the line above it as a header
    // and is dropped from the data.
    const kept: string[][] = [];
    lines.forEach(l => {
      if (MD_DIVIDER.test(l)) { if (kept.length === 1) header = true; return; }
      const trimmed = l.trim().replace(/^\|/, '').replace(/\|$/, '');
      kept.push(trimmed.split('|').map(s => s.trim()));
    });
    rows = kept;
  } else if (lines.length > 1 && lines.every(l => l.includes(','))) {
    rows = lines.map(splitCsvLine);
  }

  if (!rows || rows.length === 0) return null;
  const colCount = Math.min(rows.reduce((m, r) => Math.max(m, r.length), 0), TABLE_MAX_COLS);
  if (colCount < 2 && rows.length < 2) return null;
  return normalizeTable({
    cols: Array.from({ length: colCount }, () => TABLE_DEFAULT_COL_W),
    rows,
    header,
  });
}

// What the clipboard holds, read as a grid: HTML first (a spreadsheet copy
// carries a real <table>), then the plain-text flavour.
export function tableFromClipboard(html: string, plain: string): NoteTable | null {
  return tableFromHtml(html) || tableFromText(plain);
}

// ---- Writing a grid back out ----

// Tab-separated, which is what a spreadsheet reads back in, and what a table
// note flattens to when it's converted to a plain-text note.
export function tableToText(t: NoteTable): string {
  return normalizeTable(t).rows.map(r => r.join('\t')).join('\n');
}

// A markdown pipe table, for converting a table note into a markdown one
// without losing its shape.
export function tableToMarkdown(t: NoteTable): string {
  const n = normalizeTable(t);
  const row = (cells: string[]) => `| ${cells.map(c => c.replace(/\|/g, '\\|')).join(' | ')} |`;
  const lines = [row(n.rows[0]), `| ${n.cols.map(() => '---').join(' | ')} |`];
  for (const r of n.rows.slice(1)) lines.push(row(r));
  return lines.join('\n');
}

// The width a note needs to show every column, plus the cell borders.
export function tableNoteWidth(t: NoteTable): number {
  return normalizeTable(t).cols.reduce((a, b) => a + b, 0) + 4;
}
export function tableNoteHeight(t: NoteTable): number {
  return normalizeTable(t).rows.length * TABLE_ROW_H + 12;
}

// ---- Grid edits ----
// Every one returns a new table; none mutate the argument.

export function setCell(t: NoteTable, r: number, c: number, value: string): NoteTable {
  const rows = t.rows.map((row, i) => (i === r ? row.map((v, j) => (j === c ? value.slice(0, CELL_CAP) : v)) : row));
  return { ...t, rows };
}

export function setColWidth(t: NoteTable, c: number, w: number): NoteTable {
  return { ...t, cols: t.cols.map((v, i) => (i === c ? Math.max(TABLE_MIN_COL_W, Math.round(w)) : v)) };
}

export function insertRow(t: NoteTable, at: number): NoteTable {
  if (t.rows.length >= TABLE_MAX_ROWS) return t;
  const rows = t.rows.slice();
  rows.splice(clampIndex(at, rows.length), 0, t.cols.map(() => ''));
  return { ...t, rows };
}

export function deleteRow(t: NoteTable, at: number): NoteTable {
  if (t.rows.length <= 1) return t;
  const rows = t.rows.slice();
  rows.splice(clampIndex(at, rows.length - 1), 1);
  return { ...t, rows };
}

export function insertCol(t: NoteTable, at: number): NoteTable {
  if (t.cols.length >= TABLE_MAX_COLS) return t;
  const i = clampIndex(at, t.cols.length);
  const cols = t.cols.slice();
  cols.splice(i, 0, TABLE_DEFAULT_COL_W);
  return { ...t, cols, rows: t.rows.map(r => { const n = r.slice(); n.splice(i, 0, ''); return n; }) };
}

export function deleteCol(t: NoteTable, at: number): NoteTable {
  if (t.cols.length <= 1) return t;
  const i = clampIndex(at, t.cols.length - 1);
  const cols = t.cols.slice();
  cols.splice(i, 1);
  return { ...t, cols, rows: t.rows.map(r => { const n = r.slice(); n.splice(i, 1); return n; }) };
}

function clampIndex(i: number, max: number): number {
  return Math.max(0, Math.min(Math.round(i), max));
}

// Drop a pasted grid into the table with its top-left at (r, c), growing the
// table as far as the pasted block reaches. New columns get the default width.
export function pasteInto(t: NoteTable, r: number, c: number, block: NoteTable): NoteTable {
  const needCols = Math.min(c + block.cols.length, TABLE_MAX_COLS);
  const needRows = Math.min(r + block.rows.length, TABLE_MAX_ROWS);
  let next = t;
  while (next.cols.length < needCols) next = insertCol(next, next.cols.length);
  while (next.rows.length < needRows) next = insertRow(next, next.rows.length);
  const rows = next.rows.map(row => row.slice());
  block.rows.forEach((brow, dr) => {
    brow.forEach((v, dc) => {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < rows.length && cc < next.cols.length) rows[rr][cc] = v;
    });
  });
  return { ...next, rows };
}

// ---- Display ----

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Static HTML for a table note that isn't being edited. Cells are escaped, so
// the output holds no markup but the tags written here.
export function renderNoteTable(text: string): string {
  const t = parseNoteTable(text);
  const colgroup = `<colgroup>${t.cols.map(w => `<col style="width:${w}px">`).join('')}</colgroup>`;
  const body = t.rows.map((row, r) => {
    const tag = t.header && r === 0 ? 'th' : 'td';
    return `<tr>${row.map(v => `<${tag}>${escapeHtml(v)}</${tag}>`).join('')}</tr>`;
  }).join('');
  return `<table class="note-table">${colgroup}<tbody>${body}</tbody></table>`;
}

// The first row, for a collapsed note: a table's header line says more about
// it than any single cell.
export function tableSummary(text: string): string {
  const t = parseNoteTable(text);
  const first = t.rows.find(r => r.some(v => v.trim())) || [];
  return first.filter(v => v.trim()).join(' · ');
}

// First non-empty cell, used where a plain title is needed.
export function tableTitle(text: string): string {
  for (const row of parseNoteTable(text).rows) {
    for (const v of row) if (v.trim()) return v.trim().slice(0, 200);
  }
  return '';
}
