import { useState, useEffect, useCallback } from 'react';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import type { Organization, OrganizationAdmin } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';

export function OrganizationManagement() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create org modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgDomain, setNewOrgDomain] = useState('');

  // Add admin modal
  const [showAddAdminModal, setShowAddAdminModal] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [newAdminEmail, setNewAdminEmail] = useState('');

  // Invite link modal
  const [showInviteLinkModal, setShowInviteLinkModal] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  const fetchOrganizations = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/organizations`, {
        credentials: 'include',
      });
      if (!response.ok) {
        if (response.status === 403) {
          setError('Super admin access required');
          return;
        }
        throw new Error('Failed to fetch organizations');
      }
      const data = await response.json();
      setOrganizations(data.organizations);
      setError(null);
    } catch (err) {
      setError('Failed to load organizations');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim() || !newOrgDomain.trim()) return;

    try {
      const response = await fetch(`${API_URL}/api/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newOrgName, domain: newOrgDomain }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create organization');
      }
      await fetchOrganizations();
      setNewOrgName('');
      setNewOrgDomain('');
      setShowCreateModal(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization');
    }
  };

  const handleDeleteOrg = async (org: Organization) => {
    if (!confirm(`Delete organization "${org.name}"? This will remove the domain from allowed list.`)) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/organizations/${org.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete organization');
      await fetchOrganizations();
      setError(null);
    } catch (err) {
      setError('Failed to delete organization');
      console.error(err);
    }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrg || !newAdminEmail.trim()) return;

    try {
      const response = await fetch(`${API_URL}/api/organizations/${selectedOrg.id}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: newAdminEmail }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to add admin');
      }
      await fetchOrganizations();
      setNewAdminEmail('');
      setShowAddAdminModal(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add admin');
    }
  };

  const handleRemoveAdmin = async (org: Organization, admin: OrganizationAdmin) => {
    if (!confirm(`Remove admin "${admin.email}" from ${org.name}?`)) {
      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/api/organizations/${org.id}/admins/${encodeURIComponent(admin.email)}`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      );
      if (!response.ok) throw new Error('Failed to remove admin');
      await fetchOrganizations();
      setError(null);
    } catch (err) {
      setError('Failed to remove admin');
      console.error(err);
    }
  };

  const handleGetInviteLink = async (org: Organization, admin: OrganizationAdmin) => {
    try {
      const response = await fetch(
        `${API_URL}/api/organizations/${org.id}/invite-link/${encodeURIComponent(admin.email)}`,
        {
          credentials: 'include',
        }
      );
      if (!response.ok) throw new Error('Failed to get invite link');
      const data = await response.json();
      setInviteLink(data.inviteLink);
      setShowInviteLinkModal(true);
      setCopiedLink(false);
    } catch (err) {
      setError('Failed to get invite link');
      console.error(err);
    }
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const getStatusBadge = (status: string) => {
    if (status === 'accepted') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
          Accepted
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
        Pending Invite
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-2 text-sm text-gray-500">Loading organizations...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900">Organizations</h2>
        <Button onClick={() => setShowCreateModal(true)}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Create Organization
        </Button>
      </div>

      {organizations.length === 0 ? (
        <div className="text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <p className="mt-2 text-sm text-gray-600">No organizations yet</p>
          <p className="text-xs text-gray-400">Create your first organization to get started</p>
        </div>
      ) : (
        <div className="space-y-4">
          {organizations.map((org) => (
            <div
              key={org.id}
              className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
            >
              <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">{org.name}</h3>
                  <p className="text-sm text-gray-500">Domain: {org.domain}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSelectedOrg(org);
                      setShowAddAdminModal(true);
                    }}
                  >
                    Add Admin
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => handleDeleteOrg(org)}>
                    Delete
                  </Button>
                </div>
              </div>

              <div className="p-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Administrators</h4>
                {org.admins.length === 0 ? (
                  <p className="text-sm text-gray-500">No administrators yet</p>
                ) : (
                  <div className="space-y-2">
                    {org.admins.map((admin) => (
                      <div
                        key={admin.email}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{admin.email}</p>
                            <p className="text-xs text-gray-500">
                              Invited {new Date(admin.inviteCreatedAt).toLocaleDateString()}
                            </p>
                          </div>
                          {getStatusBadge(admin.status)}
                        </div>
                        <div className="flex gap-2">
                          {admin.status === 'pending' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleGetInviteLink(org, admin)}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                              </svg>
                              Copy Link
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveAdmin(org, admin)}
                          >
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Organization Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Organization"
      >
        <form onSubmit={handleCreateOrg} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Organization Name
            </label>
            <input
              type="text"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="e.g., AirMDR"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Domain
            </label>
            <input
              type="text"
              value={newOrgDomain}
              onChange={(e) => setNewOrgDomain(e.target.value)}
              placeholder="e.g., airmdr.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Users with this email domain will be automatically assigned to this organization.
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button type="submit">Create</Button>
          </div>
        </form>
      </Modal>

      {/* Add Admin Modal */}
      <Modal
        isOpen={showAddAdminModal}
        onClose={() => {
          setShowAddAdminModal(false);
          setSelectedOrg(null);
          setNewAdminEmail('');
        }}
        title={`Add Admin to ${selectedOrg?.name}`}
      >
        <form onSubmit={handleAddAdmin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Admin Email
            </label>
            <input
              type="email"
              value={newAdminEmail}
              onChange={(e) => setNewAdminEmail(e.target.value)}
              placeholder="admin@example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              An invite link will be generated that you can share with this person.
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowAddAdminModal(false);
                setSelectedOrg(null);
                setNewAdminEmail('');
              }}
            >
              Cancel
            </Button>
            <Button type="submit">Add Admin</Button>
          </div>
        </form>
      </Modal>

      {/* Invite Link Modal */}
      <Modal
        isOpen={showInviteLinkModal}
        onClose={() => setShowInviteLinkModal(false)}
        title="Admin Invite Link"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Share this link with the admin to accept the invitation:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={inviteLink}
              readOnly
              className="flex-1 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm"
            />
            <Button onClick={copyInviteLink}>
              {copiedLink ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <div className="flex justify-end pt-4">
            <Button variant="secondary" onClick={() => setShowInviteLinkModal(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
