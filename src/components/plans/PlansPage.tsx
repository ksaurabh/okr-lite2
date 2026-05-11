import { useEffect, useMemo, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import type { List, Period, User } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';

type View = 'dashboard' | 'objectives' | 'plans' | 'views' | 'checklist' | 'progress' | 'updates' | 'lists' | 'logwork' | 'teams' | 'periods' | 'tags' | 'settings' | 'admin' | 'logs';

interface PlansPageProps {
  onViewChange: (view: View) => void;
}

export function PlansPage({ onViewChange }: PlansPageProps) {
  const lists = useOKRStore((s: OKRStore) => s.lists);
  const periods = useOKRStore((s: OKRStore) => s.periods);
  const createList = useOKRStore((s: OKRStore) => s.createList);
  const updateListParent = useOKRStore((s: OKRStore) => s.updateListParent);
  const setListViewMode = useOKRStore((s: OKRStore) => s.setListViewMode);
  const setPlanFocusListId = useOKRStore((s: OKRStore) => s.setPlanFocusListId);

  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newOwnerId, setNewOwnerId] = useState('');
  const [newPeriodId, setNewPeriodId] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [promoteListId, setPromoteListId] = useState<string | null>(null);
  const [promoteOwnerId, setPromoteOwnerId] = useState('');
  const [promotePeriodId, setPromotePeriodId] = useState('');

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

  const planLists = useMemo(
    () => lists.filter(l => l.ownerId && l.periodId).sort((a, b) => a.name.localeCompare(b.name)),
    [lists]
  );
  const nonPlanLists = useMemo(
    () => lists.filter(l => !(l.ownerId && l.periodId)).sort((a, b) => a.name.localeCompare(b.name)),
    [lists]
  );

  const ownerName = (id?: string) => id ? (orgUsers.find(u => u.id === id)?.name || orgUsers.find(u => u.id === id)?.email || id) : '—';
  const periodName = (id?: string) => id ? (periods.find((p: Period) => p.id === id)?.name || id) : '—';

  const openPlan = async (list: List) => {
    await setListViewMode(list.id, 'plan');
    setPlanFocusListId(list.id);
    window.localStorage.setItem('okr-lists-pending-selection', list.id);
    onViewChange('lists');
  };

  const handleCreate = async () => {
    setCreateError(null);
    const name = newName.trim();
    if (!name || !newOwnerId || !newPeriodId) {
      setCreateError('Name, Owner, and Period are required.');
      return;
    }
    setCreating(true);
    try {
      const result = await createList(name, undefined, undefined, { ownerId: newOwnerId, periodId: newPeriodId });
      if (result && typeof result === 'object' && 'error' in result) {
        setCreateError(result.error);
        return;
      }
      setShowCreate(false);
      setNewName('');
      setNewOwnerId('');
      setNewPeriodId('');
    } finally {
      setCreating(false);
    }
  };

  const handlePromote = async () => {
    const list = lists.find(l => l.id === promoteListId);
    if (!list || !promoteOwnerId || !promotePeriodId) return;
    // Apply ownerId then periodId via the parent-update endpoint (which now handles any field).
    await updateListParent(list.id, list.parentId || null); // no-op for parent
    // We don't have a dedicated setter; use a direct fetch via createList? Instead, use updateList?
    // Simpler: send a PUT with both fields.
    try {
      await fetch(`${API_URL}/api/users/me/lists/${list.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: promoteOwnerId, periodId: promotePeriodId }),
      });
      // Optimistic local update
      useOKRStore.setState({
        lists: useOKRStore.getState().lists.map(l =>
          l.id === list.id ? { ...l, ownerId: promoteOwnerId, periodId: promotePeriodId } : l
        ),
      });
    } catch (err) {
      console.error('Failed to promote list:', err);
    }
    setPromoteListId(null);
    setPromoteOwnerId('');
    setPromotePeriodId('');
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Plans</h2>
            <p className="text-sm text-gray-500 mt-1">
              {planLists.length} {planLists.length === 1 ? 'plan' : 'plans'} (a plan is a list with an owner and a period)
            </p>
          </div>
          <button
            onClick={() => { setNewName(''); setNewOwnerId(''); setNewPeriodId(''); setCreateError(null); setShowCreate(true); }}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + Create plan
          </button>
        </div>

        {planLists.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No plans yet. Click "Create plan" to make one.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Owner</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {planLists.map(list => (
                <tr key={list.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">
                    <button
                      onClick={() => openPlan(list)}
                      className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-left flex items-center gap-2"
                    >
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: list.color || '#6b7280' }} />
                      {list.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{ownerName(list.ownerId)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{periodName(list.periodId)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{list.items.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {nonPlanLists.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-base font-semibold text-gray-900">Lists without an owner & period</h3>
            <p className="text-xs text-gray-500 mt-1">Promote any of these to a plan by adding both.</p>
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {nonPlanLists.map(list => (
                <tr key={list.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: list.color || '#6b7280' }} />
                    {list.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{list.items.length}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { setPromoteListId(list.id); setPromoteOwnerId(''); setPromotePeriodId(''); }}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      Convert to plan →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Create plan</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Owner</label>
                <select
                  value={newOwnerId}
                  onChange={(e) => setNewOwnerId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">— Pick an owner —</option>
                  {[...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Period</label>
                <select
                  value={newPeriodId}
                  onChange={(e) => setNewPeriodId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">— Pick a period —</option>
                  {[...periods].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((p: Period) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {createError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{createError}</div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                disabled={creating}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim() || !newOwnerId || !newPeriodId}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {promoteListId && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Convert to plan</h3>
            <p className="text-xs text-gray-600 mb-3">
              Pick an owner and a period to convert "{lists.find(l => l.id === promoteListId)?.name}" into a plan.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Owner</label>
                <select
                  value={promoteOwnerId}
                  onChange={(e) => setPromoteOwnerId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">— Pick an owner —</option>
                  {[...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)).map(u => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Period</label>
                <select
                  value={promotePeriodId}
                  onChange={(e) => setPromotePeriodId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">— Pick a period —</option>
                  {[...periods].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((p: Period) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPromoteListId(null)}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handlePromote}
                disabled={!promoteOwnerId || !promotePeriodId}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Convert
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
