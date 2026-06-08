import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useOKRStore, type OKRStore } from '../../store/okrStore';

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
  const [jiraOpen, setJiraOpen] = useState(true);
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');
  const [jiraHasToken, setJiraHasToken] = useState(false);
  const [jiraProjectKey, setJiraProjectKey] = useState('');
  const [jiraProjects, setJiraProjects] = useState<Array<{ id: string; key: string; name: string }>>([]);
  const [jiraSaving, setJiraSaving] = useState(false);
  const [jiraLoadingProjects, setJiraLoadingProjects] = useState(false);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [jiraSaved, setJiraSaved] = useState(false);
  const [jiraEpicFields, setJiraEpicFields] = useState<Array<{ key: string; name: string; required: boolean; schema?: { type?: string; custom?: string } | null; allowedValues?: Array<{ id?: string; value?: string; name?: string; key?: string }> }>>([]);
  const [jiraEpicMeta, setJiraEpicMeta] = useState<{ project?: { key: string; name: string }; issueType?: { id: string; name: string } } | null>(null);
  const [jiraLoadingFields, setJiraLoadingFields] = useState(false);
  const [periodFieldKey, setPeriodFieldKey] = useState<string>('');
  const [periodValueMap, setPeriodValueMap] = useState<Record<string, string | { id?: string; value?: string }>>({});
  const periodsAll = useOKRStore((s: OKRStore) => s.periods);
  const [periodFieldSearch, setPeriodFieldSearch] = useState('');
  const [periodFieldMenuOpen, setPeriodFieldMenuOpen] = useState(false);
  const [creatingPeriodField, setCreatingPeriodField] = useState(false);

  const loadEpicFields = async () => {
    setJiraLoadingFields(true); setJiraError(null);
    try {
      const res = await fetch(`${API_URL}/api/jira/epic-fields`, { credentials: 'include' });
      if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(t || `HTTP ${res.status}`); }
      const data = await res.json();
      setJiraEpicFields(data.fields || []);
      setJiraEpicMeta({ project: data.project, issueType: data.issueType });
    } catch (err) {
      setJiraError(String(err));
      setJiraEpicFields([]);
      setJiraEpicMeta(null);
    } finally {
      setJiraLoadingFields(false);
    }
  };

  const saveJiraConfig = async (overrides?: Record<string, unknown>) => {
    setJiraSaving(true); setJiraError(null); setJiraSaved(false);
    try {
      const body: Record<string, unknown> = {
        baseUrl: jiraBaseUrl.trim(),
        email: jiraEmail.trim(),
        projectKey: jiraProjectKey.trim(),
        ...(overrides || {}),
      };
      if (jiraToken.trim()) body.apiToken = jiraToken.trim();
      const res = await fetch(`${API_URL}/api/admin/jira-config`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(t || `HTTP ${res.status}`); }
      const data = await res.json();
      setJiraHasToken(!!data?.config?.hasToken);
      setJiraToken('');
      setJiraSaved(true);
      setTimeout(() => setJiraSaved(false), 2000);
    } catch (err) {
      setJiraError(String(err));
    } finally {
      setJiraSaving(false);
    }
  };

  const loadJiraProjects = async () => {
    setJiraLoadingProjects(true); setJiraError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/jira/projects`, { credentials: 'include' });
      if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(t || `HTTP ${res.status}`); }
      const data = await res.json();
      setJiraProjects(data.projects || []);
    } catch (err) {
      setJiraError(String(err));
      setJiraProjects([]);
    } finally {
      setJiraLoadingProjects(false);
    }
  };

  const { isSuperAdmin, isOrgAdmin, user: currentUser } = useAuth();
  const canManageRoles = isSuperAdmin || isOrgAdmin;

  useEffect(() => {
    if (!(isSuperAdmin || isOrgAdmin)) return;
    fetch(`${API_URL}/api/admin/jira-config`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { config: null })
      .then(d => {
        const cfg = d?.config;
        if (cfg) {
          setJiraBaseUrl(cfg.baseUrl || '');
          setJiraEmail(cfg.email || '');
          setJiraProjectKey(cfg.projectKey || '');
          setJiraHasToken(!!cfg.hasToken);
          setPeriodFieldKey(cfg.periodFieldKey || '');
          setPeriodValueMap(cfg.periodValueMap || {});
        }
      })
      .catch(() => { /* ignore */ });
  }, [isSuperAdmin, isOrgAdmin]);

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

      {(isSuperAdmin || isOrgAdmin) && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <button
            onClick={() => setJiraOpen(!jiraOpen)}
            className="w-full p-4 flex items-center justify-between hover:bg-gray-50"
          >
            <h2 className="text-base font-semibold text-gray-900">Jira integration</h2>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${jiraOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {jiraOpen && (
            <div className="p-4 border-t border-gray-200 space-y-3">
              <p className="text-xs text-gray-500">Connect this organization to Jira so admins can create tracking Epics for objectives. Uses Basic auth with an Atlassian email + API token.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Jira base URL</label>
                  <input type="text" value={jiraBaseUrl} onChange={(e) => setJiraBaseUrl(e.target.value)} placeholder="https://your-org.atlassian.net" className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Atlassian email</label>
                  <input type="email" value={jiraEmail} onChange={(e) => setJiraEmail(e.target.value)} placeholder="you@example.com" className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">API token {jiraHasToken && <span className="text-gray-400">(saved — enter a new value to replace)</span>}</label>
                  <input type="password" value={jiraToken} onChange={(e) => setJiraToken(e.target.value)} placeholder={jiraHasToken ? '••••••••' : 'Paste your Atlassian API token'} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => saveJiraConfig()} disabled={jiraSaving} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                  {jiraSaving ? 'Saving…' : 'Save credentials'}
                </button>
                <button onClick={loadJiraProjects} disabled={jiraLoadingProjects || !jiraHasToken && !jiraToken} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
                  {jiraLoadingProjects ? 'Loading…' : 'Load projects'}
                </button>
                {jiraSaved && <span className="text-xs text-green-700">Saved.</span>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">OKR project</label>
                <div className="flex items-center gap-2">
                  <select
                    value={jiraProjectKey}
                    onChange={(e) => { setJiraProjectKey(e.target.value); saveJiraConfig({ projectKey: e.target.value }); }}
                    className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
                  >
                    <option value="">— Pick a project —</option>
                    {jiraProjects.map(p => <option key={p.id} value={p.key}>{p.name} ({p.key})</option>)}
                    {jiraProjectKey && !jiraProjects.some(p => p.key === jiraProjectKey) && (
                      <option value={jiraProjectKey}>{jiraProjectKey} (current)</option>
                    )}
                  </select>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Click "Load projects" to populate. Selecting a project saves immediately.</p>
              </div>

              <div className="border-t border-gray-200 pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-gray-700">Epic issue type fields</div>
                    <p className="text-[11px] text-gray-400">Inspect what fields Jira expects on a new Epic in the OKR project.</p>
                  </div>
                  <button
                    onClick={loadEpicFields}
                    disabled={jiraLoadingFields || !jiraProjectKey}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    {jiraLoadingFields ? 'Loading…' : 'Fetch Epic fields'}
                  </button>
                </div>
                {jiraEpicMeta && (
                  <div className="mt-2 text-xs text-gray-600">
                    Project: <span className="font-medium text-gray-800">{jiraEpicMeta.project?.name}</span>
                    {jiraEpicMeta.issueType && <> · Issue type: <span className="font-medium text-gray-800">{jiraEpicMeta.issueType.name}</span> (id {jiraEpicMeta.issueType.id})</>}
                  </div>
                )}
                {jiraEpicFields.length > 0 && (() => {
                  const selectedField = jiraEpicFields.find(f => f.key === periodFieldKey);
                  return (
                    <div className="mt-3 mb-2 border border-gray-200 rounded p-2 bg-gray-50">
                      <div className="text-xs font-semibold text-gray-700 mb-1">Map Period → Jira field</div>
                      <p className="text-[11px] text-gray-500 mb-2">When you create a Jira ticket, the objective's period value will be sent in this Jira field.</p>
                      <div className="mb-2">
                        <label className="block text-xs text-gray-500 mb-1">Period field</label>
                        {(() => {
                          const q = periodFieldSearch.trim().toLowerCase();
                          const filtered = q
                            ? jiraEpicFields.filter(f => f.name.toLowerCase().includes(q) || f.key.toLowerCase().includes(q))
                            : jiraEpicFields;
                          const exact = q && filtered.some(f => f.name.toLowerCase() === q);
                          const selected = jiraEpicFields.find(f => f.key === periodFieldKey);
                          const handleCreate = async () => {
                            const name = periodFieldSearch.trim();
                            if (!name) return;
                            if (creatingPeriodField) return;
                            if (!window.confirm(`Create a new Jira custom field "${name}" with options for every active app period?`)) return;
                            setCreatingPeriodField(true);
                            setJiraError(null);
                            try {
                              const res = await fetch(`${API_URL}/api/admin/jira/create-period-field`, {
                                method: 'POST',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ name }),
                              });
                              if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(t || `HTTP ${res.status}`); }
                              const data = await res.json();
                              if (data.warnings && data.warnings.length > 0) {
                                window.alert(`Created field "${data.fieldName}", but:\n\n${data.warnings.join('\n')}`);
                              } else {
                                window.alert(`Created field "${data.fieldName}" and attached to ${data.attachedScreens} Epic screen(s).`);
                              }
                              setPeriodFieldKey(data.fieldId);
                              setPeriodValueMap(data.periodValueMap || {});
                              setPeriodFieldSearch('');
                              setPeriodFieldMenuOpen(false);
                              await loadEpicFields();
                            } catch (err) {
                              setJiraError(String(err));
                            } finally {
                              setCreatingPeriodField(false);
                            }
                          };
                          return (
                            <div className="relative">
                              <input
                                type="text"
                                value={periodFieldMenuOpen ? periodFieldSearch : (selected ? `${selected.name} (${selected.key})` : '')}
                                onFocus={() => { setPeriodFieldMenuOpen(true); setPeriodFieldSearch(''); }}
                                onChange={(e) => { setPeriodFieldSearch(e.target.value); setPeriodFieldMenuOpen(true); }}
                                placeholder="— None (don't set) —"
                                className="w-full text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              {periodFieldKey && !periodFieldMenuOpen && (
                                <button
                                  type="button"
                                  onClick={() => { setPeriodFieldKey(''); saveJiraConfig({ periodFieldKey: '' }); }}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs"
                                  title="Clear"
                                >
                                  ✕
                                </button>
                              )}
                              {periodFieldMenuOpen && (
                                <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded shadow-lg max-h-60 overflow-y-auto">
                                  <button
                                    type="button"
                                    onClick={() => { setPeriodFieldKey(''); saveJiraConfig({ periodFieldKey: '' }); setPeriodFieldMenuOpen(false); }}
                                    className="w-full text-left px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 border-b border-gray-100"
                                  >
                                    — None (don't set) —
                                  </button>
                                  {filtered.length === 0 ? (
                                    <div className="px-2 py-2 text-xs text-gray-400">No matching fields.</div>
                                  ) : filtered.slice(0, 30).map(f => (
                                    <button
                                      key={f.key}
                                      type="button"
                                      onClick={() => { setPeriodFieldKey(f.key); saveJiraConfig({ periodFieldKey: f.key }); setPeriodFieldMenuOpen(false); setPeriodFieldSearch(''); }}
                                      className={`w-full text-left px-2 py-1.5 text-xs hover:bg-gray-50 ${f.key === periodFieldKey ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                                    >
                                      {f.name} <span className="text-gray-400">({f.key})</span>
                                    </button>
                                  ))}
                                  {q && !exact && (
                                    <button
                                      type="button"
                                      onClick={handleCreate}
                                      disabled={creatingPeriodField}
                                      className="w-full text-left px-2 py-1.5 text-xs text-blue-700 hover:bg-blue-50 border-t border-gray-100 disabled:opacity-50"
                                    >
                                      {creatingPeriodField ? 'Creating…' : `+ Create new field "${periodFieldSearch.trim()}" (dropdown of active periods)`}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      {periodFieldKey && (
                        <div className="border border-gray-200 rounded bg-white max-h-48 overflow-y-auto">
                          <table className="min-w-full text-xs">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">App period</th>
                                <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">→ Jira value</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {[...periodsAll].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '')).map(p => {
                                const mapped = periodValueMap[p.id];
                                const mappedStr = typeof mapped === 'string' ? mapped : (mapped && (mapped.value || mapped.id)) || '';
                                const commit = (val: string | { id?: string; value?: string }) => {
                                  const next = { ...periodValueMap, [p.id]: val };
                                  setPeriodValueMap(next);
                                  saveJiraConfig({ periodValueMap: next });
                                };
                                return (
                                  <tr key={p.id}>
                                    <td className="px-2 py-1 text-gray-800">{p.name}</td>
                                    <td className="px-2 py-1">
                                      {selectedField?.allowedValues && selectedField.allowedValues.length > 0 ? (
                                        <select
                                          value={typeof mapped === 'object' ? (mapped.id || '') : ''}
                                          onChange={(e) => {
                                            const id = e.target.value;
                                            if (!id) { const { [p.id]: _drop, ...rest } = periodValueMap; void _drop; setPeriodValueMap(rest); saveJiraConfig({ periodValueMap: rest }); return; }
                                            const av = selectedField.allowedValues!.find(v => v.id === id);
                                            commit(av ? { id: av.id, value: av.value || av.name } : { id });
                                          }}
                                          className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white"
                                        >
                                          <option value="">— Use period name —</option>
                                          {selectedField.allowedValues.map(v => <option key={v.id || v.value} value={v.id || ''}>{v.name || v.value || v.key}</option>)}
                                        </select>
                                      ) : (
                                        <input
                                          type="text"
                                          defaultValue={mappedStr}
                                          onBlur={(e) => {
                                            const v = e.target.value;
                                            if (v.trim() === '') { const { [p.id]: _drop, ...rest } = periodValueMap; void _drop; setPeriodValueMap(rest); saveJiraConfig({ periodValueMap: rest }); }
                                            else commit(v);
                                          }}
                                          placeholder={`(default: ${p.name})`}
                                          className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white w-full"
                                        />
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {jiraEpicFields.length > 0 && (
                  <div className="mt-2 border border-gray-200 rounded max-h-72 overflow-y-auto">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Field</th>
                          <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Key</th>
                          <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Type</th>
                          <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Req</th>
                          <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Allowed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {jiraEpicFields.map(f => (
                          <tr key={f.key} className="hover:bg-gray-50">
                            <td className="px-2 py-1 text-gray-800">{f.name}</td>
                            <td className="px-2 py-1 text-gray-500 font-mono">{f.key}</td>
                            <td className="px-2 py-1 text-gray-500">{f.schema?.type || '—'}{f.schema?.custom ? ` (${f.schema.custom.split(':').pop()})` : ''}</td>
                            <td className="px-2 py-1">{f.required ? <span className="text-amber-700">yes</span> : <span className="text-gray-400">no</span>}</td>
                            <td className="px-2 py-1 text-gray-500">
                              {f.allowedValues && f.allowedValues.length > 0
                                ? <span title={f.allowedValues.map(v => v.name || v.value || v.key).join(', ')}>{f.allowedValues.length} options</span>
                                : <span className="text-gray-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {jiraError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2 whitespace-pre-wrap">{jiraError}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
