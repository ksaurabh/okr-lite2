import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Mindmap, MindmapNote, MindmapView, MindmapFrame, MindmapTemplate } from './types';
import {
  PALETTE, DEFAULT_NOTE_COLOR, NOTE_MIN_W, NOTE_MIN_H,
  NEW_NOTE_W, NEW_NOTE_H, ZOOM_MIN, ZOOM_MAX, noteRenderHeight,
} from './types';
import { renderNoteMarkdown } from './markdown';
import { isRichHtml, sanitizeNoteHtml, renderNoteHtml, htmlToPlainText, richTextTitle } from './richtext';
import type { NoteTable } from './table';
import {
  parseNoteTable, serializeNoteTable, emptyTable, renderNoteTable, tableTitle,
  tableFromClipboard, tableToMarkdown, tableNoteWidth, tableNoteHeight, tableSummary,
} from './table';
import { TableNoteEditor } from './TableNoteEditor';
import type { KanbanBoard } from './kanban';
import {
  emptyBoard, parseNoteKanban, serializeNoteKanban, renderNoteKanban, kanbanTitle,
  kanbanSummary, kanbanNoteWidth, KANBAN_MIN_H,
} from './kanban';
import { KanbanBoardView } from './KanbanBoardView';
import { navigateTo, navigateToMindmap, navigateBackToMindmap, getMindmapBackStack } from './nav';
import { ShareMindmapModal } from './ShareMindmapModal';
import { NoteLinkModal } from './NoteLinkModal';
import { LinkTextModal } from './LinkTextModal';
import { NoteTagsModal } from './NoteTagsModal';
import { ManageViewsModal } from './ManageViewsModal';
import { TextPromptModal } from './TextPromptModal';
import { useAuth } from '../../context/AuthContext';

const FRAME_PAD = 20; // world px of padding between a frame's edge and its notes
const UNDO_WINDOW_MS = 30000; // how long the "undo delete" banner sticks around

const API_URL = import.meta.env.VITE_API_URL || '';

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function newNoteId() { return `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`; }

// A view "targets" a note if the note is in one of the view's frames or has one
// of the view's tags. include = show only targeted; exclude = show all but them.
// Mirrors the server's viewAdmitsNote so client and server agree exactly.
function viewAdmitsNote(view: MindmapView, note: MindmapNote, frames: MindmapFrame[]): boolean {
  const targetFrameSet = new Set(view.frameIds || []);
  const targetTagSet = new Set(view.tags || []);
  const inTargetedFrame = targetFrameSet.size > 0 && frames.some(
    f => targetFrameSet.has(f.id) && f.noteIds.includes(note.id)
  );
  const hasTargetedTag = targetTagSet.size > 0 && (note.tags || []).some(t => targetTagSet.has(t));
  const targeted = inTargetedFrame || hasTargetedTag;
  return view.mode === 'include' ? targeted : !targeted;
}
function filterNotesByView(notes: MindmapNote[], view: MindmapView, frames: MindmapFrame[]): MindmapNote[] {
  return notes.filter(n => viewAdmitsNote(view, n, frames));
}

