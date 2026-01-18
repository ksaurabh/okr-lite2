import { useMemo, useState, useEffect } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import type { Objective, User } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';

interface OwnerStats {
  ownerId: string | undefined;
  ownerName: string;
  count: number;
}

// Widget wrapper component for consistent sizing
function DashboardWidget({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 h-full flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-200 flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}

// Items without Next Step by Owner widget
function ItemsWithoutNextStepWidget({ orgObjectives, orgUsers }: { orgObjectives: Objective[]; orgUsers: User[] }) {
  const itemsWithoutNextStepByOwner = useMemo(() => {
    const withoutNextStep = orgObjectives.filter((obj: Objective) => !obj.nextStepDate);

    const grouped = new Map<string | undefined, Objective[]>();
    withoutNextStep.forEach((obj: Objective) => {
      const key = obj.ownerId;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(obj);
    });

    const stats: OwnerStats[] = [];
    grouped.forEach((items, ownerId) => {
      const owner = orgUsers.find((u: User) => u.id === ownerId);
      stats.push({
        ownerId,
        ownerName: owner?.name || (ownerId ? 'Unknown' : 'Unassigned'),
        count: items.length,
      });
    });

    stats.sort((a, b) => b.count - a.count);
    return stats;
  }, [orgObjectives, orgUsers]);

  const totalWithoutNextStep = itemsWithoutNextStepByOwner.reduce((sum, s) => sum + s.count, 0);

  return (
    <DashboardWidget
      title="Items without Next Step"
      subtitle={`${totalWithoutNextStep} ${totalWithoutNextStep === 1 ? 'item' : 'items'} by owner`}
    >
      {itemsWithoutNextStepByOwner.length === 0 ? (
        <div className="p-4 text-center text-gray-500">
          <svg className="mx-auto h-8 w-8 text-green-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs">All items have a next step!</p>
        </div>
      ) : (
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                Owner
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-gray-500 uppercase tracking-wider">
                Count
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-gray-500 uppercase tracking-wider">
                %
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {itemsWithoutNextStepByOwner.map((stat) => (
              <tr key={stat.ownerId || 'unassigned'} className="hover:bg-gray-50">
                <td className="px-3 py-2 whitespace-nowrap text-gray-900">
                  {stat.ownerName}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-900 text-right">
                  {stat.count}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-500 text-right">
                  {totalWithoutNextStep > 0
                    ? `${Math.round((stat.count / totalWithoutNextStep) * 100)}%`
                    : '0%'
                  }
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 sticky bottom-0">
            <tr>
              <td className="px-3 py-2 font-medium text-gray-900">
                Total
              </td>
              <td className="px-3 py-2 font-medium text-gray-900 text-right">
                {totalWithoutNextStep}
              </td>
              <td className="px-3 py-2 text-gray-500 text-right">
                100%
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </DashboardWidget>
  );
}

// Empty placeholder widget
function EmptyWidget() {
  return (
    <div className="bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 h-full flex items-center justify-center">
      <p className="text-xs text-gray-400">Empty</p>
    </div>
  );
}

export function DashboardPage() {
  const [orgUsers, setOrgUsers] = useState<User[]>([]);

  const { organization, user, isSuperAdmin, isOrgAdmin } = useAuth();
  const orgId = organization?.id || '';
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch(`${API_URL}/api/users`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setOrgUsers(data.users || []);
        }
      } catch (err) {
        console.error('Failed to fetch users:', err);
      }
    };
    fetchUsers();
  }, []);

  const objectives = useOKRStore((state: OKRStore) => state.objectives);

  const orgObjectives = useMemo(
    () => objectives.filter((o: Objective) =>
      (!o.orgId || o.orgId === orgId) && (isAdmin || o.shared !== false || o.createdBy === userEmail)
    ),
    [objectives, orgId, userEmail, isAdmin]
  );

  // Calculate row height as roughly 1/3 of viewport height minus header space
  // Using calc with vh units for responsive sizing
  const cellHeight = 'calc((100vh - 180px) / 3)';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Overview of your OKR metrics</p>
      </div>

      {/* 3x3 Grid */}
      <div
        className="grid grid-cols-3 gap-4"
        style={{ gridAutoRows: cellHeight }}
      >
        {/* Row 1 */}
        {/* Cell (1,1) - Items without Next Step by Owner */}
        <ItemsWithoutNextStepWidget orgObjectives={orgObjectives} orgUsers={orgUsers} />

        {/* Cell (1,2) - Empty */}
        <EmptyWidget />

        {/* Cell (1,3) - Empty */}
        <EmptyWidget />

        {/* Row 2 */}
        {/* Cell (2,1) - Empty */}
        <EmptyWidget />

        {/* Cell (2,2) - Empty */}
        <EmptyWidget />

        {/* Cell (2,3) - Empty */}
        <EmptyWidget />

        {/* Row 3 */}
        {/* Cell (3,1) - Empty */}
        <EmptyWidget />

        {/* Cell (3,2) - Empty */}
        <EmptyWidget />

        {/* Cell (3,3) - Empty */}
        <EmptyWidget />
      </div>
    </div>
  );
}
