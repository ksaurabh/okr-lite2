import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Mindmap, MindmapNote, MindmapView, MindmapFrame } from './types';
import {
  PALETTE, DEFAULT_NOTE_COLOR, NOTE_MIN_W, NOTE_MIN_H,
  NEW_NOTE_W, NEW_NOTE_H, ZOOM_MIN, ZOOM_MAX,
} from './types';
import { renderNoteMarkdown } from './markdown';
import { navigateTo, navigateToMindmap, navigateBackToMindmap, getMindmapBackStack } from './nav';
import { ShareMindmapModal } from './ShareMindmapModal';
import { NoteLinkModal } from './NoteLinkModal';
import { NoteTagsModal } from './NoteTagsModal';
import { ManageViewsModal } from './ManageViewsModal';
import { TextPromptModal } from './TextPromptModal';
import { useAuth } from '../../context/AuthContext';

const FRAME_PAD = 20; // world px of padding between a frame's edge and its notes

const API_URL = import.meta.env.VITE_API_URL || '';

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function newNoteId() { return `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`; }

// A new mindmap made from a note takes the note's first "# heading" line as its
// title; failing that, the first non-empty line; failing that, a default.
function titleFromNote(text: string): string {
  const lines = (text || '').split(/\r?\n/);
  const heading = lines.find(l => /^#{1,6}\s+\S/.test(l));
  if (heading) return heading.replace(/^#{1,6}\s+/, '').trim().slice(0, 200);
  const firstNonEmpty = lines.map(l => l.trim()).find(Boolean);
  return (firstNonEmpty || 'Untitled mindmap').slice(0, 200);
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
  | null;

interface FrameRect { x: number; y: number; w: number; h: number; }

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
  const [frames, setFrames] = useState<MindmapFrame[]>([]);
  const [showShare, setShowShare] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [linkNoteId, setLinkNoteId] = useState<string | null>(null);
  const [tagNoteId, setTagNoteId] = useState<string | null>(null);
  // Pending frame creation from the current selection, and frame rename.
  const [framePromptNoteIds, setFramePromptNoteIds] = useState<string[] | null>(null);
  const [renameFrameId, setRenameFrameId] = useState<string | null>(null);

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
  const [editingText, setEditingText] = useState('');
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
      .then((d: { mindmap: Mindmap; canEdit: boolean; starred: boolean }) => {
        if (cancelled) return;
        setTitle(d.mindmap.title);
        setShared(!!d.mindmap.shared);
        setSharedWith(Array.isArray(d.mindmap.sharedWith) ? d.mindmap.sharedWith : []);
        setViews(Array.isArray(d.mindmap.views) ? d.mindmap.views : []);
        setFrames(Array.isArray(d.mindmap.frames) ? d.mindmap.frames : []);
        setCanEdit(!!d.canEdit);
        setStarred(!!d.starred);
        setNotes(Array.isArray(d.mindmap.notes) ? d.mindmap.notes : []);
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
    const maxY = Math.max(...ns.map(n => n.y + n.h));
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
  const putMeta = useCallback((patch: { title?: string; shared?: boolean; views?: MindmapView[] }) => {
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
          .map(({ x, y, w, h, color, text }) => ({ x, y, w, h, color, text }));
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
          .filter(n => n.x < maxX && n.x + n.w > minX && n.y < maxY && n.y + n.h > minY)
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
      }
    };
    const onUp = () => {
      const it = interactionRef.current;
      interactionRef.current = null;
      if (!it) return;
      if (it.kind === 'marquee') {
        setMarquee(null);
      } else if (it.kind === 'drag' && !movedRef.current) {
        setSelectedIds([it.id]); // a plain click selects the note → shows the action bar
      } else if ((it.kind === 'drag' || it.kind === 'groupdrag' || it.kind === 'framedrag' || it.kind === 'resize') && movedRef.current) {
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

  const beginEdit = (n: MindmapNote) => {
    if (!canEditRef.current) return;
    setSelectedIds([]);
    setEditingId(n.id);
    setEditingText(n.text);
  };

  const commitEdit = () => {
    if (editingId === null) return;
    const targetId = editingId;
    setNotes(prev => prev.map(n => (n.id === targetId ? { ...n, text: editingText } : n)));
    setEditingId(null);
    scheduleSave();
  };

  const recolor = (n: MindmapNote, color: string) => {
    setNotes(prev => prev.map(x => (x.id === n.id ? { ...x, color } : x)));
    scheduleSave();
  };

  const deleteNote = (n: MindmapNote) => {
    setNotes(prev => prev.filter(x => x.id !== n.id));
    // Drop the note from any frame; remove frames left empty.
    setFrames(prev => prev
      .map(f => ({ ...f, noteIds: f.noteIds.filter(id => id !== n.id) }))
      .filter(f => f.noteIds.length > 0));
    scheduleSave();
  };

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

  const setNoteTags = (n: MindmapNote, tags: string[]) => {
    setNotes(prev => prev.map(x => {
      if (x.id !== n.id) return x;
      const copy = { ...x };
      if (tags.length) copy.tags = tags; else delete copy.tags;
      return copy;
    }));
    scheduleSave();
  };

  // Views are persisted with their own immediate PUT (separate from the notes
  // debounce) so an in-flight notes save can't clobber them.
  const saveViews = (next: MindmapView[]) => {
    setViews(next);
    putMeta({ views: next });
  };

  // ---- Frames ----
  const noteById = useMemo(() => new Map(notes.map(n => [n.id, n])), [notes]);
  // Each frame's rectangle = bounding box of its member notes, padded. Derived,
  // so it always hugs the notes as they move/resize.
  const frameRects = useMemo(() => {
    const out: { frame: MindmapFrame; rect: FrameRect }[] = [];
    for (const f of frames) {
      const members = f.noteIds.map(nid => noteById.get(nid)).filter((n): n is MindmapNote => !!n);
      if (!members.length) continue;
      const minX = Math.min(...members.map(n => n.x)) - FRAME_PAD;
      const minY = Math.min(...members.map(n => n.y)) - FRAME_PAD;
      const maxX = Math.max(...members.map(n => n.x + n.w)) + FRAME_PAD;
      const maxY = Math.max(...members.map(n => n.y + n.h)) + FRAME_PAD;
      out.push({ frame: f, rect: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } });
    }
    return out;
  }, [frames, noteById]);

  // Top-left of the current multi-selection's bounding box (world coords), used
  // to anchor the "Create a Frame" action above the selection.
  const selectionOrigin = useMemo(() => {
    if (selectedIds.length < 2) return null;
    const members = selectedIds.map(nid => noteById.get(nid)).filter((n): n is MindmapNote => !!n);
    if (members.length < 2) return null;
    return { x: Math.min(...members.map(n => n.x)), y: Math.min(...members.map(n => n.y)) };
  }, [selectedIds, noteById]);

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
        body: JSON.stringify({ title: titleFromNote(n.text) }),
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
    e.preventDefault();
    const color = e.dataTransfer.getData('text/mindmap-color') || DEFAULT_NOTE_COLOR;
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
        <div className="flex-1" />
        <div className="flex items-center gap-1 text-gray-600">
          <button onClick={() => zoomButton(1 / 1.12)} className="w-7 h-7 rounded border border-gray-200 hover:bg-gray-50" title="Zoom out">−</button>
          <span className="text-xs w-12 text-center tabular-nums">{pct}%</span>
          <button onClick={() => zoomButton(1.12)} className="w-7 h-7 rounded border border-gray-200 hover:bg-gray-50" title="Zoom in">+</button>
          <button onClick={fitView} className="ml-1 text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50" title="Reset view">Reset view</button>
        </div>
      </div>

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
            {frameRects.map(({ frame, rect }) => (
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
                    </>
                  )}
                </div>
              </div>
            ))}
            {notes.map(n => (
              <div
                key={n.id}
                data-note
                style={{
                  position: 'absolute', left: n.x, top: n.y, width: n.w, height: n.h,
                  backgroundColor: n.color,
                  cursor: canEdit && editingId !== n.id ? 'move' : 'default',
                  zIndex: selectedIds.includes(n.id) || editingId === n.id ? 30 : undefined,
                }}
                className={`rounded-md shadow-md border flex flex-col ${selectedIds.includes(n.id) ? 'border-blue-400 ring-1 ring-blue-300' : 'border-black/5'}`}
                onMouseDown={canEdit ? e => startDrag(e, n) : undefined}
                onDoubleClick={canEdit ? () => beginEdit(n) : undefined}
              >
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
                <div className={`flex-1 min-h-0 text-sm text-gray-800 ${editingId === n.id ? 'overflow-hidden' : 'overflow-auto p-2'}`}>
                  {editingId === n.id ? (
                    <textarea
                      autoFocus
                      value={editingText}
                      onChange={e => setEditingText(e.target.value)}
                      onBlur={commitEdit}
                      onMouseDown={e => e.stopPropagation()}
                      onDoubleClick={e => e.stopPropagation()}
                      onKeyDown={e => {
                        if (e.key === 'Escape') { (e.target as HTMLTextAreaElement).blur(); }
                        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit(); }
                      }}
                      className="w-full h-full box-border resize-none bg-white/70 p-2 text-sm focus:outline-none rounded-b-md"
                    />
                  ) : (
                    <div className="note-md break-words" dangerouslySetInnerHTML={{ __html: renderNoteMarkdown(n.text) }} />
                  )}
                </div>
                {/* Tag chips */}
                {n.tags && n.tags.length > 0 && editingId !== n.id && (
                  <div className="flex flex-wrap gap-1 px-2 pb-1.5 flex-shrink-0">
                    {n.tags.map(t => (
                      <span key={t} className="text-[10px] leading-none bg-black/10 text-gray-700 rounded-full px-1.5 py-0.5">{t}</span>
                    ))}
                  </div>
                )}
                {canEdit && soleSelected === n.id && editingId !== n.id && (
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
    </div>
  );
}
