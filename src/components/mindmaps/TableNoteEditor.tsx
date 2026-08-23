import { useRef, useState } from 'react';
import type { NoteTable } from './table';
import {
  TABLE_MIN_COL_W, TABLE_ROW_H,
  setCell, setColWidth, insertRow, insertCol, deleteRow, deleteCol,
  pasteInto, tableFromClipboard,
} from './table';

interface Props {
  value: NoteTable;
  scale: number;                       // canvas zoom, so grips stay grabbable
  onChange: (next: NoteTable) => void;
  onCommit: () => void;                // focus left the grid, or ⌘Enter / Esc
}

// The editable grid inside a table note. Cells are plain-text inputs; the
// handle on a column's edge resizes it; pasting a block of spreadsheet cells fills
// the grid from the focused cell outward instead of landing in one cell.
export function TableNoteEditor({ value, scale, onChange, onCommit }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  // Live column drag. Kept in a ref so the window listeners see it without
  // re-subscribing; the table it started from is captured with it, since cells
  // can't change while a column is being dragged.
  const dragRef = useRef<{ col: number; startX: number; startW: number; table: NoteTable } | null>(null);

  const startColResize = (e: React.MouseEvent, col: number) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { col, startX: e.clientX, startW: value.cols[col], table: value };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = (ev.clientX - d.startX) / scale; // screen px → world px
      onChange(setColWidth(d.table, d.col, Math.max(TABLE_MIN_COL_W, d.startW + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      onCommit();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const focusCell = (r: number, c: number) => {
    const el = rootRef.current?.querySelector<HTMLInputElement>(`input[data-cell="${r}:${c}"]`);
    if (el) { el.focus(); el.select(); }
  };

  const onCellPaste = (e: React.ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const html = e.clipboardData.getData('text/html');
    const plain = e.clipboardData.getData('text/plain');
    const block = tableFromClipboard(html, plain);
    // A single value is an ordinary paste; let the input handle it.
    if (!block || (block.rows.length === 1 && block.cols.length === 1)) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(pasteInto(value, r, c, block));
  };

  const onCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    if (e.key === 'Escape') { e.preventDefault(); onCommit(); return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onCommit(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (r + 1 >= value.rows.length) onChange(insertRow(value, value.rows.length));
      requestAnimationFrame(() => focusCell(r + 1, c));
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const back = e.shiftKey;
      let nr = r;
      let nc = c + (back ? -1 : 1);
      if (nc >= value.cols.length) { nc = 0; nr = r + 1; }
      if (nc < 0) { nc = value.cols.length - 1; nr = r - 1; }
      if (nr < 0) return;
      if (nr >= value.rows.length) onChange(insertRow(value, value.rows.length));
      requestAnimationFrame(() => focusCell(nr, nc));
      return;
    }
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    if (e.key === 'ArrowDown' && r + 1 < value.rows.length) { e.preventDefault(); focusCell(r + 1, c); }
    else if (e.key === 'ArrowUp' && r > 0) { e.preventDefault(); focusCell(r - 1, c); }
    else if (e.key === 'ArrowRight' && atEnd && c + 1 < value.cols.length) { e.preventDefault(); focusCell(r, c + 1); }
    else if (e.key === 'ArrowLeft' && atStart && c > 0) { e.preventDefault(); focusCell(r, c - 1); }
  };

  // Focus moving between cells must not end the edit; only focus leaving the
  // whole grid does. A column drag steals focus too, and isn't a commit either.
  const onBlurCapture = (e: React.FocusEvent<HTMLDivElement>) => {
    if (dragRef.current) return;
    const next = e.relatedTarget as Node | null;
    if (next && rootRef.current?.contains(next)) return;
    onCommit();
  };

  const btn = 'flex items-center justify-center text-[11px] leading-none text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded';

  return (
    <div
      ref={rootRef}
      onBlurCapture={onBlurCapture}
      onMouseDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      className="w-full h-full overflow-auto bg-white/80 p-1 rounded-b-md"
    >
      <table className="note-table note-table-editor" style={{ tableLayout: 'fixed', width: 'auto' }}>
        <colgroup>
          {value.cols.map((w, i) => <col key={i} style={{ width: w }} />)}
        </colgroup>
        <tbody>
          {value.rows.map((row, r) => (
            <tr key={r} style={{ height: TABLE_ROW_H }}>
              {row.map((v, c) => (
                <td key={c} className="relative p-0">
                  <input
                    data-cell={`${r}:${c}`}
                    value={v}
                    onChange={e => onChange(setCell(value, r, c, e.target.value))}
                    onFocus={() => setFocused({ r, c })}
                    onPaste={e => onCellPaste(e, r, c)}
                    onKeyDown={e => onCellKeyDown(e, r, c)}
                    className={`w-full bg-transparent px-1 py-0.5 text-sm focus:outline-none focus:bg-blue-50 ${
                      value.header && r === 0 ? 'font-semibold' : ''
                    }`}
                  />
                  {/* Column resize handle: the right edge of every cell in the
                      first row, widened past the border so it's grabbable and
                      counter-scaled so it stays the same size on screen. */}
                  {r === 0 && (
                    <div
                      onMouseDown={e => startColResize(e, c)}
                      title="Drag to resize column"
                      style={{
                        position: 'absolute', top: 0, bottom: 0, right: 0,
                        width: Math.max(6, 8 / scale), transform: 'translateX(50%)',
                        cursor: 'col-resize', zIndex: 2,
                      }}
                      className="hover:bg-blue-400/40"
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Row/column controls, acting on the cell that has focus. */}
      <div
        className="flex items-center gap-1 mt-1 text-gray-500"
        onMouseDown={e => e.preventDefault() /* keep focus in the grid */}
      >
        <button className={`${btn} px-1.5 h-5`} title="Add a row below" onClick={() => onChange(insertRow(value, focused.r + 1))}>+ Row</button>
        <button className={`${btn} px-1.5 h-5`} title="Add a column to the right" onClick={() => onChange(insertCol(value, focused.c + 1))}>+ Col</button>
        <span className="w-px h-3.5 bg-gray-200" />
        <button className={`${btn} px-1.5 h-5 hover:text-red-600 hover:bg-red-50`} title="Delete the focused row" onClick={() => onChange(deleteRow(value, focused.r))}>− Row</button>
        <button className={`${btn} px-1.5 h-5 hover:text-red-600 hover:bg-red-50`} title="Delete the focused column" onClick={() => onChange(deleteCol(value, focused.c))}>− Col</button>
        <span className="w-px h-3.5 bg-gray-200" />
        <label className="flex items-center gap-1 text-[11px] cursor-pointer select-none" title="Style the first row as a header">
          <input
            type="checkbox"
            checked={value.header}
            onChange={e => onChange({ ...value, header: e.target.checked })}
            className="w-3 h-3"
          />
          Header row
        </label>
      </div>
    </div>
  );
}
