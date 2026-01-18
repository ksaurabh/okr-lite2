import { useState, useMemo, useEffect } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import type { Objective, ProgressUpdate, User } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface UpdateWithObjective {
  update: ProgressUpdate;
  objective: Objective;
}

export function UpdatesPage() {
  const { organization, user, isSuperAdmin, isOrgAdmin } = useAuth();
  const orgId = organization?.id || '';
  const userEmail = user?.email || '';
  const isAdmin = isSuperAdmin || isOrgAdmin;

  const objectives = useOKRStore((state: OKRStore) => state.objectives);
  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [filterOwnerId, setFilterOwnerId] = useState<string>('');
  const [filterUpdatedBy, setFilterUpdatedBy] = useState<string>('');

  // Fetch organization users
  useEffect(() => {
    const fetchUsers = async () => {
      if (!orgId) return;
      try {
        const response = await fetch(`${API_URL}/api/users?orgId=${orgId}`, {
          credentials: 'include',
        });
        if (response.ok) {
          const users = await response.json();
          setOrgUsers(Array.isArray(users) ? users : []);
        }
      } catch (error) {
        console.error('Failed to fetch users:', error);
      }
    };
    fetchUsers();
  }, [orgId]);

  // Filter objectives by organization and visibility
  const orgObjectives = useMemo(
    () => objectives.filter((o: Objective) =>
      (!o.orgId || o.orgId === orgId) && (isAdmin || o.shared !== false || o.createdBy === userEmail)
    ),
    [objectives, orgId, userEmail, isAdmin]
  );

  // Collect all progress updates with their objectives
  const allUpdates = useMemo(() => {
    const updates: UpdateWithObjective[] = [];
    for (const objective of orgObjectives) {
      if (objective.progressUpdates) {
        for (const update of objective.progressUpdates) {
          updates.push({ update, objective });
        }
      }
    }
    // Sort by date, most recent first
    return updates.sort((a, b) =>
      new Date(b.update.createdAt).getTime() - new Date(a.update.createdAt).getTime()
    );
  }, [orgObjectives]);

  // Get unique owners and updaters for filter dropdowns
  const uniqueOwnerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const { objective } of allUpdates) {
      if (objective.ownerId) {
        ids.add(objective.ownerId);
      }
    }
    return Array.from(ids);
  }, [allUpdates]);

  const uniqueUpdaterEmails = useMemo(() => {
    const emails = new Set<string>();
    for (const { update } of allUpdates) {
      emails.add(update.createdBy);
    }
    return Array.from(emails);
  }, [allUpdates]);

  // Apply filters
  const filteredUpdates = useMemo(() => {
    return allUpdates.filter(({ update, objective }) => {
      if (filterOwnerId && objective.ownerId !== filterOwnerId) {
        return false;
      }
      if (filterUpdatedBy && update.createdBy !== filterUpdatedBy) {
        return false;
      }
      return true;
    });
  }, [allUpdates, filterOwnerId, filterUpdatedBy]);

  // Helper to get user name by ID
  const getUserName = (userId: string): string => {
    if (!orgUsers || !Array.isArray(orgUsers)) return userId;
    const user = orgUsers.find((u: User) => u.id === userId);
    return user?.name || user?.email || userId;
  };

  // Helper to get user name by email
  const getUserNameByEmail = (email: string): string => {
    if (!orgUsers || !Array.isArray(orgUsers)) return email;
    const user = orgUsers.find((u: User) => u.email === email);
    return user?.name || email;
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">All Progress Updates</h2>
          <p className="text-sm text-gray-500 mt-1">
            {filteredUpdates.length} {filteredUpdates.length === 1 ? 'update' : 'updates'}
            {(filterOwnerId || filterUpdatedBy) && ` (filtered from ${allUpdates.length} total)`}
          </p>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Owner:</label>
              <select
                value={filterOwnerId}
                onChange={(e) => setFilterOwnerId(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All owners</option>
                {uniqueOwnerIds.map((id) => (
                  <option key={id} value={id}>
                    {getUserName(id)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Updated by:</label>
              <select
                value={filterUpdatedBy}
                onChange={(e) => setFilterUpdatedBy(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All users</option>
                {uniqueUpdaterEmails.map((email) => (
                  <option key={email} value={email}>
                    {getUserNameByEmail(email)}
                  </option>
                ))}
              </select>
            </div>

            {(filterOwnerId || filterUpdatedBy) && (
              <button
                onClick={() => {
                  setFilterOwnerId('');
                  setFilterUpdatedBy('');
                }}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {filteredUpdates.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <svg className="mx-auto h-10 w-10 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm">
              {allUpdates.length === 0
                ? 'No progress updates yet. Add updates to objectives to track progress.'
                : 'No updates match the current filters.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Update
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Objective
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Owner
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Updated By
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredUpdates.map(({ update, objective }) => (
                  <tr key={update.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {update.text}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      <span className="truncate max-w-xs inline-block" title={objective.title}>
                        {objective.title}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {objective.ownerId ? getUserName(objective.ownerId) : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {getUserNameByEmail(update.createdBy)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {formatDate(update.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
