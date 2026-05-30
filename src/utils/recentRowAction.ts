import { useEffect, useState } from 'react';

export type RowAction = 'edit' | 'clone' | 'archive';
export const ALL_ROW_ACTIONS: RowAction[] = ['edit', 'clone', 'archive'];

const STORAGE_KEY = 'okr-pinned-row-actions';
const EVENT_NAME = 'okr-pinned-row-actions-change';

const read = (): RowAction[] => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (!v) return [];
    const arr = JSON.parse(v);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is RowAction => x === 'edit' || x === 'clone' || x === 'archive');
  } catch { /* ignore */ }
  return [];
};

export function usePinnedRowActions(): {
  pinned: RowAction[];
  isPinned: (a: RowAction) => boolean;
  togglePin: (a: RowAction) => void;
} {
  const [value, setValue] = useState<RowAction[]>(() => read());
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<RowAction[]>).detail;
      if (Array.isArray(detail)) setValue(detail);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);
  const broadcast = (next: RowAction[]) => {
    setValue(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent<RowAction[]>(EVENT_NAME, { detail: next }));
  };
  const togglePin = (a: RowAction) => {
    const next = value.includes(a) ? value.filter(x => x !== a) : [...value, a];
    broadcast(next);
  };
  return { pinned: value, isPinned: (a) => value.includes(a), togglePin };
}
