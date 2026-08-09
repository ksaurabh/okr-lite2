import { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

interface Props {
  initialTags: string[];
  boardTags: string[]; // existing tags on the board, for autocomplete
  onSave: (tags: string[]) => void;
  onClose: () => void;
}

function normalize(t: string): string {
  return t.trim().toLowerCase().slice(0, 50);
}

// Edit a single note's free-form tags, with autocomplete from tags already used
// on the board.
export function NoteTagsModal({ initialTags, boardTags, onSave, onClose }: Props) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [input, setInput] = useState('');

  const add = (raw: string) => {
    const t = normalize(raw);
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setInput('');
  };
  const remove = (t: string) => setTags(prev => prev.filter(x => x !== t));

  const suggestions = boardTags.filter(t => !tags.includes(t));

  return (
    <Modal isOpen onClose={onClose} title="Note tags">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5 min-h-[28px]">
          {tags.length === 0 && <span className="text-xs text-gray-400">No tags yet.</span>}
          {tags.map(t => (
            <span key={t} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full pl-2 pr-1 py-0.5">
              {t}
              <button onClick={() => remove(t)} className="text-blue-400 hover:text-blue-700" title="Remove">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </span>
          ))}
        </div>

        <div>
          <input
            list="mindmap-board-tags"
            autoFocus
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input); }
              else if (e.key === 'Backspace' && !input && tags.length) remove(tags[tags.length - 1]);
            }}
            placeholder="Add a tag and press Enter…"
            className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <datalist id="mindmap-board-tags">
            {suggestions.map(t => <option key={t} value={t} />)}
          </datalist>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {suggestions.slice(0, 12).map(t => (
                <button key={t} onClick={() => add(t)} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-full px-2 py-0.5">+ {t}</button>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { onSave(tags); onClose(); }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
