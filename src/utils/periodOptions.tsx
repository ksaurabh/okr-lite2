import type { Period } from '../types';

interface RenderOptions {
  optionLabel?: (p: Period) => string;
  // include "evergreen" group for periods that have type === 'evergreen' (synthetic — usually periods with no type or unrecognized type)
}

const KNOWN_TYPES: Array<{ key: 'month' | 'quarter' | 'week'; label: string }> = [
  { key: 'quarter', label: 'Quarterly' },
  { key: 'month', label: 'Monthly' },
  { key: 'week', label: 'Weekly' },
];

const SPECIAL_NAMES = new Set(['evergreen', 'someday']);
const isSpecial = (p: Period) =>
  SPECIAL_NAMES.has((p.name || '').trim().toLowerCase()) ||
  (p.type as string) === 'evergreen' ||
  (p.type as string) === 'someday';
const isGroupable = (p: Period) =>
  !isSpecial(p) && (p.type === 'quarter' || p.type === 'month' || p.type === 'week');

export function renderGroupedPeriodOptions(periods: Period[], opts: RenderOptions = {}) {
  const labelOf = opts.optionLabel || ((p: Period) => p.name);
  const sortByStart = (a: Period, b: Period) => (a.startDate || '').localeCompare(b.startDate || '');
  const ungrouped = periods
    .filter(p => !isGroupable(p))
    .sort(sortByStart);
  return (
    <>
      {ungrouped.map(p => (
        <option key={p.id} value={p.id}>{labelOf(p)}</option>
      ))}
      {KNOWN_TYPES.map(({ key, label }) => {
        const group = periods.filter(p => isGroupable(p) && p.type === key).sort(sortByStart);
        if (group.length === 0) return null;
        return (
          <optgroup key={key} label={label}>
            {group.map(p => (
              <option key={p.id} value={p.id}>{labelOf(p)}</option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}
