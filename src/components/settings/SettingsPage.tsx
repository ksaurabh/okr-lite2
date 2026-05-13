import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || '';

interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  domain: string;
  organizationId: string;
  organizationName?: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastLoginAt: string;
}

export function SettingsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [showAllOrgs, setShowAllOrgs] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [myName, setMyName] = useState('');
  const [savingMyName, setSavingMyName] = useState(false);
  const [myNameSaved, setMyNameSaved] = useState(false);
  const [profileOpen, setProfileOpen] = useState(true);
  const [usersOpen, setUsersOpen] = useState(true);

  const { isSuperAdmin, isOrgAdmin, user: currentUser } = useAuth();
  const canManageRoles = isSuperAdmin || isOrgAdmin;

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    const me = users.find(u => u.email.toLowerCase() === currentUser?.email?.toLowerCase());
    if (me?.name) setMyName(me.name);
    else if (currentUser?.name) setMyName(currentUser.name);
  }, [users, currentUser?.email, currentUser?.name]);

  const saveMyName = async () => {
    if (!currentUser?.email || !myName.trim()) return;
    try {
      setSavingMyName(true);
      setError(null);
      const response = await fetch(`${API_URL}/api/users/${encodeURIComponent(currentUser.email)}/name`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: myName.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update name');
      setUsers(users.map(u => u.email.toLowerCase() === currentUser.email!.toLowerCase() ? { ...u, name: data.user.name } : u));
      window.dispatchEvent(new CustomEvent('user-name-updated', { detail: { email: currentUser.email, name: data.user.name } }));
      setMyNameSaved(true);
      setTimeout(() => setMyNameSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update name');
    } finally {
      setSavingMyName(false);
    }
  };

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/users`, {
        credentials: 'include',
      });
      const data = await response.json();
      setUsers(data.users || []);
      setShowAllOrgs(data.allOrgs || false);
      setError(null);
    } catch (err) {
      setError('Failed to load users');
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

  const deleteUser = async (email: string) => {
    if (email.toLowerCase() === currentUser?.email?.toLowerCase()) {
      setError('You cannot delete your own account.');
      return;
    }
    if (!window.confirm(`Delete user "${email}"? This cannot be undone.`)) return;
    try {
      setUpdating(email);
      const response = await fetch(`${API_URL}/api/users/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete user');
      }
      setUsers(users.filter(u => u.email !== email));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
      console.error('Error deleting user:', err);
    } finally {
      setUpdating(null);
    }
  };

  const updateRole = async (email: string, newRole: 'admin' | 'user') => {
    try {
      setUpdating(email);
      const response = await fetch(`${API_URL}/api/users/${encodeURIComponent(email)}/role`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: newRole }),
      });

      if (!response.ok) {
        throw new Error('Failed to update role');
      }

      const data = await response.json();
      setUsers(users.map(u => u.email === email ? data.user : u));
    } catch (err) {
      setError('Failed to update user role');
      console.error('Error updating role:', err);
    } finally {
      setUpdating(null);
    }
  };

  const createUser = async () => {
    if (!newUserEmail.trim() || !newUserName.trim()) return;

    try {
      setCreating(true);
      setError(null);
      const response = await fetch(`${API_URL}/api/users`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: newUserEmail.trim(),
          name: newUserName.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create user');
      }

      setUsers([...users, data.user]);
      setNewUserEmail('');
      setNewUserName('');
      setShowAddUser(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
      console.error('Error creating user:', err);
    } finally {
      setCreating(false);
    }
  };

  const updateName = async () => {
    if (!editingUser || !editName.trim()) return;

    try {
      setUpdating(editingUser.email);
      setError(null);
      const response = await fetch(`${API_URL}/api/users/${encodeURIComponent(editingUser.email)}/name`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: editName.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update name');
      }

      setUsers(users.map(u => u.email === editingUser.email ? { ...u, name: data.user.name } : u));
      window.dispatchEvent(new CustomEvent('user-name-updated', { detail: { email: editingUser.email, name: data.user.name } }));
      setEditingUser(null);
      setEditName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update name');
      console.error('Error updating name:', err);
    } finally {
      setUpdating(null);
    }
  };

  const startEditingUser = (user: User) => {
    setEditingUser(user);
    setEditName(user.name);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500">Manage your organization settings</p>
      </div>

      {/* Your Profile */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <button
          type="button"
          onClick={() => setProfileOpen(!profileOpen)}
          className={`w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 ${profileOpen ? 'border-b border-gray-200' : ''}`}
        >
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Your Profile</h2>
            <p className="text-sm text-gray-500">Update the name shown to others in your organization.</p>
          </div>
          <svg className={`w-5 h-5 text-gray-400 transition-transform ${profileOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {profileOpen && (
        <div className="p-4 space-y-3">
          <div className="max-w-md">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Email (login)</label>
            <input
              type="text"
              value={currentUser?.email || ''}
              readOnly
              disabled
              className="w-full border border-gray-200 bg-gray-50 text-gray-500 rounded-md px-3 py-2 text-sm cursor-not-allowed"
            />
            <p className="text-xs text-gray-400 mt-1">Email is tied to your Google login and cannot be changed.</p>
          </div>
          <div className="flex items-end gap-3">
          <div className="flex-1 max-w-md">
            <label htmlFor="myName" className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Display name</label>
            <input
              id="myName"
              type="text"
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              placeholder="Your display name"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={saveMyName}
            disabled={savingMyName || !myName.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {savingMyName ? 'Saving…' : 'Save'}
          </button>
          {myNameSaved && <span className="text-sm text-green-600">Saved</span>}
          </div>
        </div>
        )}
      </div>

      {/* Users Section */}
      {canManageRoles && (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className={`p-4 ${usersOpen ? 'border-b border-gray-200' : ''} flex items-center justify-between gap-3`}>
          <button
            type="button"
            onClick={() => setUsersOpen(!usersOpen)}
            className="flex-1 flex items-center justify-between text-left hover:bg-gray-50 -m-4 p-4 rounded"
          >
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Users</h2>
              <p className="text-sm text-gray-500">
                {showAllOrgs ? 'All users across all organizations' : 'Members of your organization'}
              </p>
            </div>
            <svg className={`w-5 h-5 text-gray-400 transition-transform ${usersOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          {usersOpen && canManageRoles && (
            <button
              onClick={() => setShowAddUser(true)}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Add User
            </button>
          )}
        </div>

        {usersOpen && (loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-gray-500">Loading users...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-red-500">{error}</p>
            <button
              onClick={fetchUsers}
              className="mt-2 text-blue-600 hover:text-blue-700"
            >
              Try again
            </button>
          </div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-500">No users found in your organization.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  {showAllOrgs && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Organization
                    </th>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Login
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        {user.picture ? (
                          <img
                            src={user.picture}
                            alt={user.name}
                            className="w-8 h-8 rounded-full"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                            <span className="text-sm font-medium text-gray-600">
                              {user.name?.charAt(0) || user.email.charAt(0)}
                            </span>
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium text-gray-900">{user.name}</p>
                          <p className="text-xs text-gray-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    {showAllOrgs && (
                      <td className="px-4 py-4">
                        <span className="text-sm text-gray-700">{user.organizationName}</span>
                      </td>
                    )}
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          user.role === 'admin'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {user.role === 'admin' ? 'Admin' : 'User'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-500">
                      {formatDate(user.lastLoginAt)}
                    </td>
                    {(canManageRoles || user.email.toLowerCase() === currentUser?.email?.toLowerCase()) && (
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          {(canManageRoles || user.email.toLowerCase() === currentUser?.email?.toLowerCase()) && (
                            <button
                              onClick={() => startEditingUser(user)}
                              className="p-1 text-gray-400 hover:text-blue-600 rounded"
                              title="Edit name"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                          )}
                          {canManageRoles && (
                          <select
                            value={user.role}
                            onChange={(e) => updateRole(user.email, e.target.value as 'admin' | 'user')}
                            disabled={updating === user.email}
                            className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                          )}
                          {user.email.toLowerCase() !== currentUser?.email?.toLowerCase() && (
                            <button
                              onClick={() => deleteUser(user.email)}
                              disabled={updating === user.email}
                              className="p-1 text-gray-400 hover:text-red-600 rounded disabled:opacity-50"
                              title="Delete user"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                          {updating === user.email && (
                            <span className="text-xs text-gray-500">Saving...</span>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      )}

      {/* Add User Modal */}
      {showAddUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Add New User</h3>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={creating}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={creating}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowAddUser(false);
                  setNewUserEmail('');
                  setNewUserName('');
                  setError(null);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
                disabled={creating}
              >
                Cancel
              </button>
              <button
                onClick={createUser}
                disabled={creating || !newUserEmail.trim() || !newUserName.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit User</h3>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={editingUser.email}
                  disabled
                  className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 text-gray-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={updating === editingUser.email}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setEditingUser(null);
                  setEditName('');
                  setError(null);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
                disabled={updating === editingUser.email}
              >
                Cancel
              </button>
              <button
                onClick={updateName}
                disabled={updating === editingUser.email || !editName.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {updating === editingUser.email ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
