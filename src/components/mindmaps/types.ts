// Mindmap = a sticky-note canvas. World coordinates may be negative.
export interface MindmapNote {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string; // hex
  text: string;  // markdown source
}

export interface Mindmap {
  id: string;
  title: string;
  creatorEmail: string;
  creatorName: string;
  shared: boolean;
  createdAt: string;
  updatedAt: string;
  notes: MindmapNote[];
}

// Row shape returned by GET /api/mindmaps (notes omitted, count only).
export interface MindmapListItem {
  id: string;
  title: string;
  creatorEmail: string;
  creatorName: string;
  shared: boolean;
  createdAt: string;
  updatedAt: string;
  noteCount: number;
  mine: boolean;
  starred: boolean;
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
