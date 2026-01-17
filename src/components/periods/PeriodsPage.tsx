import { useMemo } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import type { Period, PeriodType } from '../../types';

const PERIOD_TYPE_BADGES: Record<PeriodType, { label: string; color: string }> = {
  quarter: { label: 'Quarter', color: 'bg-purple-100 text-purple-700' },
  month: { label: 'Month', color: 'bg-blue-100 text-blue-700' },
  week: { label: 'Week', color: 'bg-green-100 text-green-700' },
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function PeriodsPage() {
  const { organization, user, isSuperAdmin, isOrgAdmin } = useAuth();
  const orgId = organization?.id || '';
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;

  const periods = useOKRStore((state: OKRStore) => state.periods);

  // Filter periods by organization and visibility
  const orgPeriods = useMemo(
    () => periods.filter((p: Period) =>
      (!p.orgId || p.orgId === orgId) && (isAdmin || p.shared !== false || p.createdBy === userEmail)
    ).sort((a: Period, b: Period) => a.startDate.localeCompare(b.startDate)),
    [periods, orgId, userEmail, isAdmin]
  );

  // Get parent period name
  const getParentName = (parentId?: string): string => {
    if (!parentId) return '-';
    const parent = periods.find((p: Period) => p.id === parentId);
    return parent?.name || '-';
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">All Periods</h2>
          <p className="text-sm text-gray-500 mt-1">
            {orgPeriods.length} {orgPeriods.length === 1 ? 'period' : 'periods'} total
          </p>
        </div>

        {orgPeriods.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <svg className="mx-auto h-10 w-10 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-sm">No periods yet. Add a quarter from the sidebar to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Parent
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Start Date
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    End Date
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {orgPeriods.map((period: Period) => {
                  const badge = PERIOD_TYPE_BADGES[period.type];
                  const startDate = new Date(period.startDate);
                  const endDate = new Date(period.endDate);
                  const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

                  return (
                    <tr key={period.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {period.name}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {getParentName(period.parentId)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {formatDate(period.startDate)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {formatDate(period.endDate)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {durationDays} days
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
