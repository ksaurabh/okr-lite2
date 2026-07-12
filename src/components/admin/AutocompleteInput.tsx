import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
  maxSuggestions?: number;
}

// Text input with a filtered dropdown of matching options. Typing filters the
// options (prefix matches first, then anywhere-matches); click or Enter selects.
export function AutocompleteInput({ value, onChange, options, placeholder, className, maxSuggestions = 8 }: Props) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    const starts: string[] = [], contains: string[] = [];
    for (const o of options) {
      const lo = o.toLowerCase();
      if (lo === q) continue;
      if (lo.startsWith(q)) starts.push(o);
      else if (lo.includes(q)) contains.push(o);
    }
    return [...starts, ...contains].slice(0, maxSuggestions);
  }, [value, options, maxSuggestions]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const select = (v: string) => { onChange(v); setOpen(false); setHi(-1); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || matches.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); select(matches[hi]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHi(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={className || 'w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500'}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full min-w-[180px] bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-auto text-sm">
          {matches.map((m, i) => (
            <li
              key={m}
              onMouseDown={(e) => { e.preventDefault(); select(m); }}
              onMouseEnter={() => setHi(i)}
              className={`px-3 py-1.5 cursor-pointer truncate ${i === hi ? 'bg-blue-50 text-blue-800' : 'hover:bg-gray-50 text-gray-800'}`}
              title={m}
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
