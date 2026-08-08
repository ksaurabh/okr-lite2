import { useCallback, useEffect, useRef, useState } from 'react';
import type { Mindmap, MindmapNote } from './types';
import {
  PALETTE, DEFAULT_NOTE_COLOR, NOTE_MIN_W, NOTE_MIN_H,
  NEW_NOTE_W, NEW_NOTE_H, ZOOM_MIN, ZOOM_MAX,
} from './types';
import { renderNoteMarkdown } from './markdown';
import { navigateTo } from './nav';

const API_URL = import.meta.env.VITE_API_URL || '';

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function newNoteId() { return `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`; }

interface View { tx: number; ty: number; scale: number; }

// Active pointer interaction. Only one runs at a time.
type Interaction =
  | { kind: 'pan'; startX: number; startY: number; startTx: number; startTy: number }
  | { kind: 'drag'; id: string; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'resize'; id: string; startX: number; startY: number; origW: number; origH: number }
  | null;

export function MindmapCanvasPage() {
  const id = window.location.pathname.split('/')[2] || '';

  const [status, setStatus] = useState<'loading' | 'notfound' | 'ready'>('loading');
  const [title, setTitle] = useState('');
  const [shared, setShared] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [starred, setStarred] = useState(false);
  const [notes, setNotes] = useState<MindmapNote[]>([]);

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
  const [menuNoteId, setMenuNoteId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const spaceRef = useRef(false);
  const interactionRef = useRef<Interaction>(null);
  const movedRef = useRef(false);
  const canEditRef = useRef(false);
  canEditRef.current = canEdit;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Load ----
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/mindmaps/${id}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { mindmap: Mindmap; canEdit: boolean; starred: boolean }) => {
        if (cancelled) return;
        setTitle(d.mindmap.title);
        setShared(!!d.mindmap.shared);
        setCanEdit(!!d.canEdit);
        setStarred(!!d.starred);
        setNotes(Array.isArray(d.mindmap.notes) ? d.mindmap.notes : []);
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('notfound'); });
    return () => { cancelled = true; };
  }, [id]);

  // Close the note action menu on any outside interaction (its own controls
  // stopPropagation, so clicks inside the menu don't reach this listener).
  useEffect(() => {
    if (!menuNoteId) return;
    const close = () => setMenuNoteId(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuNoteId]);

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

  // ---- Persistence: debounce ~500ms then PUT the whole notes array ----
  const scheduleSave = useCallback(() => {
    if (!canEditRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`${API_URL}/api/mindmaps/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notesRef.current }),
      }).catch(() => {});
    }, 500);
  }, [id]);

  // Immediate metadata save (title / shared) — creator only.
  const putMeta = useCallback((patch: { title?: string; shared?: boolean }) => {
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

  // ---- Global move/up handlers for the active interaction ----
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const it = interactionRef.current;
      if (!it) return;
      movedRef.current = true;
      if (it.kind === 'pan') {
        setView(prev => ({ ...prev, tx: it.startTx + (e.clientX - it.startX), ty: it.startTy + (e.clientY - it.startY) }));
        return;
      }
      const scale = viewRef.current.scale;
      const dx = (e.clientX - it.startX) / scale;
      const dy = (e.clientY - it.startY) / scale;
      if (it.kind === 'drag') {
        setNotes(prev => prev.map(n => (n.id === it.id ? { ...n, x: it.origX + dx, y: it.origY + dy } : n)));
      } else if (it.kind === 'resize') {
        setNotes(prev => prev.map(n => (n.id === it.id
          ? { ...n, w: Math.max(NOTE_MIN_W, it.origW + dx), h: Math.max(NOTE_MIN_H, it.origH + dy) }
          : n)));
      }
    };
    const onUp = () => {
      const it = interactionRef.current;
      interactionRef.current = null;
      if (it && (it.kind === 'drag' || it.kind === 'resize') && movedRef.current) scheduleSave();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [scheduleSave, setView]);

  const startPan = (e: React.MouseEvent) => {
    const { tx, ty } = viewRef.current;
    interactionRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, startTx: tx, startTy: ty };
    movedRef.current = false;
  };

  // Capture phase: runs before a note's own handlers. Space+drag always pans
  // (even over a note); a plain drag on empty canvas pans too.
  const onCanvasMouseDownCapture = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const overNote = (e.target as HTMLElement).closest('[data-note]');
    if (spaceRef.current) {
      e.preventDefault();
      e.stopPropagation();
      startPan(e);
    } else if (!overNote) {
      startPan(e);
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

  // Drag the note from anywhere on its surface (the "⋯" button, its menu, the
  // resize grip and the edit textarea all stopPropagation so they're exempt).
  const startDrag = (e: React.MouseEvent, n: MindmapNote) => {
    if (!canEditRef.current || spaceRef.current || editingId === n.id) return;
    e.stopPropagation();
    setMenuNoteId(null);
    interactionRef.current = { kind: 'drag', id: n.id, startX: e.clientX, startY: e.clientY, origX: n.x, origY: n.y };
    movedRef.current = false;
  };

  const startResize = (e: React.MouseEvent, n: MindmapNote) => {
    if (!canEditRef.current || spaceRef.current) return;
    e.stopPropagation();
    setMenuNoteId(null);
    interactionRef.current = { kind: 'resize', id: n.id, startX: e.clientX, startY: e.clientY, origW: n.w, origH: n.h };
    movedRef.current = false;
  };

  const beginEdit = (n: MindmapNote) => {
    if (!canEditRef.current) return;
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
    scheduleSave();
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
  const toggleShared = () => {
    if (!canEdit) return;
    const next = !shared;
    setShared(next);
    putMeta({ shared: next });
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
        <button
          onClick={toggleShared}
          disabled={!canEdit}
          className={`text-xs px-2 py-1 rounded border ${shared ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-600 border-gray-200'} ${canEdit ? 'hover:bg-gray-100' : 'opacity-60 cursor-not-allowed'}`}
          title={canEdit ? 'Toggle sharing' : 'Only the creator can change sharing'}
        >
          {shared ? 'Shared' : 'Private'}
        </button>
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
            {notes.map(n => (
              <div
                key={n.id}
                data-note
                style={{
                  position: 'absolute', left: n.x, top: n.y, width: n.w, height: n.h,
                  backgroundColor: n.color,
                  cursor: canEdit && editingId !== n.id ? 'move' : 'default',
                  zIndex: menuNoteId === n.id || editingId === n.id ? 30 : undefined,
                }}
                className="rounded-md shadow-md border border-black/5 flex flex-col"
                onMouseDown={canEdit ? e => startDrag(e, n) : undefined}
                onDoubleClick={canEdit ? () => beginEdit(n) : undefined}
              >
                {/* All note actions live behind this "⋯" button. */}
                {canEdit && (
                  <button
                    onMouseDown={e => e.stopPropagation()}
                    onDoubleClick={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); setMenuNoteId(prev => (prev === n.id ? null : n.id)); }}
                    className="absolute top-1 right-1 z-10 w-6 h-6 rounded-full bg-white/80 hover:bg-white shadow flex items-center justify-center text-gray-600"
                    title="Note actions"
                  >
                    <span className="text-base leading-none -mt-1.5">⋯</span>
                  </button>
                )}
                {canEdit && menuNoteId === n.id && (
                  <div
                    onMouseDown={e => e.stopPropagation()}
                    onDoubleClick={e => e.stopPropagation()}
                    className="absolute top-8 right-1 z-20 bg-white rounded-lg shadow-lg border border-gray-200 p-2"
                  >
                    <div className="grid grid-cols-5 gap-1 mb-1.5">
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
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); deleteNote(n); setMenuNoteId(null); }}
                      className="w-full text-left text-xs text-red-600 hover:bg-red-50 rounded px-2 py-1"
                    >
                      Delete note
                    </button>
                  </div>
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
                {canEdit && (
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
        </div>

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
          Scroll to zoom · hold Space + drag to pan{canEdit ? ' · double-click a note to edit' : ' · read-only'}
        </div>
      </div>
    </div>
  );
}