// A new mindmap made from a note takes the note's first "# heading" line as its
// title; failing that, the first non-empty line; failing that, a default.
function titleFromNote(text: string): string {
  const lines = (text || '').split(/\r?\n/);
  const heading = lines.find(l => /^#{1,6}\s+\S/.test(l));
  if (heading) return heading.replace(/^#{1,6}\s+/, '').trim().slice(0, 200);
  const firstNonEmpty = lines.map(l => l.trim()).find(Boolean);
  return (firstNonEmpty || 'Untitled mindmap').slice(0, 200);
}

// The one line a collapsed note shows. Each format has its own idea of what
// its first line is: a heading or first line of text, the first row of a table,
// the columns of a board.
function noteFirstLine(n: MindmapNote): string {
  if (n.format === 'html') return richTextTitle(n.text);
  if (n.format === 'table') return tableSummary(n.text);
  if (n.format === 'kanban') return kanbanSummary(n.text);
  const line = (n.text || '').split(/\r?\n/).map(l => l.trim()).find(Boolean) || '';
  return line
    .replace(/^#{1,6}\s+/, '')            // heading marker
    .replace(/^([-*]|\d+\.)\s+/, '')     // list bullet
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1') // link → its text
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // bold
    .replace(/\*([^*]+)\*/g, '$1')       // italic
    .replace(/`([^`]+)`/g, '$1');        // inline code
}

interface View { tx: number; ty: number; scale: number; }

// Active pointer interaction. Only one runs at a time.
type Interaction =
  | { kind: 'pan'; startX: number; startY: number; startTx: number; startTy: number }
  | { kind: 'marquee'; startX: number; startY: number }
  | { kind: 'drag'; id: string; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'groupdrag'; startX: number; startY: number; origins: Record<string, { x: number; y: number }> }
  | { kind: 'framedrag'; frameId: string; startX: number; startY: number; origins: Record<string, { x: number; y: number }> }
  | { kind: 'resize'; id: string; startX: number; startY: number; origW: number; origH: number }
  | {
      kind: 'frameresize'; frameId: string; startX: number; startY: number;
      origRect: FrameRect; contentW: number; contentH: number;
    }
  | null;

interface FrameRect { x: number; y: number; w: number; h: number; }

// How close (screen px) the pointer must come to a frame's outline before that
// frame reveals its resize grip.
const FRAME_EDGE_HOVER_PX = 24;
// Window for treating two clicks on the same note as a double-click.
const DOUBLE_CLICK_MS = 450;

export function MindmapCanvasPage() {
  const id = window.location.pathname.split('/')[2] || '';
  const { user } = useAuth();
  const selfEmail = user?.email || '';
  const backStack = getMindmapBackStack();

  const [status, setStatus] = useState<'loading' | 'notfound' | 'ready'>('loading');
  const [title, setTitle] = useState('');
  const [shared, setShared] = useState(false);
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [starred, setStarred] = useState(false);
  const [notes, setNotes] = useState<MindmapNote[]>([]);
  const [views, setViews] = useState<MindmapView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [showViewSwitcher, setShowViewSwitcher] = useState(false);
  const [frames, setFrames] = useState<MindmapFrame[]>([]);
  const [templates, setTemplates] = useState<MindmapTemplate[]>([]);
  const [showShare, setShowShare] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [linkNoteId, setLinkNoteId] = useState<string | null>(null);
  const [tagNoteId, setTagNoteId] = useState<string | null>(null);
  // Pending frame creation from the current selection, and frame rename.
  const [framePromptNoteIds, setFramePromptNoteIds] = useState<string[] | null>(null);
  const [renameFrameId, setRenameFrameId] = useState<string | null>(null);
  // Template creation prompt (note id whose size we're saving), and the open
  // resize menu anchored on a note.
  const [templatePromptNoteId, setTemplatePromptNoteId] = useState<string | null>(null);
  const [resizeMenuNoteId, setResizeMenuNoteId] = useState<string | null>(null);
  // Open frame-membership menu, anchored on a note's action bar.
  const [frameMenuNoteId, setFrameMenuNoteId] = useState<string | null>(null);

  const [view, setViewState] = useState<View>({ tx: 0, ty: 0, scale: 1 });
  const viewRef = useRef(view);
  const setView = useCallback((updater: View | ((prev: View) => View)) => {
    setViewState(prev => {
      const next = typeof updater === 'function' ? (updater as (p: View) => View)(prev) : updater;
      viewRef.current = next;
      return next;
    });
  }, []);

  const [editingId, setEditingId] = useState<string | null>(null);
  const editingIdRef = useRef(editingId);
  editingIdRef.current = editingId;
  const [editingText, setEditingText] = useState('');
  // Which editor the note being edited uses. Markdown notes switch to 'html'
  // the moment formatted content is pasted into them (and can be switched back
  // by hand); the rich editor is a contenteditable, so its content lives in the
  // DOM rather than in state — `richSeedRef` is what it opens with.
  const [editingFormat, setEditingFormat] = useState<'markdown' | 'html' | 'table'>('markdown');
  // Kept in a ref as well, and set the instant a switch starts: swapping
  // editors unmounts one of them, and whichever handler runs during that swap
  // must act on the format the note is landing in, not the one it left.
  const editingFormatRef = useRef(editingFormat);
  editingFormatRef.current = editingFormat;
  const richRef = useRef<HTMLDivElement | null>(null);
  const richSeedRef = useRef('');
  // The grid being edited in a table note, mirrored into a ref so the commit
  // that runs as the editor unmounts sees the latest cells.
  const [editingTable, setEditingTable] = useState<NoteTable | null>(null);
  const editingTableRef = useRef<NoteTable | null>(null);
  editingTableRef.current = editingTable;
  // The rich editor's selection, captured before the link picker takes focus.
  const richRangeRef = useRef<Range | null>(null);
  // Last plain click on a note, for our own double-click detection (see the
  // mouseup handler), and a live handle on beginEdit for that handler to call.
  const lastNoteClickRef = useRef<{ id: string; t: number } | null>(null);
  const beginEditRef = useRef<(n: MindmapNote) => void>(() => {});
  // Turning the selected text of the note being edited into a mindmap link. The
  // textarea's selection range is captured up front, because opening the picker
  // moves focus and loses it.
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const [linkSelection, setLinkSelection] = useState<{ start: number; end: number; text: string } | null>(null);
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  // Selected notes. A single selection shows the note's action bar and resize
  // grip; a multi-selection (from a marquee drag on empty canvas) can be moved
  // together. Selection happens on a plain click or a marquee; a press-and-drag
  // on a single note moves it instead.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  const soleSelected = selectedIds.length === 1 ? selectedIds[0] : null;
  // Rubber-band rectangle in canvas-relative pixels while marquee-selecting.
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Last deletion, offered as an undo banner for 30s. Holds the deleted notes
  // and the frame list as it was before the delete, so frame membership (and
  // frames emptied by the delete) can be put back too.
  const [undoDelete, setUndoDelete] = useState<{ notes: MindmapNote[]; frames: MindmapFrame[] } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const spaceRef = useRef(false);
  const interactionRef = useRef<Interaction>(null);
  const movedRef = useRef(false);
  const canEditRef = useRef(false);
  canEditRef.current = canEdit;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // In-app clipboard for copy/paste (Cmd/Ctrl+C / +V). Holds note data without
  // ids; each paste offsets a little further so clones don't stack exactly.
  const clipboardRef = useRef<Array<Omit<MindmapNote, 'id'>>>([]);
  const pasteCountRef = useRef(0);

  // ---- Load ----
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/mindmaps/${id}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { mindmap: Mindmap; canEdit: boolean; starred: boolean; hasLastView?: boolean; lastViewId?: string | null }) => {
        if (cancelled) return;
        setTitle(d.mindmap.title);
        setShared(!!d.mindmap.shared);
        setSharedWith(Array.isArray(d.mindmap.sharedWith) ? d.mindmap.sharedWith : []);
        const loadedViews = Array.isArray(d.mindmap.views) ? d.mindmap.views : [];
        setViews(loadedViews);
        const loadedFrames = Array.isArray(d.mindmap.frames) ? d.mindmap.frames : [];
        setFrames(loadedFrames);
        setTemplates(Array.isArray(d.mindmap.templates) ? d.mindmap.templates : []);
        setCanEdit(!!d.canEdit);
        setStarred(!!d.starred);
        const loadedNotes = Array.isArray(d.mindmap.notes) ? d.mindmap.notes : [];
        setNotes(loadedNotes);
        // Reopen where this viewer left off: the view they last had active on
        // this map wins over the map's default. A remembered "All" (null) counts
        // as a choice and is honoured as-is; the server already dropped a
        // remembered view they can no longer use.
        const remembered = d.hasLastView
          ? loadedViews.find(v => v.id === d.lastViewId) || null
          : undefined;
        if (remembered !== undefined) {
          // …but never open onto a blank board, same rule as the default below.
          if (remembered && filterNotesByView(loadedNotes, remembered, loadedFrames).length > 0) {
            setActiveViewId(remembered.id);
          }
        } else {
          // Open in the configured default view — but only if the viewer can access
          // it AND it actually shows something. If the default would render an empty
          // board (e.g. an include view whose frame/tags match nothing), fall back to
          // no active view, which shows all notes (creators) / the granted union.
          const defaultView = loadedViews.find(v => v.isDefault);
          if (defaultView && filterNotesByView(loadedNotes, defaultView, loadedFrames).length > 0) {
            setActiveViewId(defaultView.id);
          }
        }
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('notfound'); });
    return () => { cancelled = true; };
  }, [id]);

  // body { overflow: hidden } for the canvas page only.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Clear selection when the active view changes
  useEffect(() => {
    setSelectedIds([]);
  }, [activeViewId]);

  // Fit-to-notes once the map is loaded.
  const fitView = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ns = notesRef.current;
    if (ns.length === 0) { setView({ tx: 0, ty: 0, scale: 1 }); return; }
    const minX = Math.min(...ns.map(n => n.x));
    const minY = Math.min(...ns.map(n => n.y));
    const maxX = Math.max(...ns.map(n => n.x + n.w));
    const maxY = Math.max(...ns.map(n => n.y + noteRenderHeight(n)));
    const pad = 80;
    const scale = clamp(Math.min(rect.width / (maxX - minX + pad * 2), rect.height / (maxY - minY + pad * 2)), ZOOM_MIN, 1);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setView({ tx: rect.width / 2 - cx * scale, ty: rect.height / 2 - cy * scale, scale });
  }, [setView]);

  useEffect(() => {
    if (status === 'ready') fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // ---- Persistence: debounce ~500ms then PUT the notes and frames ----
  const scheduleSave = useCallback(() => {
    if (!canEditRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`${API_URL}/api/mindmaps/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notesRef.current, frames: framesRef.current }),
      }).catch(() => {});
    }, 500);
  }, [id]);

  // Immediate metadata save (title / shared) — creator only.
  const putMeta = useCallback((patch: { title?: string; shared?: boolean; views?: MindmapView[]; templates?: MindmapTemplate[] }) => {
    if (!canEditRef.current) return;
    fetch(`${API_URL}/api/mindmaps/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }, [id]);

  // ---- Coordinate helpers ----
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    const r = el!.getBoundingClientRect();
    const { tx, ty, scale } = viewRef.current;
    return { wx: (clientX - r.left - tx) / scale, wy: (clientY - r.top - ty) / scale };
  }, []);

  // ---- Zoom ----
  const zoomAbout = useCallback((clientX: number, clientY: number, factor: number) => {
    const el = canvasRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const { tx, ty, scale } = viewRef.current;
    const newScale = clamp(scale * factor, ZOOM_MIN, ZOOM_MAX);
    const wx = (clientX - r.left - tx) / scale;
    const wy = (clientY - r.top - ty) / scale;
    setView({ tx: clientX - r.left - wx * newScale, ty: clientY - r.top - wy * newScale, scale: newScale });
  }, [setView]);

  // Wheel zoom about the cursor — non-passive so preventDefault works.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = (e.ctrlKey || e.metaKey) ? 1.05 : 1.12;
      const factor = e.deltaY < 0 ? step : 1 / step;
      zoomAbout(e.clientX, e.clientY, factor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAbout]);

  const zoomButton = (factor: number) => {
    const el = canvasRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zoomAbout(r.left + r.width / 2, r.top + r.height / 2, factor);
  };

  // ---- Space key → pan mode (ignore while typing in a field) ----
  useEffect(() => {
    // Close view switcher when clicking outside
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (showViewSwitcher && !target.closest('[data-view-switcher]')) {
        setShowViewSwitcher(false);
      }
    };
    if (showViewSwitcher) {
      document.addEventListener('click', onClick);
      return () => document.removeEventListener('click', onClick);
    }
  }, [showViewSwitcher]);

  useEffect(() => {
    const isField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isField(e.target)) {
        e.preventDefault();
        spaceRef.current = true;
        setIsSpaceDown(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') { spaceRef.current = false; setIsSpaceDown(false); }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  // ---- Copy / paste selected notes (Cmd/Ctrl+C, Cmd/Ctrl+V) ----
  // Skipped while editing a note or typing in a field, so native text
  // copy/paste keeps working there.
  useEffect(() => {
    const isField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || editingId !== null || isField(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'c') {
        const byId = new Map(notesRef.current.map(n => [n.id, n]));
        const copied = selectedRef.current
          .map(sid => byId.get(sid))
          .filter((n): n is MindmapNote => !!n)
          .map(({ x, y, w, h, color, text, format, collapsed }) => ({ x, y, w, h, color, text, format, collapsed }));
        if (copied.length === 0) return;
        e.preventDefault();
        clipboardRef.current = copied;
        pasteCountRef.current = 0;
      } else if (key === 'v') {
        if (!canEditRef.current || clipboardRef.current.length === 0) return;
        e.preventDefault();
        pasteCountRef.current += 1;
        const off = 24 * pasteCountRef.current;
        const clones: MindmapNote[] = clipboardRef.current.map(c => ({
          ...c, id: newNoteId(), x: c.x + off, y: c.y + off,
        }));
        setNotes(prev => [...prev, ...clones]);
        setSelectedIds(clones.map(c => c.id));
        scheduleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingId, scheduleSave]);

  // ---- Pasting from outside the app: drop the clipboard into a new note ----
  // Only reached when the in-app clipboard is empty (⌘V prefers copied notes)
  // and nothing is being edited, so it never competes with editing a note.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!canEditRef.current || editingIdRef.current !== null) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const html = e.clipboardData?.getData('text/html') || '';
      const plain = e.clipboardData?.getData('text/plain') || '';
      const rich = !!html && isRichHtml(html);
      if (!rich && !plain.trim()) return;
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      const { wx, wy } = rect
        ? screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
        : { wx: 0, wy: 0 };
      // Spreadsheet cells (a real <table> on the clipboard, or tab-separated
      // rows) become a table note rather than a wall of text.
      const grid = tableFromClipboard(html, plain);
      const gridW = grid ? Math.min(tableNoteWidth(grid) + 16, 1200) : 0;
      const gridH = grid ? Math.min(tableNoteHeight(grid) + 34, 900) : 0;
      const note: MindmapNote = grid ? {
        id: newNoteId(),
        x: wx - gridW / 2,
        y: wy - gridH / 2,
        w: Math.max(NOTE_MIN_W, gridW),
        h: Math.max(NOTE_MIN_H, gridH),
        color: DEFAULT_NOTE_COLOR,
        text: serializeNoteTable(grid),
        format: 'table' as const,
      } : {
        id: newNoteId(),
        x: wx - NEW_NOTE_W / 2,
        y: wy - NEW_NOTE_H / 2,
        w: NEW_NOTE_W,
        h: NEW_NOTE_H,
        color: DEFAULT_NOTE_COLOR,
        text: rich ? sanitizeNoteHtml(html) : plain,
        ...(rich ? { format: 'html' as const } : {}),
      };
      setNotes(prev => [...prev, note]);
      setSelectedIds([note.id]);
      scheduleSave();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [scheduleSave, screenToWorld]);

  // ---- Global move/up handlers for the active interaction ----
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const it = interactionRef.current;
      if (!it) return;
      if (it.kind === 'pan') {
        movedRef.current = true;
        setView(prev => ({ ...prev, tx: it.startTx + (e.clientX - it.startX), ty: it.startTy + (e.clientY - it.startY) }));
        return;
      }
      if (it.kind === 'marquee') {
        movedRef.current = true;
        const el = canvasRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setMarquee({
          x: Math.min(it.startX, e.clientX) - rect.left,
          y: Math.min(it.startY, e.clientY) - rect.top,
          w: Math.abs(e.clientX - it.startX),
          h: Math.abs(e.clientY - it.startY),
        });
        // Select every note whose world rect intersects the marquee.
        const a = screenToWorld(it.startX, it.startY);
        const b = screenToWorld(e.clientX, e.clientY);
        const minX = Math.min(a.wx, b.wx), maxX = Math.max(a.wx, b.wx);
        const minY = Math.min(a.wy, b.wy), maxY = Math.max(a.wy, b.wy);
        setSelectedIds(notesRef.current
          .filter(n => n.x < maxX && n.x + n.w > minX && n.y < maxY && n.y + noteRenderHeight(n) > minY)
          .map(n => n.id));
        return;
      }
      // Below a small threshold it's still a click, not a drag — don't move the
      // note or lose the selection over a few jittery pixels.
      if (!movedRef.current && Math.hypot(e.clientX - it.startX, e.clientY - it.startY) < 4) return;
      movedRef.current = true;
      const scale = viewRef.current.scale;
      const dx = (e.clientX - it.startX) / scale;
      const dy = (e.clientY - it.startY) / scale;
      if (it.kind === 'drag') {
        setSelectedIds([]); // moving a single note hides its action bar (resizing keeps it)
        setNotes(prev => prev.map(n => (n.id === it.id ? { ...n, x: it.origX + dx, y: it.origY + dy } : n)));
      } else if (it.kind === 'groupdrag' || it.kind === 'framedrag') {
        setNotes(prev => prev.map(n => (it.origins[n.id]
          ? { ...n, x: it.origins[n.id].x + dx, y: it.origins[n.id].y + dy }
          : n)));
      } else if (it.kind === 'resize') {
        setNotes(prev => prev.map(n => (n.id === it.id
          ? { ...n, w: Math.max(NOTE_MIN_W, it.origW + dx), h: Math.max(NOTE_MIN_H, it.origH + dy) }
          : n)));
      } else if (it.kind === 'frameresize') {
        // Only the box changes — the notes keep their positions and sizes, so
        // they stay put relative to the frame's (content-derived) top-left. The
        // box can't shrink below the notes it holds.
        const w = Math.max(it.contentW, it.origRect.w + dx);
        const h = Math.max(it.contentH, it.origRect.h + dy);
        setFrames(prev => prev.map(f => (f.id === it.frameId ? { ...f, w, h } : f)));
      }
    };
    const onUp = () => {
      const it = interactionRef.current;
      interactionRef.current = null;
      if (!it) return;
      if (it.kind === 'marquee') {
        setMarquee(null);
      } else if (it.kind === 'drag' && !movedRef.current) {
        // Detect the double-click ourselves rather than relying on the DOM's
        // dblclick, which the browser withholds whenever the two clicks land on
        // different elements — easy to hit here, since the first click brings up
        // the action bar and the selection ring under a barely-moving pointer.
        const now = Date.now();
        const last = lastNoteClickRef.current;
        if (last && last.id === it.id && now - last.t < DOUBLE_CLICK_MS) {
          lastNoteClickRef.current = null;
          const n = notesRef.current.find(x => x.id === it.id);
          if (n) beginEditRef.current(n);
        } else {
          lastNoteClickRef.current = { id: it.id, t: now };
          setSelectedIds([it.id]); // a plain click selects the note → shows the action bar
        }
      } else if ((it.kind === 'drag' || it.kind === 'groupdrag' || it.kind === 'framedrag' || it.kind === 'resize' || it.kind === 'frameresize') && movedRef.current) {
        // A gesture that moved something isn't half of a double-click.
        lastNoteClickRef.current = null;
        scheduleSave();
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [scheduleSave, setView, screenToWorld]);

  const startPan = (e: React.MouseEvent) => {
    const { tx, ty } = viewRef.current;
    interactionRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, startTx: tx, startTy: ty };
    movedRef.current = false;
  };

  // Marquee-select from empty canvas. Clears the current selection up front; a
  // plain click (no drag) therefore just deselects, a drag rubber-band selects.
  const startMarquee = (e: React.MouseEvent) => {
    setSelectedIds([]);
    interactionRef.current = { kind: 'marquee', startX: e.clientX, startY: e.clientY };
    movedRef.current = false;
  };

  // Capture phase: runs before a note's own handlers. Space+drag always pans
  // (even over a note); a plain drag on empty canvas rubber-band-selects.
  const onCanvasMouseDownCapture = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    const overInteractive = t.closest('[data-note]') || t.closest('[data-frame]');
    if (spaceRef.current) {
      e.preventDefault();
      e.stopPropagation();
      startPan(e);
    } else if (!overInteractive) {
      startMarquee(e);
    }
  };

  // ---- Notes: add / drag / resize / edit / recolor / delete ----
  const addNoteAtWorld = (color: string, wx: number, wy: number) => {
    if (!canEditRef.current) return;
    const note: MindmapNote = {
      id: newNoteId(),
      x: wx - NEW_NOTE_W / 2,
      y: wy - NEW_NOTE_H / 2,
      w: NEW_NOTE_W,
      h: NEW_NOTE_H,
      color,
      text: '',
    };
    setNotes(prev => [...prev, note]);
    scheduleSave();
  };

  // A new table note: sized to hold its empty grid, and opened for editing so
  // the first cell is ready to type (or paste) into.
  const addTableAtWorld = (wx: number, wy: number, table?: NoteTable) => {
    if (!canEditRef.current) return;
    const t = table || emptyTable();
    const w = Math.min(tableNoteWidth(t) + 16, 1200);
    const h = Math.min(tableNoteHeight(t) + 34, 900);
    const note: MindmapNote = {
      id: newNoteId(),
      x: wx - w / 2,
      y: wy - h / 2,
      w: Math.max(NOTE_MIN_W, w),
      h: Math.max(NOTE_MIN_H, h),
      color: DEFAULT_NOTE_COLOR,
      text: serializeNoteTable(t),
      format: 'table',
    };
    setNotes(prev => [...prev, note]);
    setSelectedIds([note.id]);
    scheduleSave();
    return note;
  };

  // A new kanban note: three columns, sized to hold them.
  const addKanbanAtWorld = (wx: number, wy: number) => {
    if (!canEditRef.current) return;
    const board = emptyBoard();
    const w = kanbanNoteWidth(board);
    const note: MindmapNote = {
      id: newNoteId(),
      x: wx - w / 2,
      y: wy - KANBAN_MIN_H / 2,
      w: Math.max(NOTE_MIN_W, w),
      h: Math.max(NOTE_MIN_H, KANBAN_MIN_H),
      color: DEFAULT_NOTE_COLOR,
      text: serializeNoteKanban(board),
      format: 'kanban',
    };
    setNotes(prev => [...prev, note]);
    setSelectedIds([note.id]);
    scheduleSave();
  };

  const addKanbanAtCenter = () => {
    const el = canvasRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const { wx, wy } = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    addKanbanAtWorld(wx, wy);
  };

  // A kanban note has no edit mode — its cards are live — so every board change
  // writes straight into the note and rides the ordinary save debounce.
  const updateKanban = (noteId: string, board: KanbanBoard) => {
    if (!canEditRef.current) return;
    setNotes(prev => prev.map(n => (n.id === noteId ? { ...n, text: serializeNoteKanban(board) } : n)));
    scheduleSave();
  };

  const addTableAtCenter = () => {
    const el = canvasRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const { wx, wy } = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    const note = addTableAtWorld(wx, wy);
    if (note) requestAnimationFrame(() => beginEditRef.current(note));
  };

  // Press anywhere on a note to (maybe) drag it. A press without movement is a
  // click that selects the note; movement past the threshold moves it. The
  // action bar, resize grip and edit textarea all stopPropagation, so they're
  // exempt from starting a drag.
  const startDrag = (e: React.MouseEvent, n: MindmapNote) => {
    if (!canEditRef.current || spaceRef.current || editingId === n.id) return;
    e.stopPropagation();
    // If this note is part of a multi-selection, drag the whole group together;
    // otherwise drag just this note.
    if (selectedRef.current.length > 1 && selectedRef.current.includes(n.id)) {
      const origins: Record<string, { x: number; y: number }> = {};
      for (const sid of selectedRef.current) {
        const sn = notesRef.current.find(x => x.id === sid);
        if (sn) origins[sid] = { x: sn.x, y: sn.y };
      }
      interactionRef.current = { kind: 'groupdrag', startX: e.clientX, startY: e.clientY, origins };
    } else {
      interactionRef.current = { kind: 'drag', id: n.id, startX: e.clientX, startY: e.clientY, origX: n.x, origY: n.y };
    }
    movedRef.current = false;
  };

  const startResize = (e: React.MouseEvent, n: MindmapNote) => {
    if (!canEditRef.current || spaceRef.current) return;
    e.stopPropagation();
    interactionRef.current = { kind: 'resize', id: n.id, startX: e.clientX, startY: e.clientY, origW: n.w, origH: n.h };
    movedRef.current = false;
  };

  // Notes paint in array order, so the last one is on top. Moving a note to the
  // end brings it to the front — and the order is saved, so it stays there.
  const moveToFront = (notes: MindmapNote[], id: string): MindmapNote[] => {
    const i = notes.findIndex(x => x.id === id);
    if (i === -1 || i === notes.length - 1) return notes;
    const next = notes.slice();
    next.push(next.splice(i, 1)[0]);
    return next;
  };

  // Collapse a note to its first line, or open it back up. The note keeps its
  // height while collapsed, so expanding gives back exactly the card it was.
  // Expanding also brings it to the front: the room it just took back may be
  // occupied by notes that would otherwise cover what it has to show.
  const toggleCollapse = (n: MindmapNote) => {
    if (!canEditRef.current) return;
    if (editingIdRef.current === n.id) commitEdit();
    const expanding = !!n.collapsed;
    setNotes(prev => {
      const next = prev.map(x => (x.id === n.id ? { ...x, collapsed: !x.collapsed } : x));
      return expanding ? moveToFront(next, n.id) : next;
    });
    scheduleSave();
  };

  // Idempotent: the DOM's dblclick may arrive right after our own detection
  // fired, and re-entering must not reset text the user has started typing.
  const beginEdit = (n: MindmapNote) => {
    if (!canEditRef.current || editingIdRef.current === n.id) return;
    // Collapsed: the first thing a double-click should do is show the note.
    if (n.collapsed) { toggleCollapse(n); return; }
    if (n.format === 'kanban') return; // its cards are edited directly
    lastNoteClickRef.current = null;
    setSelectedIds([]);
    setEditingId(n.id);
    const format = n.format === 'html' ? 'html' : n.format === 'table' ? 'table' : 'markdown';
    editingFormatRef.current = format;
    setEditingFormat(format);
    setEditingText(format === 'markdown' ? n.text : '');
    richSeedRef.current = format === 'html' ? renderNoteHtml(n.text) : '';
    setEditingTable(format === 'table' ? parseNoteTable(n.text) : null);
  };
  beginEditRef.current = beginEdit;

  const commitEdit = () => {
    if (editingId === null) return;
    const targetId = editingId;
    // The rich editor's content is whatever is in the DOM — sanitized again on
    // the way in, since the browser's own editing commands put it there.
    const format = editingFormatRef.current;
    const text = format === 'html' ? sanitizeNoteHtml(richRef.current?.innerHTML || '')
      : format === 'table' ? serializeNoteTable(editingTableRef.current || emptyTable())
      : editingText;
    setNotes(prev => prev.map(n => (n.id === targetId
      ? { ...n, text, format: format === 'markdown' ? undefined : format }
      : n)));
    setEditingId(null);
    setEditingTable(null);
    scheduleSave();
  };

  // Seed the rich editor when it opens (and when a paste promotes a markdown
  // note into one). React never re-renders its children afterwards, so typing
  // and the caret are left alone.
  useEffect(() => {
    if (editingId === null || editingFormat !== 'html') return;
    const el = richRef.current;
    if (!el) return;
    el.innerHTML = richSeedRef.current;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false); // caret at the end, past what was just pasted
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editingId, editingFormat]);

  // ---- Pasting formatted content ----
  // Pasting into the plain editor: anything carrying real formatting turns the
  // note into a rich-text one, keeping what was already typed (run through the
  // markdown renderer so it doesn't lose its own formatting on the way).
  const handlePlainPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html');
    // Spreadsheet cells pasted into an empty note make it a table note — the
    // one shape rich text handles badly. With text already typed, the paste
    // takes the ordinary rich-text path so nothing already written is lost.
    if (!editingText.trim()) {
      const grid = tableFromClipboard(html, e.clipboardData.getData('text/plain'));
      if (grid && (grid.rows.length > 1 || grid.cols.length > 1)) {
        e.preventDefault();
        setEditingTable(grid);
        editingTableRef.current = grid;
        editingFormatRef.current = 'table';
        setEditingFormat('table');
        fitNoteToTable(editingIdRef.current, grid);
        return;
      }
    }
    if (!html || !isRichHtml(html)) return; // plain text: let the textarea handle it
    e.preventDefault();
    const el = e.currentTarget;
    const before = editingText.slice(0, el.selectionStart);
    const after = editingText.slice(el.selectionEnd);
    richSeedRef.current = renderNoteMarkdown(before) + sanitizeNoteHtml(html) + renderNoteMarkdown(after);
    editingFormatRef.current = 'html';
    setEditingFormat('html');
  };

  // Pasting into the rich editor: insert the sanitized markup ourselves rather
  // than letting the browser drop the source document's markup in whole.
  const handleRichPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    if (html && isRichHtml(html)) {
      document.execCommand('insertHTML', false, sanitizeNoteHtml(html));
    } else {
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    }
  };

  // Turn the note being edited into a table, reading its current content as a
  // grid: a markdown pipe table, tab-separated rows, a CSV block, or the table
  // in a rich-text note. Content that isn't tabular seeds an empty grid with
  // the text in its first cell, so nothing is lost.
  const convertEditingToTable = () => {
    const source = editingFormat === 'html'
      ? htmlToPlainText(richRef.current?.innerHTML || '')
      : editingText;
    const htmlSource = editingFormat === 'html' ? (richRef.current?.innerHTML || '') : '';
    const parsed = tableFromClipboard(htmlSource, source);
    const table = parsed || (() => {
      const t = emptyTable();
      t.rows[0][0] = source.trim().slice(0, 200);
      return t;
    })();
    setEditingTable(table);
    editingTableRef.current = table;
    richSeedRef.current = '';
    editingFormatRef.current = 'table';
    setEditingFormat('table');
    // Give the grid room: a table that spills out of the note is unreadable.
    fitNoteToTable(editingId, table);
  };

  // Grow a note to hold a table (never shrink it — a note sized by hand keeps
  // the room it was given).
  const fitNoteToTable = (noteId: string | null, table: NoteTable) => {
    if (!noteId) return;
    const w = tableNoteWidth(table);
    const h = tableNoteHeight(table) + 34; // + the editor's control row
    setNotes(prev => prev.map(n => (n.id === noteId
      ? { ...n, w: Math.max(n.w, Math.min(w + 16, 1200)), h: Math.max(n.h, Math.min(h, 900)) }
      : n)));
  };

  // Manual switch between the editors, for when the auto-detection guessed
  // wrong or a rich note is better off as plain markdown again. A table falls
  // back to a markdown pipe table, which reads as a table either way.
  const toggleEditingFormat = () => {
    if (editingFormat === 'table') {
      setEditingText(tableToMarkdown(editingTableRef.current || emptyTable()));
      setEditingTable(null);
      editingTableRef.current = null;
      editingFormatRef.current = 'markdown';
      setEditingFormat('markdown');
    } else if (editingFormat === 'html') {
      setEditingText(htmlToPlainText(richRef.current?.innerHTML || ''));
      richSeedRef.current = '';
      editingFormatRef.current = 'markdown';
      setEditingFormat('markdown');
    } else {
      richSeedRef.current = renderNoteMarkdown(editingText);
      editingFormatRef.current = 'html';
      setEditingFormat('html');
    }
  };

  // ---- Linking selected text to a mindmap ----
  // Capture the textarea's current selection and open the picker. No selection
  // means nothing to label, so the action is a no-op.
  const startLinkSelection = () => {
    if (editingFormat === 'html') {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!richRef.current?.contains(range.commonAncestorContainer)) return;
      richRangeRef.current = range.cloneRange();
      setLinkSelection({ start: 0, end: 0, text: sel.toString() });
      return;
    }
    const el = editorRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) return;
    setLinkSelection({ start, end, text: editingText.slice(start, end) });
  };

  // Close the picker and hand focus back to the textarea, restoring the range so
  // editing carries on where it left off.
  const closeLinkSelection = (caret?: number) => {
    setLinkSelection(null);
    requestAnimationFrame(() => {
      if (editingFormat === 'html') { richRef.current?.focus(); return; }
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      if (caret !== undefined) el.setSelectionRange(caret, caret);
    });
  };

  // Replace the captured range with a markdown link the renderer turns into an
  // in-app mindmap link.
  const applyLinkSelection = (mindmapId: string) => {
    const sel = linkSelection;
    if (!sel) return;
    if (editingFormat === 'html') {
      // Rich text has no source to splice: swap the captured range for an
      // anchor carrying the same marker the markdown renderer emits.
      const range = richRangeRef.current;
      if (range) {
        const a = document.createElement('a');
        a.setAttribute('data-mindmap-link', mindmapId);
        a.setAttribute('href', `/mindmap/${mindmapId}`);
        a.textContent = sel.text;
        range.deleteContents();
        range.insertNode(a);
        richRangeRef.current = null;
      }
      closeLinkSelection();
      return;
    }
    const markdown = `[${sel.text}](mindmap:${mindmapId})`;
    setEditingText(prev => prev.slice(0, sel.start) + markdown + prev.slice(sel.end));
    closeLinkSelection(sel.start + markdown.length);
  };

  // Create a mindmap named after the selection, then link the text to it. The
  // new map stays empty; we don't navigate away mid-edit.
  const createAndLinkSelection = async (title: string) => {
    try {
      const r = await fetch(`${API_URL}/api/mindmaps`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!r.ok) throw new Error();
      const d = await r.json();
      applyLinkSelection(d.mindmap.id);
    } catch {
      closeLinkSelection();
    }
  };

  const recolor = (n: MindmapNote, color: string) => {
    setNotes(prev => prev.map(x => (x.id === n.id ? { ...x, color } : x)));
    scheduleSave();
  };

  const dismissUndo = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndoDelete(null);
  }, []);

  // Delete one or more notes, keeping a 30-second undo snapshot. A second
  // delete replaces the snapshot — only the most recent one is undoable.
  const deleteNotes = useCallback((ids: string[]) => {
    if (!canEditRef.current || ids.length === 0) return;
    const idSet = new Set(ids);
    const removed = notesRef.current.filter(n => idSet.has(n.id));
    if (removed.length === 0) return;
    const framesBefore = framesRef.current;

    setNotes(prev => prev.filter(x => !idSet.has(x.id)));
    // Drop the notes from any frame; remove frames left empty.
    setFrames(prev => prev
      .map(f => ({ ...f, noteIds: f.noteIds.filter(nid => !idSet.has(nid)) }))
      .filter(f => f.noteIds.length > 0));
    setSelectedIds(prev => prev.filter(sid => !idSet.has(sid)));

    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoDelete({ notes: removed, frames: framesBefore });
    undoTimer.current = setTimeout(() => { undoTimer.current = null; setUndoDelete(null); }, UNDO_WINDOW_MS);
    scheduleSave();
  }, [scheduleSave]);

  const deleteNote = (n: MindmapNote) => deleteNotes([n.id]);

  const undoLastDelete = useCallback(() => {
    const snap = undoDelete;
    if (!snap) return;
    dismissUndo();
    const restoredIds = new Set(snap.notes.map(n => n.id));

    setNotes(prev => {
      const present = new Set(prev.map(n => n.id));
      return [...prev, ...snap.notes.filter(n => !present.has(n.id))];
    });
    // Put the restored notes back into the frames they belonged to, recreating
    // any frame that was dropped when the delete emptied it. Members that were
    // deleted some other way in the meantime stay gone.
    setFrames(prev => {
      const alive = new Set([...notesRef.current.map(n => n.id), ...restoredIds]);
      const out = prev.map(f => ({ ...f }));
      for (const old of snap.frames) {
        const members = old.noteIds.filter(nid => restoredIds.has(nid));
        if (members.length === 0) continue;
        const cur = out.find(f => f.id === old.id);
        if (cur) cur.noteIds = Array.from(new Set([...cur.noteIds, ...members]));
        else out.push({ ...old, noteIds: old.noteIds.filter(nid => alive.has(nid)) });
      }
      return out.filter(f => f.noteIds.length > 0);
    });
    setSelectedIds(snap.notes.map(n => n.id));
    scheduleSave();
  }, [undoDelete, dismissUndo, scheduleSave]);

  // ---- Delete key removes the selected notes (undoable for 30s) ----
  // Skipped while editing a note or typing in a field, where Delete/Backspace
  // must keep editing text. Backspace counts too: it's the key labeled "delete"
  // on Mac keyboards.
  useEffect(() => {
    const isField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (editingId !== null || isField(e.target)) return;
      if (!canEditRef.current || selectedRef.current.length === 0) return;
      e.preventDefault();
      deleteNotes(selectedRef.current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingId, deleteNotes]);

  // Don't leave the undo timer running after navigating away.
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  // ---- Note ↔ mindmap links ----
  const currentCrumb = () => ({ id, title });

  const openLinkedMindmap = (n: MindmapNote) => {
    if (n.linkedMindmapId) navigateToMindmap(n.linkedMindmapId, currentCrumb());
  };

  const setNoteLink = (n: MindmapNote, mindmapId: string) => {
    setNotes(prev => prev.map(x => (x.id === n.id ? { ...x, linkedMindmapId: mindmapId } : x)));
    scheduleSave();
  };

  const unlinkNote = (n: MindmapNote) => {
    setNotes(prev => prev.map(x => {
      if (x.id !== n.id) return x;
      const copy = { ...x };
      delete copy.linkedMindmapId;
      return copy;
    }));
    scheduleSave();
  };

  // ---- Tags & views ----
  // Every distinct tag used on the board, for autocomplete and view building.
  const boardTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) for (const t of n.tags || []) set.add(t);
    return Array.from(set).sort();
  }, [notes]);

  // Notes shown for the active view. A view that matches nothing must never
  // blank the board — fall back to all notes so a stale/misconfigured view can't
  // hide everything (the user can still switch to "All" explicitly).
  const filteredNotes = useMemo(() => {
    if (!activeViewId) return notes;
    const activeView = views.find(v => v.id === activeViewId);
    if (!activeView) return notes;
    const result = filterNotesByView(notes, activeView, frames);
    return result.length > 0 ? result : notes;
  }, [notes, activeViewId, views, frames]);

  const setNoteTags = (n: MindmapNote, tags: string[]) => {
    setNotes(prev => prev.map(x => {
      if (x.id !== n.id) return x;
      const copy = { ...x };
      if (tags.length) copy.tags = tags; else delete copy.tags;
      return copy;
    }));
    scheduleSave();
  };

  // Switch views and remember the choice for this viewer, so reopening the map
  // lands on the same view. null = "All", and that's a choice worth remembering
  // too — it must survive over the map's default view.
  const chooseView = useCallback((viewId: string | null) => {
    setActiveViewId(viewId);
    fetch(`${API_URL}/api/mindmaps/${id}/view`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ viewId }),
    }).catch(() => {});
  }, [id]);

  // Views are persisted with their own immediate PUT (separate from the notes
  // debounce) so an in-flight notes save can't clobber them.
  const saveViews = (next: MindmapView[]) => {
    setViews(next);
    putMeta({ views: next });
    // If the active view was deleted, reset to Everything
    if (activeViewId && !next.find(v => v.id === activeViewId)) {
      const everythingView = next.find(v => v.name === 'Everything');
      if (everythingView) chooseView(everythingView.id);
    }
  };

  // ---- Templates (saved card sizes) ----
  const saveTemplates = (next: MindmapTemplate[]) => {
    setTemplates(next);
    putMeta({ templates: next });
  };
  const createTemplate = (note: MindmapNote, name: string) => {
    const tpl: MindmapTemplate = {
      id: `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || `Template ${templates.length + 1}`,
      w: note.w,
      h: note.h,
    };
    saveTemplates([...templates, tpl]);
  };
  const applyTemplate = (note: MindmapNote, tpl: MindmapTemplate) => {
    setNotes(prev => prev.map(x => (x.id === note.id ? { ...x, w: tpl.w, h: tpl.h } : x)));
    scheduleSave();
    setResizeMenuNoteId(null);
  };

  // ---- Frames ----
  // Filtered note map for rendering
  const filteredNoteById = useMemo(() => new Map(filteredNotes.map(n => [n.id, n])), [filteredNotes]);
  // Each frame's rectangle: top-left from the member notes' padded bounding box,
  // so the box follows the notes as they move. Its size is that same bounding
  // box unless the frame has been resized by hand, in which case the manual
  // size wins — but never shrinks below the content.
  const frameRects = useMemo(() => {
    const out: { frame: MindmapFrame; rect: FrameRect; contentW: number; contentH: number }[] = [];
    for (const f of frames) {
      const members = f.noteIds.map(nid => filteredNoteById.get(nid)).filter((n): n is MindmapNote => !!n);
      if (!members.length) continue;
      const minX = Math.min(...members.map(n => n.x)) - FRAME_PAD;
      const minY = Math.min(...members.map(n => n.y)) - FRAME_PAD;
      const maxX = Math.max(...members.map(n => n.x + n.w)) + FRAME_PAD;
      const maxY = Math.max(...members.map(n => n.y + noteRenderHeight(n))) + FRAME_PAD;
      const contentW = maxX - minX;
      const contentH = maxY - minY;
      const w = Math.max(contentW, f.w ?? 0);
      const h = Math.max(contentH, f.h ?? 0);
      out.push({ frame: f, rect: { x: minX, y: minY, w, h }, contentW, contentH });
    }
    return out;
  }, [frames, filteredNoteById]);

  // The frame whose edge the pointer is near — only that frame shows its resize
  // grip, so grips don't litter the board.
  const frameRectsRef = useRef(frameRects);
  frameRectsRef.current = frameRects;
  const [edgeHoverFrameId, setEdgeHoverFrameId] = useState<string | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const it = interactionRef.current;
      // Keep the grip up for the whole resize drag, however far it strays.
      if (it?.kind === 'frameresize') {
        setEdgeHoverFrameId(prev => (prev === it.frameId ? prev : it.frameId));
        return;
      }
      if (!canEditRef.current || !canvasRef.current || frameRectsRef.current.length === 0) {
        setEdgeHoverFrameId(prev => (prev === null ? prev : null));
        return;
      }
      const { wx, wy } = screenToWorld(e.clientX, e.clientY);
      const pad = FRAME_EDGE_HOVER_PX / viewRef.current.scale;
      let hit: string | null = null;
      for (const { frame, rect } of frameRectsRef.current) {
        // Inside the band that straddles the outline: within `pad` outside it,
        // and not `pad` deep into the middle. Later frames win, matching paint
        // order when frames overlap.
        const nearOuter = wx >= rect.x - pad && wx <= rect.x + rect.w + pad
          && wy >= rect.y - pad && wy <= rect.y + rect.h + pad;
        if (!nearOuter) continue;
        const deepInside = wx > rect.x + pad && wx < rect.x + rect.w - pad
          && wy > rect.y + pad && wy < rect.y + rect.h - pad;
        if (deepInside) continue;
        hit = frame.id;
      }
      setEdgeHoverFrameId(prev => (prev === hit ? prev : hit));
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [screenToWorld]);

  // Top-left of the current multi-selection's bounding box (world coords), used
  // to anchor the "Create a Frame" action above the selection.
  const selectionOrigin = useMemo(() => {
    if (selectedIds.length < 2) return null;
    const members = selectedIds.map(nid => filteredNoteById.get(nid)).filter((n): n is MindmapNote => !!n);
    if (members.length < 2) return null;
    return { x: Math.min(...members.map(n => n.x)), y: Math.min(...members.map(n => n.y)) };
  }, [selectedIds, filteredNoteById]);

  const createFrame = (name: string, noteIds: string[]) => {
    if (!canEditRef.current || noteIds.length === 0) return;
    const frame: MindmapFrame = { id: `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, name: name.trim() || 'Frame', noteIds: [...noteIds] };
    setFrames(prev => [...prev, frame]);
    setSelectedIds([]);
    scheduleSave();
  };
  const renameFrame = (frameId: string, name: string) => {
    setFrames(prev => prev.map(f => (f.id === frameId ? { ...f, name: name.trim() || f.name } : f)));
    scheduleSave();
  };
  const deleteFrame = (frameId: string) => {
    setFrames(prev => prev.filter(f => f.id !== frameId));
    scheduleSave();
  };

  // ---- Frame membership ----
  // A note can belong to more than one frame; the frame's rectangle simply grows
  // to cover whatever it holds. Removing the last member deletes the frame,
  // matching the "frames never render empty" rule elsewhere.
  const addNoteToFrame = (noteId: string, frameId: string) => {
    if (!canEditRef.current) return;
    setFrames(prev => prev.map(f => (
      f.id === frameId && !f.noteIds.includes(noteId) ? { ...f, noteIds: [...f.noteIds, noteId] } : f
    )));
    scheduleSave();
  };
  const removeNoteFromFrame = (noteId: string, frameId: string) => {
    if (!canEditRef.current) return;
    setFrames(prev => prev
      .map(f => (f.id === frameId ? { ...f, noteIds: f.noteIds.filter(nid => nid !== noteId) } : f))
      .filter(f => f.noteIds.length > 0));
    scheduleSave();
  };

  // Resize a frame by a corner grip. This resizes the box alone: the member
  // notes keep their positions and sizes, staying anchored to the frame's
  // top-left corner. The box stops at the members' bounding box.
  const startFrameResize = (
    e: React.MouseEvent, frame: MindmapFrame, rect: FrameRect, contentW: number, contentH: number,
  ) => {
    if (!canEditRef.current || spaceRef.current) return;
    e.stopPropagation();
    setSelectedIds([]);
    interactionRef.current = {
      kind: 'frameresize', frameId: frame.id, startX: e.clientX, startY: e.clientY,
      origRect: rect, contentW, contentH,
    };
    movedRef.current = false;
  };

  // Drag a frame by its boundary/title: moves every member note together,
  // preserving their relative positions.
  const startFrameDrag = (e: React.MouseEvent, frame: MindmapFrame) => {
    if (!canEditRef.current || spaceRef.current) return;
    e.stopPropagation();
    setSelectedIds([]);
    const origins: Record<string, { x: number; y: number }> = {};
    for (const nid of frame.noteIds) {
      const n = notesRef.current.find(x => x.id === nid);
      if (n) origins[nid] = { x: n.x, y: n.y };
    }
    interactionRef.current = { kind: 'framedrag', frameId: frame.id, startX: e.clientX, startY: e.clientY, origins };
    movedRef.current = false;
  };

  // Create a fresh mindmap titled from the note's heading, link the note to it,
  // then navigate there (with this mindmap on the back stack).
  const createMindmapFromNote = async (n: MindmapNote) => {
    try {
      const r = await fetch(`${API_URL}/api/mindmaps`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: n.format === 'html' ? richTextTitle(n.text) || 'Untitled mindmap'
            : n.format === 'table' ? tableTitle(n.text) || 'Untitled mindmap'
            : n.format === 'kanban' ? kanbanTitle(n.text) || 'Untitled mindmap'
            : titleFromNote(n.text),
        }),
      });
      if (!r.ok) throw new Error();
      const d = await r.json();
      const newId: string = d.mindmap.id;
      // Persist the link before navigating away (send the current notes with the
      // link applied so the debounce race can't drop it).
      const nextNotes = notesRef.current.map(x => (x.id === n.id ? { ...x, linkedMindmapId: newId } : x));
      setNotes(nextNotes);
      await fetch(`${API_URL}/api/mindmaps/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: nextNotes }),
      }).catch(() => {});
      navigateToMindmap(newId, currentCrumb());
    } catch {
      /* ignore — creating from note failed */
    }
  };

  // ---- Palette drag & drop ----
  const onPaletteDragStart = (e: React.DragEvent, color: string) => {
    if (!canEdit) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/mindmap-color', color);
    e.dataTransfer.effectAllowed = 'copy';
  };
  const onCanvasDragOver = (e: React.DragEvent) => {
    if (!canEdit) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onCanvasDrop = (e: React.DragEvent) => {
    if (!canEdit) return;
    // Only a colour dragged off the palette makes a note here. A kanban card
    // dropped short of a column carries no colour, and must not leave one.
    const color = e.dataTransfer.getData('text/mindmap-color');
    if (!color) return;
    e.preventDefault();
    const { wx, wy } = screenToWorld(e.clientX, e.clientY);
    addNoteAtWorld(color, wx, wy);
  };
  const dropAtCenter = (color: string) => {
    const el = canvasRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const { wx, wy } = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    addNoteAtWorld(color, wx, wy);
  };

  // ---- Metadata actions ----
  const commitTitle = () => {
    const t = title.trim() || 'Untitled mindmap';
    if (t !== title) setTitle(t);
    putMeta({ title: t });
  };
  const toggleStar = () => {
    const next = !starred;
    setStarred(next);
    fetch(`${API_URL}/api/mindmaps/${id}/star`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ star: next }),
    }).catch(() => setStarred(!next));
  };

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>;
  }
  if (status === 'notfound') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-gray-500">
        <p>This mindmap doesn’t exist or isn’t shared with you.</p>
        <button onClick={() => navigateTo('/mindmaps')} className="text-blue-600 hover:underline">Back to Mindmaps</button>
      </div>
    );
  }

  const pct = Math.round(view.scale * 100);
  const cursor = isSpaceDown ? (interactionRef.current?.kind === 'pan' ? 'grabbing' : 'grab') : 'default';

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-100 select-none">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-gray-200 bg-white z-20 flex-shrink-0">
        <button onClick={() => navigateTo('/mindmaps')} className="text-gray-500 hover:text-gray-800 p-1" title="Back to Mindmaps">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        {backStack.length > 0 && (
          <button
            onClick={() => navigateBackToMindmap()}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 max-w-[180px]"
            title={`Back to “${backStack[backStack.length - 1].title}”`}
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            <span className="truncate">{backStack[backStack.length - 1].title}</span>
          </button>
        )}
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          readOnly={!canEdit}
          className="text-sm font-medium text-gray-900 bg-transparent px-2 py-1 rounded hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-0 flex-1 max-w-md read-only:hover:bg-transparent"
        />
        <button onClick={toggleStar} className={`p-1 text-lg leading-none ${starred ? 'text-amber-400' : 'text-gray-300 hover:text-amber-300'}`} title={starred ? 'Unstar' : 'Star'}>
          {starred ? '★' : '☆'}
        </button>
        {(() => {
          const isShared = shared || sharedWith.length > 0;
          const label = shared ? 'Shared' : sharedWith.length > 0 ? `Shared · ${sharedWith.length}` : 'Private';
          return (
            <button
              onClick={() => canEdit && setShowShare(true)}
              disabled={!canEdit}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded border ${isShared ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-600 border-gray-200'} ${canEdit ? 'hover:bg-gray-100' : 'opacity-60 cursor-not-allowed'}`}
              title={canEdit ? 'Share settings' : 'Only the creator can change sharing'}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
              {label}
            </button>
          );
        })()}
        {canEdit && (
          <button
            onClick={() => setShowViews(true)}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded border hover:bg-gray-100 ${views.length ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}
            title="Views & group access"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h6a1 1 0 001-1v-6a1 1 0 00-1-1h-6z" /></svg>
            Views{views.length ? ` · ${views.length}` : ''}
          </button>
        )}
        {views.length > 0 && (
          <div className="relative" data-view-switcher>
            <button
              onClick={() => setShowViewSwitcher(!showViewSwitcher)}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50 text-gray-700 border-gray-200"
              title="Switch view"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
              {activeViewId ? views.find(v => v.id === activeViewId)?.name || 'All' : 'All'}
            </button>
            {showViewSwitcher && (
              <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[140px] z-30">
                <button
                  onClick={() => { chooseView(null); setShowViewSwitcher(false); }}
                  className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${
                    !activeViewId ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                  }`}
                >
                  All
                </button>
                {views.map(v => (
                  <button
                    key={v.id}
                    onClick={() => { chooseView(v.id); setShowViewSwitcher(false); }}
                    className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${
                      v.id === activeViewId ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                    }`}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-1 text-gray-600">
          <button onClick={() => zoomButton(1 / 1.12)} className="w-7 h-7 rounded border border-gray-200 hover:bg-gray-50" title="Zoom out">−</button>
          <span className="text-xs w-12 text-center tabular-nums">{pct}%</span>
          <button onClick={() => zoomButton(1.12)} className="w-7 h-7 rounded border border-gray-200 hover:bg-gray-50" title="Zoom in">+</button>
          <button onClick={fitView} className="ml-1 text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50" title="Reset view">Reset view</button>
        </div>
      </div>

      {/* Undo banner for the last delete — self-dismisses after 30 seconds. */}
      {undoDelete && (
        <div className="flex items-center justify-center gap-3 px-3 py-1.5 bg-gray-800 text-white text-xs z-20 flex-shrink-0">
          <span>
            {undoDelete.notes.length === 1 ? 'Note deleted.' : `${undoDelete.notes.length} notes deleted.`}
          </span>
          <button onClick={undoLastDelete} className="underline font-medium hover:text-blue-200">Undo</button>
          <button onClick={dismissUndo} className="text-gray-400 hover:text-white" title="Hide">✕</button>
        </div>
      )}

      {/* Canvas */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={canvasRef}
          className="absolute inset-0"
          style={{
            cursor,
            backgroundColor: '#f3f4f6',
            backgroundImage: 'radial-gradient(#d1d5db 1px, transparent 1px)',
            backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`,
            backgroundPosition: `${view.tx}px ${view.ty}px`,
          }}
          onMouseDownCapture={onCanvasMouseDownCapture}
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
        >
          {/* World */}
          <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transformOrigin: '0 0' }}>
            {/* Frames — rendered behind notes. Fill is click-through; only the
                edge bands and title grab to move the frame. */}
            {frameRects.map(({ frame, rect, contentW, contentH }) => (
              <div key={frame.id}>
                <div
                  data-frame
                  onMouseDown={canEdit ? e => startFrameDrag(e, frame) : undefined}
                  onDoubleClick={canEdit ? () => setRenameFrameId(frame.id) : undefined}
                  style={{ position: 'absolute', left: rect.x, top: rect.y - 22, maxWidth: rect.w, cursor: canEdit ? 'move' : 'default' }}
                  className="group flex items-center gap-1"
                  title={canEdit ? 'Drag to move frame · double-click to rename' : undefined}
                >
                  <span className="truncate text-xs font-medium text-gray-600 bg-gray-100/90 rounded px-1.5 py-0.5 shadow-sm">{frame.name}</span>
                  {canEdit && (
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); deleteFrame(frame.id); }}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 text-xs leading-none px-0.5"
                      title="Delete frame (keeps notes)"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div
                  style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, pointerEvents: 'none' }}
                  className="rounded-lg border-2 border-gray-400/50"
                >
                  {canEdit && (
                    <>
                      <div data-frame onMouseDown={e => startFrameDrag(e, frame)} style={{ position: 'absolute', left: 0, right: 0, top: -7, height: 14, pointerEvents: 'auto', cursor: 'move' }} />
                      <div data-frame onMouseDown={e => startFrameDrag(e, frame)} style={{ position: 'absolute', left: 0, right: 0, bottom: -7, height: 14, pointerEvents: 'auto', cursor: 'move' }} />
                      <div data-frame onMouseDown={e => startFrameDrag(e, frame)} style={{ position: 'absolute', top: 0, bottom: 0, left: -7, width: 14, pointerEvents: 'auto', cursor: 'move' }} />
                      <div data-frame onMouseDown={e => startFrameDrag(e, frame)} style={{ position: 'absolute', top: 0, bottom: 0, right: -7, width: 14, pointerEvents: 'auto', cursor: 'move' }} />
                      {/* Bottom-right grip: scales the frame's notes with it.
                          Shown only while the pointer is near this frame's
                          outline, and counter-scaled against the zoom so it
                          stays the same size on screen at any zoom level. */}
                      {edgeHoverFrameId === frame.id && (
                      <div
                        data-frame
                        onMouseDown={e => startFrameResize(e, frame, rect, contentW, contentH)}
                        style={{
                          position: 'absolute', right: 0, bottom: 0, width: 14, height: 14,
                          transform: `translate(50%, 50%) scale(${1 / view.scale})`,
                          transformOrigin: 'center',
                          pointerEvents: 'auto', cursor: 'nwse-resize',
                        }}
                        className="rounded-sm bg-white border-2 border-gray-500 shadow hover:bg-blue-50 hover:border-blue-500"
                        title="Drag to resize frame"
                      />
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            {filteredNotes.map(n => (
              <div
                key={n.id}
                data-note
                style={{
                  position: 'absolute', left: n.x, top: n.y, width: n.w, height: noteRenderHeight(n),
                  backgroundColor: n.color,
                  cursor: canEdit && editingId !== n.id ? 'move' : 'default',
                  zIndex: selectedIds.includes(n.id) || editingId === n.id ? 30 : undefined,
                }}
                className={`group/note rounded-md shadow-md border flex flex-col ${selectedIds.includes(n.id) ? 'border-blue-400 ring-1 ring-blue-300' : 'border-black/5'}`}
                onMouseDown={canEdit ? e => startDrag(e, n) : undefined}
                onDoubleClick={canEdit ? () => beginEdit(n) : undefined}
              >
                {/* Collapse / expand, top-right. Faint until the note is
                    hovered, and always visible once collapsed — it's the only
                    way back. */}
                {canEdit && editingId !== n.id && (
                  <button
                    onMouseDown={e => e.stopPropagation()}
                    onDoubleClick={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); toggleCollapse(n); }}
                    className={`absolute top-1 right-1 z-20 w-5 h-5 flex items-center justify-center rounded text-gray-600 hover:bg-black/10 transition-opacity ${
                      n.collapsed ? 'opacity-70' : 'opacity-0 group-hover/note:opacity-70'
                    }`}
                    title={n.collapsed ? 'Expand note' : 'Collapse to the first line'}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.25} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={n.collapsed ? 'M8 10l4 4 4-4' : 'M8 14l4-4 4 4'} />
                    </svg>
                  </button>
                )}
                {/* Action bar — shown only for a single selected note. Holds every
                    note action; its mousedown is stopped so using it never drags
                    or deselects the note. */}
                {canEdit && soleSelected === n.id && editingId !== n.id && (
                  <div
                    onMouseDown={e => e.stopPropagation()}
                    onDoubleClick={e => e.stopPropagation()}
                    className="absolute -top-10 left-0 z-40 flex items-center gap-1.5 bg-white rounded-lg shadow-lg border border-gray-200 px-2 py-1"
                    style={{ cursor: 'default' }}
                  >
                    {/* A kanban note has no text editor — its cards are edited
                        on the board itself. */}
                    {n.format !== 'kanban' && (
                      <>
                        <button
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); beginEdit(n); }}
                          className="p-0.5 text-gray-600 hover:text-blue-600"
                          title="Edit text"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <span className="w-px h-4 bg-gray-200" />
                      </>
                    )}
                    <div className="flex items-center gap-1">
                      {PALETTE.map(c => (
                        <button
                          key={c}
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); recolor(n, c); }}
                          className="w-4 h-4 rounded border border-black/10 hover:scale-110 transition-transform"
                          style={{ backgroundColor: c }}
                          title="Recolor"
                        />
                      ))}
                    </div>
                    <span className="w-px h-4 bg-gray-200" />
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); setLinkNoteId(n.id); }}
                      className={`p-0.5 ${n.linkedMindmapId ? 'text-blue-600 hover:text-blue-800' : 'text-gray-500 hover:text-blue-600'}`}
                      title={n.linkedMindmapId ? 'Linked mindmap' : 'Link to a mindmap'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 015.656 0 4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656m-1.414 5.656a4 4 0 01-5.656 0 4 4 0 010-5.656l3-3a4 4 0 015.656 5.656" /></svg>
                    </button>
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); setTagNoteId(n.id); }}
                      className={`p-0.5 ${n.tags?.length ? 'text-indigo-600 hover:text-indigo-800' : 'text-gray-500 hover:text-indigo-600'}`}
                      title="Edit tags"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                    </button>
                    <span className="w-px h-4 bg-gray-200" />
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); setTemplatePromptNoteId(n.id); }}
                      className="p-0.5 text-gray-500 hover:text-indigo-600"
                      title="Save this size as a template"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
                    </button>
                    <div className="relative">
                      <button
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); setResizeMenuNoteId(resizeMenuNoteId === n.id ? null : n.id); }}
                        className="p-0.5 text-gray-500 hover:text-blue-600"
                        title="Resize to a template"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l4 4m8-4h4m0 0v4m0-4l-4 4M4 16v4m0 0h4m-4 0l4-4m8 4h4m0 0v-4m0 4l-4-4" /></svg>
                      </button>
                      {resizeMenuNoteId === n.id && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setResizeMenuNoteId(null); }} />
                          <div className="absolute top-full right-0 mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[150px]">
                            {templates.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-gray-400">No templates yet. Use the bookmark to save this card’s size.</div>
                            ) : templates.map(t => (
                              <button
                                key={t.id}
                                onMouseDown={e => e.stopPropagation()}
                                onClick={e => { e.stopPropagation(); applyTemplate(n, t); }}
                                className="flex items-center justify-between w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                <span className="truncate">{t.name}</span>
                                <span className="text-[10px] text-gray-400 ml-2 tabular-nums">{t.w}×{t.h}</span>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    {/* Frame membership: toggle this note in or out of any frame. */}
                    <div className="relative">
                      <button
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); setFrameMenuNoteId(frameMenuNoteId === n.id ? null : n.id); }}
                        className={`p-0.5 ${frames.some(f => f.noteIds.includes(n.id)) ? 'text-gray-700 hover:text-blue-600' : 'text-gray-500 hover:text-blue-600'}`}
                        title="Add to / remove from a frame"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h16v16H4z" strokeDasharray="4 3" /></svg>
                      </button>
                      {frameMenuNoteId === n.id && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setFrameMenuNoteId(null); }} />
                          <div className="absolute top-full right-0 mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[170px]">
                            {frames.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-gray-400">No frames yet. Select two or more notes to create one.</div>
                            ) : frames.map(f => {
                              const member = f.noteIds.includes(n.id);
                              return (
                                <button
                                  key={f.id}
                                  onMouseDown={e => e.stopPropagation()}
                                  onClick={e => {
                                    e.stopPropagation();
                                    if (member) removeNoteFromFrame(n.id, f.id); else addNoteToFrame(n.id, f.id);
                                    setFrameMenuNoteId(null);
                                  }}
                                  className="flex items-center justify-between gap-2 w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                                  title={member ? 'Remove from this frame' : 'Add to this frame'}
                                >
                                  <span className="truncate">{f.name}</span>
                                  <span className={`text-xs ${member ? 'text-blue-600' : 'text-gray-300'}`}>{member ? '✓' : '+'}</span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); deleteNote(n); }}
                      className="text-gray-500 hover:text-red-600 p-0.5"
                      title="Delete note"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                )}
                {/* Edit-mode toolbar. mousedown is prevented, not just stopped,
                    so pressing the button never pulls focus out of the textarea
                    and the selection survives. */}
                {editingId === n.id && (
                  <div
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
                    onDoubleClick={e => e.stopPropagation()}
                    className="absolute -top-10 left-0 z-40 flex items-center gap-2 bg-white rounded-lg shadow-lg border border-gray-200 px-2 py-1"
                    style={{ cursor: 'default' }}
                  >
                    {editingFormat !== 'table' && (
                      <>
                        <button
                          onClick={startLinkSelection}
                          className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 px-0.5"
                          title="Link the selected text to a mindmap (⌘K)"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 015.656 0 4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656m-1.414 5.656a4 4 0 01-5.656 0 4 4 0 010-5.656l3-3a4 4 0 015.656 5.656" /></svg>
                          Link selection
                        </button>
                        <span className="w-px h-4 bg-gray-200" />
                      </>
                    )}
                    <button
                      onClick={toggleEditingFormat}
                      className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 px-0.5"
                      title={editingFormat === 'table'
                        ? 'Store this note as plain markdown instead (the grid becomes a markdown table)'
                        : editingFormat === 'html'
                        ? 'Store this note as plain markdown instead (formatting is flattened)'
                        : 'Store this note as rich text, keeping pasted formatting'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h7" /></svg>
                      {editingFormat === 'table' ? 'Table' : editingFormat === 'html' ? 'Rich text' : 'Plain text'}
                    </button>
                    {editingFormat !== 'table' && (
                      <button
                        onClick={convertEditingToTable}
                        className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 px-0.5"
                        title="Turn this note's content into a table"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5h16v14H4z M4 10h16 M4 15h16 M10 5v14 M15 5v14" /></svg>
                        As table
                      </button>
                    )}
                  </div>
                )}
                {/* Linked-note badge — sits just outside the top-right corner so
                    it never obscures the note's text. Click to follow the link. */}
                {n.linkedMindmapId && editingId !== n.id && (
                  <button
                    onMouseDown={e => e.stopPropagation()}
                    onDoubleClick={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); openLinkedMindmap(n); }}
                    className="absolute -top-2.5 -right-2.5 z-10 w-5 h-5 rounded-full bg-white border border-gray-200 hover:bg-gray-50 shadow flex items-center justify-center text-blue-600"
                    title="Open linked mindmap"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 015.656 0 4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656m-1.414 5.656a4 4 0 01-5.656 0 4 4 0 010-5.656l3-3a4 4 0 015.656 5.656" /></svg>
                  </button>
                )}
                {/* A kanban note's board fills it, and the board eats mouse
                    events so cards can be dragged — this strip is what's left
                    to grab when the note itself needs moving. */}
                {n.format === 'kanban' && !n.collapsed && (
                  <div
                    className="flex items-center gap-1 px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-black/40 flex-shrink-0"
                    style={{ cursor: canEdit ? 'move' : 'default' }}
                    title={canEdit ? 'Drag here to move the board' : undefined}
                  >
                    <span>⠿</span>
                    <span>Board</span>
                  </div>
                )}
                <div className={`flex-1 min-h-0 text-sm text-gray-800 ${
                  n.collapsed ? 'overflow-hidden' : n.format === 'kanban' ? 'overflow-hidden' : editingId === n.id ? 'overflow-hidden' : 'overflow-auto p-2'
                }`}>
                  {n.collapsed ? (
                    <div className="px-2 py-1.5 pr-7 truncate leading-tight" title={noteFirstLine(n)}>
                      {noteFirstLine(n) || <span className="text-gray-400 italic">Empty note</span>}
                    </div>
                  ) : n.format === 'kanban' ? (
                    canEdit ? (
                      <KanbanBoardView
                        value={parseNoteKanban(n.text)}
                        canEdit={canEdit}
                        onChange={board => updateKanban(n.id, board)}
                      />
                    ) : (
                      <div
                        className="note-md w-full h-full overflow-auto"
                        dangerouslySetInnerHTML={{ __html: renderNoteKanban(n.text) }}
                      />
                    )
                  ) : editingId === n.id && editingFormat === 'table' ? (
                    <TableNoteEditor
                      value={editingTable || emptyTable()}
                      scale={view.scale}
                      onChange={setEditingTable}
                      onCommit={commitEdit}
                    />
                  ) : editingId === n.id && editingFormat === 'html' ? (
                    <div
                      ref={richRef}
                      contentEditable
                      suppressContentEditableWarning
                      // The link picker steals focus; that blur must not end the
                      // edit — nor must the blur of an editor being swapped out.
                      onBlur={() => { if (!linkSelection && editingFormatRef.current === 'html') commitEdit(); }}
                      onMouseDown={e => e.stopPropagation()}
                      onDoubleClick={e => e.stopPropagation()}
                      onPaste={handleRichPaste}
                      onKeyDown={e => {
                        if (e.key === 'Escape') { (e.target as HTMLElement).blur(); }
                        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit(); }
                        else if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); startLinkSelection(); }
                      }}
                      className="note-md note-rich note-rich-editor w-full h-full box-border overflow-auto bg-white/70 p-2 text-sm break-words rounded-b-md"
                    />
                  ) : editingId === n.id ? (
                    <textarea
                      autoFocus
                      ref={editorRef}
                      value={editingText}
                      onChange={e => setEditingText(e.target.value)}
                      onPaste={handlePlainPaste}
                      onBlur={() => { if (!linkSelection && editingFormatRef.current === 'markdown') commitEdit(); }}
                      onMouseDown={e => e.stopPropagation()}
                      onDoubleClick={e => e.stopPropagation()}
                      onKeyDown={e => {
                        if (e.key === 'Escape') { (e.target as HTMLTextAreaElement).blur(); }
                        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit(); }
                        else if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); startLinkSelection(); }
                      }}
                      className="w-full h-full box-border resize-none bg-white/70 p-2 text-sm focus:outline-none rounded-b-md"
                    />
                  ) : (
                    <div
                      className={`note-md break-words${n.format === 'html' ? ' note-rich' : ''}${n.format === 'table' ? ' note-table-wrap' : ''}`}
                      // In-app mindmap links: follow them here rather than
                      // letting the browser do a full page load. External links
                      // keep their default behaviour.
                      onMouseDown={e => { if ((e.target as HTMLElement).closest('a')) e.stopPropagation(); }}
                      onDoubleClick={e => { if ((e.target as HTMLElement).closest('a')) e.stopPropagation(); }}
                      onClick={e => {
                        const a = (e.target as HTMLElement).closest('[data-mindmap-link]') as HTMLElement | null;
                        if (!a) return;
                        e.preventDefault();
                        e.stopPropagation();
                        navigateToMindmap(a.getAttribute('data-mindmap-link') || '', currentCrumb());
                      }}
                      // Rich text is sanitized here, not just where it was
                      // pasted: stored HTML from any other client is untrusted.
                      dangerouslySetInnerHTML={{
                        __html: n.format === 'html' ? renderNoteHtml(n.text)
                          : n.format === 'table' ? renderNoteTable(n.text)
                          : renderNoteMarkdown(n.text),
                      }}
                    />
                  )}
                </div>
                {/* Tag chips */}
                {n.tags && n.tags.length > 0 && editingId !== n.id && !n.collapsed && (
                  <div className="flex flex-wrap gap-1 px-2 pb-1.5 flex-shrink-0">
                    {n.tags.map(t => (
                      <span key={t} className="text-[10px] leading-none bg-black/10 text-gray-700 rounded-full px-1.5 py-0.5">{t}</span>
                    ))}
                  </div>
                )}
                {canEdit && soleSelected === n.id && editingId !== n.id && !n.collapsed && (
                  <div
                    onMouseDown={e => startResize(e, n)}
                    className="absolute bottom-0 right-0 w-3.5 h-3.5"
                    style={{ cursor: 'nwse-resize' }}
                    title="Resize"
                  >
                    <div className="absolute bottom-0.5 right-0.5 w-0 h-0 border-l-[6px] border-l-transparent border-b-[6px] border-b-black/25" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Rubber-band selection rectangle (screen space, above the world). */}
          {marquee && (
            <div
              className="absolute border border-blue-400 bg-blue-400/10 pointer-events-none"
              style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
            />
          )}
        </div>

        {/* Multi-selection action: create a frame around the selected notes.
            Rendered outside the canvas element so it doesn't trip the marquee. */}
        {canEdit && !marquee && selectionOrigin && (
          <div
            className="absolute z-20"
            style={{ left: selectionOrigin.x * view.scale + view.tx, top: selectionOrigin.y * view.scale + view.ty - 40 }}
          >
            <button
              onClick={() => setFramePromptNoteIds([...selectedIds])}
              className="flex items-center gap-1 text-xs bg-white shadow-lg border border-gray-200 rounded-lg px-2.5 py-1 text-gray-700 hover:bg-gray-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V6a2 2 0 012-2h2M4 16v2a2 2 0 002 2h2m8-16h2a2 2 0 012 2v2m-4 12h2a2 2 0 002-2v-2" /></svg>
              Create a Frame
            </button>
          </div>
        )}

        {/* Color palette (top-right) */}
        <div className={`absolute top-3 right-3 z-10 bg-white/90 backdrop-blur rounded-lg shadow border border-gray-200 p-2 ${canEdit ? '' : 'opacity-50 pointer-events-none'}`}>
          <div className="grid grid-cols-5 gap-1">
            {PALETTE.map(c => (
              <button
                key={c}
                draggable={canEdit}
                onDragStart={e => onPaletteDragStart(e, c)}
                onClick={() => dropAtCenter(c)}
                className="w-6 h-6 rounded border border-black/10 hover:scale-110 transition-transform"
                style={{ backgroundColor: c }}
                title="Drag onto canvas or click to add a note"
              />
            ))}
          </div>
          <button
            onClick={addKanbanAtCenter}
            className="mt-2 w-full flex items-center justify-center gap-1 text-[11px] text-gray-600 hover:text-blue-600 border border-gray-200 rounded px-1.5 py-1 hover:bg-blue-50"
            title="Add a kanban board (Todo · In Progress · Done)"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5h4v14H4z M10 5h4v9h-4z M16 5h4v11h-4z" /></svg>
            Board
          </button>
          <button
            onClick={addTableAtCenter}
            className="mt-2 w-full flex items-center justify-center gap-1 text-[11px] text-gray-600 hover:text-blue-600 border border-gray-200 rounded px-1.5 py-1 hover:bg-blue-50"
            title="Add a table note (paste spreadsheet cells straight into it)"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5h16v14H4z M4 10h16 M4 15h16 M10 5v14 M15 5v14" /></svg>
            Table
          </button>
        </div>

        {/* Hint pill */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 text-[11px] text-gray-500 bg-white/80 backdrop-blur px-3 py-1 rounded-full shadow-sm border border-gray-200">
          Scroll to zoom · Space + drag to pan{canEdit ? ' · drag empty canvas to select · double-click to edit' : ' · read-only'}
        </div>
      </div>

      {showShare && canEdit && (
        <ShareMindmapModal
          mindmapId={id}
          initialShared={shared}
          initialSharedWith={sharedWith}
          selfEmail={selfEmail}
          onClose={() => setShowShare(false)}
          onSaved={(s, sw) => { setShared(s); setSharedWith(sw); }}
        />
      )}

      {linkNoteId && (() => {
        const n = notes.find(x => x.id === linkNoteId);
        if (!n) return null;
        return (
          <NoteLinkModal
            hasLink={!!n.linkedMindmapId}
            excludeId={id}
            onClose={() => setLinkNoteId(null)}
            onOpenLinked={() => openLinkedMindmap(n)}
            onUnlink={() => unlinkNote(n)}
            onCreateFromNote={() => createMindmapFromNote(n)}
            onLinkExisting={(mid) => setNoteLink(n, mid)}
          />
        );
      })()}

      {linkSelection && (
        <LinkTextModal
          selection={linkSelection.text}
          excludeId={id}
          onPick={applyLinkSelection}
          onCreate={createAndLinkSelection}
          onClose={() => closeLinkSelection()}
        />
      )}

      {tagNoteId && (() => {
        const n = notes.find(x => x.id === tagNoteId);
        if (!n) return null;
        return (
          <NoteTagsModal
            initialTags={n.tags || []}
            boardTags={boardTags}
            onSave={(tags) => setNoteTags(n, tags)}
            onClose={() => setTagNoteId(null)}
          />
        );
      })()}

      {showViews && canEdit && (
        <ManageViewsModal
          initialViews={views}
          frames={frames}
          boardTags={boardTags}
          onSave={saveViews}
          onClose={() => setShowViews(false)}
        />
      )}

      {framePromptNoteIds && (
        <TextPromptModal
          title="Create a frame"
          label="Frame name"
          initial="Frame"
          submitLabel="Create"
          onSubmit={name => createFrame(name, framePromptNoteIds)}
          onClose={() => setFramePromptNoteIds(null)}
        />
      )}

      {renameFrameId && (() => {
        const f = frames.find(x => x.id === renameFrameId);
        if (!f) return null;
        return (
          <TextPromptModal
            title="Rename frame"
            label="Frame name"
            initial={f.name}
            submitLabel="Save"
            onSubmit={name => renameFrame(f.id, name)}
            onClose={() => setRenameFrameId(null)}
          />
        );
      })()}

      {templatePromptNoteId && (() => {
        const n = notes.find(x => x.id === templatePromptNoteId);
        if (!n) return null;
        return (
          <TextPromptModal
            title={`Save card size (${n.w} × ${n.h}) as a template`}
            label="Template name"
            initial={`Template ${templates.length + 1}`}
            submitLabel="Save"
            onSubmit={name => { createTemplate(n, name); setTemplatePromptNoteId(null); }}
            onClose={() => setTemplatePromptNoteId(null)}
          />
        );
      })()}
    </div>
  );
}
