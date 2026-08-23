// Kanban notes. A note whose `format` is 'kanban' stores a board — columns of
// cards — as JSON, so the cards stay individually addressable: they can be
// reordered inside a column and moved between columns without rewriting text.
//
// Card text is plain, so a board can never carry markup and never needs
// sanitizing on the way out. Everything that arrives from outside (stored JSON,
// another client) goes through `normalizeBoard` before it's used.

export interface KanbanCard {
  id: string;
  text: string;
}

export interface KanbanColumn {
  id: string;
  name: string;
  cards: KanbanCard[];
}

export interface KanbanBoard {
  cols: KanbanColumn[];
}

// The board every new kanban note starts as.
export const DEFAULT_COLUMNS: Array<{ id: string; name: string }> = [
  { id: 'todo', name: 'Todo' },
  { id: 'doing', name: 'In Progress' },
  { id: 'done', name: 'Done' },
];

export const KANBAN_COL_W = 190;      // world px per column
export const KANBAN_MIN_H = 260;      // world px for a new board note
const CARD_CAP = 2000;
const NAME_CAP = 60;
const MAX_COLS = 8;
const MAX_CARDS = 300;

export function newCardId(): string {
  return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCard(c: unknown, seen: Set<string>): KanbanCard {
  const raw = c && typeof c === 'object' ? c as Partial<KanbanCard> : {};
  let id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : newCardId();
  // Ids address cards during a drag, so a duplicate would move the wrong one.
  while (seen.has(id)) id = newCardId();
  seen.add(id);
  return { id, text: typeof raw.text === 'string' ? raw.text.slice(0, CARD_CAP) : '' };
}

export function normalizeBoard(b: Partial<KanbanBoard> | null | undefined): KanbanBoard {
  const rawCols = Array.isArray(b?.cols) ? b!.cols.slice(0, MAX_COLS) : [];
  const seenCards = new Set<string>();
  const seenCols = new Set<string>();
  const cols: KanbanColumn[] = rawCols.map((c, i) => {
    const raw = c && typeof c === 'object' ? c as Partial<KanbanColumn> : {};
    let id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : `col_${i}`;
    while (seenCols.has(id)) id = `${id}_${i}`;
    seenCols.add(id);
    const name = typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim().slice(0, NAME_CAP)
      : DEFAULT_COLUMNS[i]?.name || `Column ${i + 1}`;
    const cards = (Array.isArray(raw.cards) ? raw.cards.slice(0, MAX_CARDS) : [])
      .map(card => normalizeCard(card, seenCards));
    return { id, name, cards };
  });
  return { cols: cols.length ? cols : emptyBoard().cols };
}

export function emptyBoard(): KanbanBoard {
  return { cols: DEFAULT_COLUMNS.map(c => ({ id: c.id, name: c.name, cards: [] })) };
}

export function parseNoteKanban(text: string): KanbanBoard {
  try {
    return normalizeBoard(JSON.parse(text || '{}'));
  } catch {
    return emptyBoard();
  }
}

export function serializeNoteKanban(b: KanbanBoard): string {
  return JSON.stringify(normalizeBoard(b));
}

// ---- Board edits ----
// Every one returns a new board; none mutate the argument.

export function addCard(b: KanbanBoard, colId: string, text = ''): { board: KanbanBoard; cardId: string } {
  const cardId = newCardId();
  const board = {
    cols: b.cols.map(c => (c.id === colId && c.cards.length < MAX_CARDS
      ? { ...c, cards: [...c.cards, { id: cardId, text: text.slice(0, CARD_CAP) }] }
      : c)),
  };
  return { board, cardId };
}

export function setCardText(b: KanbanBoard, cardId: string, text: string): KanbanBoard {
  return {
    cols: b.cols.map(c => ({
      ...c,
      cards: c.cards.map(card => (card.id === cardId ? { ...card, text: text.slice(0, CARD_CAP) } : card)),
    })),
  };
}

export function deleteCard(b: KanbanBoard, cardId: string): KanbanBoard {
  return { cols: b.cols.map(c => ({ ...c, cards: c.cards.filter(card => card.id !== cardId) })) };
}

// Move a card to `index` within `toColId`. The index is read against the column
// as the card's caller sees it — with the card still in place — so a move
// inside one column lands where the drop indicator was drawn.
export function moveCard(b: KanbanBoard, cardId: string, toColId: string, index: number): KanbanBoard {
  const from = b.cols.find(c => c.cards.some(card => card.id === cardId));
  const card = from?.cards.find(c => c.id === cardId);
  if (!from || !card) return b;
  const sameColumn = from.id === toColId;
  const fromIndex = from.cards.findIndex(c => c.id === cardId);
  // Dropping a card back where it already is: nothing to do (and the index
  // shift below would otherwise move it one place backwards).
  if (sameColumn && (index === fromIndex || index === fromIndex + 1)) return b;
  const target = sameColumn && index > fromIndex ? index - 1 : index;

  return {
    cols: b.cols.map(c => {
      const cards = c.cards.filter(x => x.id !== cardId);
      if (c.id !== toColId) return { ...c, cards };
      const at = Math.max(0, Math.min(Math.round(target), cards.length));
      const next = cards.slice();
      next.splice(at, 0, card);
      return { ...c, cards: next };
    }),
  };
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

// Static HTML for a board nobody can edit (a read-only viewer). The interactive
// board is a React component; this is the same markup without the handlers.
export function renderNoteKanban(text: string): string {
  const b = parseNoteKanban(text);
  const cols = b.cols.map(c => {
    const cards = c.cards.map(card =>
      `<div class="kanban-card">${escapeHtml(card.text) || '<span class="kanban-empty">Empty card</span>'}</div>`
    ).join('');
    return `<div class="kanban-col" style="width:${KANBAN_COL_W}px">`
      + `<div class="kanban-col-head">${escapeHtml(c.name)}<span class="kanban-count">${c.cards.length}</span></div>`
      + `<div class="kanban-col-body">${cards}</div></div>`;
  }).join('');
  return `<div class="kanban">${cols}</div>`;
}

// First card's text, used where a plain title is needed.
export function kanbanTitle(text: string): string {
  for (const col of parseNoteKanban(text).cols) {
    for (const card of col.cards) if (card.text.trim()) return card.text.trim().slice(0, 200);
  }
  return '';
}

// One line describing the board, for a collapsed note: each column and how
// many cards it holds.
export function kanbanSummary(text: string): string {
  return parseNoteKanban(text).cols.map(c => `${c.name} ${c.cards.length}`).join(' · ');
}

export function kanbanNoteWidth(b: KanbanBoard): number {
  return b.cols.length * (KANBAN_COL_W + 8) + 8;
}
