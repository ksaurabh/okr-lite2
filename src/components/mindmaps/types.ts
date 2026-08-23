// Mindmap = a sticky-note canvas. World coordinates may be negative.
export interface MindmapNote {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string; // hex
  // markdown source; sanitized HTML when format is 'html'; a JSON NoteTable
  // (see table.ts) when format is 'table'.
  text: string;
  // 'html' = a rich-text note, entered when formatted content is pasted in.
  // 'table' = a grid of cells with resizable columns, entered by adding a table
  // or by pasting spreadsheet cells. Absent means markdown, which is what every
  // note starts as.
  format?: 'markdown' | 'html' | 'table';
  linkedMindmapId?: string; // optional link to another mindmap
  tags?: string[]; // free-form, lowercased
}

// A per-mindmap named tag filter, granted to zero or more user groups.
export interface MindmapView {
  id: string;
  name: string;
  mode: 'include' | 'exclude'; // include = only targeted notes; exclude = all but
  frameIds: string[];          // notes in these frames are targeted
  tags: string[];              // …as are notes with these tags (optional)
  groupIds: string[];
  isDefault?: boolean;         // if true, this view is applied on load
}

// A named rectangle grouping a set of notes. Its top-left is derived from the
// member notes' bounding box; moving the frame moves all members together.
// Resizing it only changes the box: `w`/`h` (world px, unset until someone
// drags the grip) hold that manual size, and the box still grows past it if the
// notes need the room.
export interface MindmapFrame {
  id: string;
  name: string;
  noteIds: string[];
  w?: number;
  h?: number;
}

// A saved card size (width × height, world px). Apply a template to a note to
// snap it to that size. Created from a note's current dimensions.
export interface MindmapTemplate {
  id: string;
  name: string;
  w: number;
  h: number;
}

// A user group (org-scoped). Members list is admin-only.
export interface MindmapGroup {
  id: string;
  name: string;
  memberEmails?: string[];
  memberCount?: number;
}

export interface Mindmap {
  id: string;
  title: string;
  creatorEmail: string;
  creatorName: string;
  shared: boolean;
  sharedWith?: string[]; // emails (creator-only)
  views?: MindmapView[]; // creator-only
  frames?: MindmapFrame[];
  templates?: MindmapTemplate[]; // creator-only
  createdAt: string;
  updatedAt: string;
  notes: MindmapNote[];
}

// A folder in the viewer's private mindmap tree. Folders are per-user: they
// organize the maps you can see (including shared ones) without touching the
// maps themselves. Nesting is by parentId; null = top level.
export interface MindmapFolder {
  id: string;
  name: string;
  parentId: string | null;
}

// Row shape returned by GET /api/mindmaps (notes omitted, count only).
export interface MindmapListItem {
  id: string;
  title: string;
  creatorEmail: string;
  creatorName: string;
  shared: boolean;
  sharedWith?: string[]; // emails (creator-only)
  createdAt: string;
  updatedAt: string;
  noteCount: number;
  mine: boolean;
  starred: boolean;
  folderId: string | null; // per-viewer filing; null = unfiled
}

// Ten distinct pastels for the palette: yellow, red, green, blue, violet,
// orange, pink, teal, purple, lemon — laid out as a 5×2 grid.
export const PALETTE: string[] = [
  '#fde68a', '#fca5a5', '#86efac', '#93c5fd', '#c4b5fd',
  '#fdba74', '#f9a8d4', '#5eead4', '#d8b4fe', '#fef08a',
];

export const DEFAULT_NOTE_COLOR = '#fde68a';
export const NOTE_MIN_W = 80;
export const NOTE_MIN_H = 60;
export const NEW_NOTE_W = 220;
export const NEW_NOTE_H = 160;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2.5;
