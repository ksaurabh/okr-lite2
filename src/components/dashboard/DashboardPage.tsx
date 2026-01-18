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

export function DashboardPage() {
  const [orgUsers, setOrgUsers] = useState<User[]>([]);

  const { organization, user, isSuperAdmin, isOrgAdmin } = useAuth();
  const orgId = organization?.id || '';
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;

  // Fetch users for owner names
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

  // Filter objectives by organization and visibility
  const orgObjectives = useMemo(
    () => objectives.filter((o: Objective) =>
      (!o.orgId || o.orgId === orgId) && (isAdmin || o.shared !== false || o.createdBy === userEmail)
    ),
    [objectives, orgId, userEmail, isAdmin]
  );

  // Get items without next step grouped by owner
  const itemsWithoutNextStepByOwner = useMemo(() => {
    const withoutNextStep = orgObjectives.filter((obj: Objective) => !obj.nextStepDate);

    // Group by owner
    const grouped = new Map<string | undefined, Objective[]>();

    withoutNextStep.forEach((obj: Objective) => {
      const key = obj.ownerId;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(obj);
    });

    // Convert to array with owner names
    const stats: OwnerStats[] = [];
    grouped.forEach((items, ownerId) => {
      const owner = orgUsers.find((u: User) => u.id === ownerId);
      stats.push({
        ownerId,
        ownerName: owner?.name || (ownerId ? 'Unknown' : 'Unassigned'),
        count: items.length,
      });
    });

    // Sort by count descending
    stats.sort((a, b) => b.count - a.count);

    return stats;
  }, [orgObjectives, orgUsers]);

  const totalWithoutNextStep = itemsWithoutNextStepByOwner.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Overview of your OKR metrics</p>
      </div>

      {/* Items without Next Step by Owner */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Items without Next Step by Owner</h2>
          <p className="text-sm text-gray-500 mt-1">
            {totalWithoutNextStep} {totalWithoutNextStep === 1 ? 'item' : 'items'} missing a next step date
          </p>
        </div>

        {itemsWithoutNextStepByOwner.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <svg className="mx-auto h-10 w-10 text-green-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm">All items have a next step defined!</p>
          </div>
        ) : (
          <div className="overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Owner
                  </th>
                  <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Count
                  </th>
                  <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    % of Total
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {itemsWithoutNextStepByOwner.map((stat) => (
                  <tr key={stat.ownerId || 'unassigned'} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {stat.ownerName}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                      {stat.count}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                      {totalWithoutNextStep > 0
                        ? `${Math.round((stat.count / totalWithoutNextStep) * 100)}%`
                        : '0%'
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td className="px-6 py-3 text-sm font-medium text-gray-900">
                    Total
                  </td>
                  <td className="px-6 py-3 text-sm font-medium text-gray-900 text-right">
                    {totalWithoutNextStep}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-500 text-right">
                    100%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
