import { useEffect, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { LEVEL_OPTIONS, WORKFLOW_STATUS_OPTIONS } from '../../utils/objectiveFilters';
import type { Period, User } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';

interface PlansPageProps {
  onViewChange: (view: 'dashboard' | 'objectives' | 'plans' | 'views' | 'checklist' | 'progress' | 'updates' | 'lists' | 'logwork' | 'teams' | 'periods' | 'tags' | 'settings' | 'admin' | 'logs') => void;
}

export function PlansPage({ onViewChange }: PlansPageProps) {
  const plans = useOKRStore((s: OKRStore) => s.plans);
  const activePlanId = useOKRStore((s: OKRStore) => s.activePlanId);
  const applyPlan = useOKRStore((s: OKRStore) => s.applyPlan);
  const deletePlan = useOKRStore((s: OKRStore) => s.deletePlan);
  const setObjectiveViewMode = useOKRStore((s: OKRStore) => s.setObjectiveViewMode);
  const periods = useOKRStore((s: OKRStore) => s.periods);

  const [orgUsers, setOrgUsers] = useState<User[]>([]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch(`${API_URL}/api/users`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setOrgUsers(data.users || []);
        }
      } catch (err) {
        console.error('Failed to fetch users:', err);
      }
    };
    fetchUsers();
  }, []);

  const ownerName = (id: string) => id ? (orgUsers.find(u => u.id === id)?.name || orgUsers.find(u => u.id === id)?.email || id) : 'Any';
  const periodName = (id: string) => id ? (periods.find((p: Period) => p.id === id)?.name || id) : 'Any';
  const levelLabel = (v: string) => v ? (LEVEL_OPTIONS.find(l => l.value === v)?.label || v) : 'Any';
  const statusLabels = (vs: string[]) => vs.length === 0 ? 'Any' : vs.map(s => WORKFLOW_STATUS_OPTIONS.find(o => o.value === s)?.label || s).join(', ');

  const handleOpen = (id: string) => {
    setObjectiveViewMode('plan');
    applyPlan(id);
    onViewChange('objectives');
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Plans</h2>
          <p className="text-sm text-gray-500 mt-1">
            {plans.length} {plans.length === 1 ? 'plan' : 'plans'} saved
          </p>
        </div>
        {plans.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No saved plans yet. Open the Objectives view in <span className="font-medium">Plan</span> mode and use the
            "Save as Plan" button on the right pane to create one.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Owner</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Level</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {plans.map(plan => (
                <tr
                  key={plan.id}
                  className={`hover:bg-gray-50 ${activePlanId === plan.id ? 'bg-blue-50' : ''}`}
                >
                  <td className="px-4 py-3 text-sm">
                    <button
                      onClick={() => handleOpen(plan.id)}
                      className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-left"
                    >
                      {plan.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{ownerName(plan.filters.ownerId)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{periodName(plan.filters.periodId)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{levelLabel(plan.filters.level)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{statusLabels(plan.filters.statuses)}</td>
                  <td className="px-4 py-3 text-right text-sm">
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete plan "${plan.name}"?`)) deletePlan(plan.id);
                      }}
                      className="p-1 text-gray-400 hover:text-red-600"
                      title="Delete plan"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
