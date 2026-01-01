import { useOKRStore } from '../../store/okrStore';

interface HeaderProps {
  onAddObjective: () => void;
}

export function Header({ onAddObjective }: HeaderProps) {
  const periods = useOKRStore((state) => state.periods);
  const activePeriodId = useOKRStore((state) => state.activePeriodId);
  const setActivePeriod = useOKRStore((state) => state.setActivePeriod);
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-900">OKR Lite</h1>
          {periods.length > 0 && (
            <select
              value={activePeriodId || ''}
              onChange={(e) => setActivePeriod(e.target.value || null)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Periods</option>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          onClick={onAddObjective}
          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Add Objective
        </button>
      </div>
    </header>
  );
}
