import { useRef, useState } from 'react';
import type { KanbanBoard } from './kanban';
import { addCard, setCardText, deleteCard, moveCard } from './kanban';

interface Props {
  value: KanbanBoard;
  canEdit: boolean;
  onChange: (next: KanbanBoard) => void;
}

interface DropTarget { colId: string; index: number; }

// The board inside a kanban note. Unlike a table note there's no edit mode to
// enter: the cards are live whenever the viewer can edit, so a card is dragged
// straight to another column. Everything inside stops its mousedown from
// reaching the canvas, so working the board never drags the note — the note
// moves by its grip strip above the columns.
export function KanbanBoardView({ value, canEdit, onChange }: Props) {
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  // The card being dragged. Held here rather than read back from the drag event
  // because dataTransfer isn't readable during dragover, which is where the
  // insertion point is worked out.
  const draggingRef = useRef<string | null>(null);
  // Mirrored into state purely so the card being dragged can look lifted.
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const startAddCard = (colId: string) => {
    const { board, cardId } = addCard(value, colId);
    onChange(board);
    setEditingCardId(cardId);
  };

  // Where a drop at this pointer position would land: before the first card
  // whose midpoint the pointer is above, otherwise at the end.
  const dropIndexAt = (body: HTMLElement, clientY: number): number => {
    const cards = Array.from(body.querySelectorAll<HTMLElement>('[data-card]'));
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return cards.length;
  };

  const onBodyDragOver = (e: React.DragEvent<HTMLDivElement>, colId: string) => {
    if (!canEdit || !draggingRef.current) return;
    // Stopped as well as prevented: the canvas below treats a drop as "add a
    // note here", and this drop is not that.
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const index = dropIndexAt(e.currentTarget, e.clientY);
    setDrop(prev => (prev && prev.colId === colId && prev.index === index ? prev : { colId, index }));
  };

  const onBodyDrop = (e: React.DragEvent<HTMLDivElement>, colId: string) => {
    const cardId = draggingRef.current;
    if (!canEdit || !cardId) return;
    e.preventDefault();
    e.stopPropagation();
    const index = dropIndexAt(e.currentTarget, e.clientY);
    draggingRef.current = null;
    setDraggingId(null);
    setDrop(null);
    onChange(moveCard(value, cardId, colId, index));
  };

  return (
    <div
      className="kanban w-full h-full"
      onMouseDown={stop}
      onDoubleClick={stop}
    >
      {value.cols.map(col => (
        <div key={col.id} className="kanban-col">
          <div className="kanban-col-head">
            {col.name}
            <span className="kanban-count">{col.cards.length}</span>
          </div>
          <div
            className="kanban-col-body"
            onDragOver={e => onBodyDragOver(e, col.id)}
            onDrop={e => onBodyDrop(e, col.id)}
            onDragLeave={() => setDrop(prev => (prev?.colId === col.id ? null : prev))}
          >
            {col.cards.map((card, i) => (
              <div key={card.id}>
                {drop && drop.colId === col.id && drop.index === i && <div className="kanban-drop" />}
                <div
                  data-card={card.id}
                  draggable={canEdit && editingCardId !== card.id}
                  onDragStart={e => {
                    draggingRef.current = card.id;
                    setDraggingId(card.id);
                    e.dataTransfer.effectAllowed = 'move';
                    // Some browsers cancel a drag that carries no payload.
                    e.dataTransfer.setData('text/mindmap-card', card.id);
                    e.stopPropagation();
                  }}
                  onDragEnd={() => { draggingRef.current = null; setDraggingId(null); setDrop(null); }}
                  className={`kanban-card group ${canEdit ? 'kanban-card-draggable' : ''} ${
                    draggingId === card.id ? 'opacity-40' : ''
                  }`}
                  onClick={() => { if (canEdit && editingCardId !== card.id) setEditingCardId(card.id); }}
                >
                  {editingCardId === card.id ? (
                    <textarea
                      autoFocus
                      value={card.text}
                      rows={Math.min(6, Math.max(1, card.text.split('\n').length))}
                      onChange={e => onChange(setCardText(value, card.id, e.target.value))}
                      onBlur={() => {
                        setEditingCardId(null);
                        // An untouched new card leaves nothing behind.
                        if (!card.text.trim()) onChange(deleteCard(value, card.id));
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
                          e.preventDefault();
                          (e.target as HTMLTextAreaElement).blur();
                        }
                      }}
                      className="w-full resize-none bg-transparent text-sm leading-snug focus:outline-none"
                    />
                  ) : (
                    <>
                      <span className="kanban-card-text">{card.text || <span className="kanban-empty">Empty card</span>}</span>
                      {canEdit && (
                        <button
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); onChange(deleteCard(value, card.id)); }}
                          className="kanban-card-del opacity-0 group-hover:opacity-100"
                          title="Delete card"
                        >
                          ✕
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            {drop && drop.colId === col.id && drop.index === col.cards.length && <div className="kanban-drop" />}
          </div>
          {/* Outside the scrolling body, so it stays put at the foot of a full
              column while its cards scroll. */}
          {canEdit && (
            <button onClick={() => startAddCard(col.id)} className="kanban-add" title={`Add a card to ${col.name}`}>
              + Add a card
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
