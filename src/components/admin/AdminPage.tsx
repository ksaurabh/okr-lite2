import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { useOKRStore, type BackupData, type BackupUser, type BackupOrganization, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { OrganizationManagement } from './OrganizationManagement';

const API_URL = import.meta.env.VITE_API_URL || '';

export function AdminPage() {
  const { isSuperAdmin } = useAuth();
  const [newDomain, setNewDomain] = useState('');
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Backup/Restore state
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [pendingImportData, setPendingImportData] = useState<BackupData | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [usersCount, setUsersCount] = useState<number>(0);
  const [orgsCount, setOrgsCount] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportData = useOKRStore((state: OKRStore) => state.exportData);
  const importData = useOKRStore((state: OKRStore) => state.importData);
  const objectives = useOKRStore((state: OKRStore) => state.objectives);
  const keyResults = useOKRStore((state: OKRStore) => state.keyResults);
  const teams = useOKRStore((state: OKRStore) => state.teams);
  const periods = useOKRStore((state: OKRStore) => state.periods);
  const tags = useOKRStore((state: OKRStore) => state.tags);

  const fetchDomains = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/domains`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch domains');
      const data = await response.json();
      setAllowedDomains(data.domains);
      setError(null);
    } catch (err) {
      setError('Failed to load domains');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDomains();
  }, [fetchDomains]);

  // Fetch users and organizations counts for export summary
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const [usersRes, orgsRes] = await Promise.all([
          fetch(`${API_URL}/api/users`, { credentials: 'include' }),
          fetch(`${API_URL}/api/organizations`, { credentials: 'include' }),
        ]);
        if (usersRes.ok) {
          const data = await usersRes.json();
          setUsersCount(data.users?.length || 0);
        }
        if (orgsRes.ok) {
          const data = await orgsRes.json();
          setOrgsCount(data.organizations?.length || 0);
        }
      } catch (err) {
        console.error('Failed to fetch counts:', err);
      }
    };
    fetchCounts();
  }, []);

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomain.trim()) return;

    try {
      const response = await fetch(`${API_URL}/api/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ domain: newDomain }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to add domain');
      }
      const data = await response.json();
      setAllowedDomains(data.domains);
      setNewDomain('');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add domain');
    }
  };

  const handleDeleteDomain = async (domain: string) => {
    try {
      const response = await fetch(`${API_URL}/api/domains/${encodeURIComponent(domain)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete domain');
      const data = await response.json();
      setAllowedDomains(data.domains);
      setError(null);
    } catch (err) {
      setError('Failed to delete domain');
      console.error(err);
    }
  };

  const handleExport = async () => {
    const data = exportData();

    // Fetch users and organizations for the backup
    try {
      const [usersResponse, orgsResponse] = await Promise.all([
        fetch(`${API_URL}/api/users`, { credentials: 'include' }),
        fetch(`${API_URL}/api/organizations`, { credentials: 'include' }),
      ]);

      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        // Strip sensitive fields and normalize for backup
        data.users = (usersData.users || []).map((u: BackupUser & { organizationName?: string }) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          picture: u.picture,
          domain: u.domain,
          organizationId: u.organizationId,
          role: u.role,
          createdAt: u.createdAt,
          lastLoginAt: u.lastLoginAt,
        }));
      }

      if (orgsResponse.ok) {
        const orgsData = await orgsResponse.json();
        // Strip sensitive invite tokens from backup
        data.organizations = (orgsData.organizations || []).map((org: BackupOrganization & { admins: Array<{ email: string; status: string; inviteToken?: string }> }) => ({
          id: org.id,
          name: org.name,
          domain: org.domain,
          admins: (org.admins || []).map(a => ({ email: a.email, status: a.status })),
          createdAt: org.createdAt,
          updatedAt: org.updatedAt,
        }));
      }
    } catch (err) {
      console.error('Failed to fetch users/organizations for backup:', err);
      // Continue with OKR data only
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `okr-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string) as BackupData;

        // Validate the data structure
        if (!data.objectives || !data.keyResults || !data.teams || !data.periods || !data.tags) {
          throw new Error('Invalid backup file format');
        }

        setPendingImportData(data);
        setShowImportConfirm(true);
        setImportError(null);
      } catch (err) {
        setImportError('Invalid backup file. Please select a valid OKR backup JSON file.');
      }
    };
    reader.readAsText(file);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (pendingImportData) {
      try {
        // Import OKR data to server first
        await fetch(`${API_URL}/api/import/okr`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            objectives: pendingImportData.objectives,
            keyResults: pendingImportData.keyResults,
            teams: pendingImportData.teams,
            periods: pendingImportData.periods,
            tags: pendingImportData.tags,
          }),
        });

        // Import users and organizations via API (if present)
        if (pendingImportData.organizations && pendingImportData.organizations.length > 0) {
          await fetch(`${API_URL}/api/import/organizations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ organizations: pendingImportData.organizations }),
          });
        }

        if (pendingImportData.users && pendingImportData.users.length > 0) {
          await fetch(`${API_URL}/api/import/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ users: pendingImportData.users }),
          });
        }

        // Update local store after server sync
        importData(pendingImportData);
      } catch (err) {
        console.error('Failed to import data:', err);
      }

      setShowImportConfirm(false);
      setPendingImportData(null);
    }
  };

  const handleCancelImport = () => {
    setShowImportConfirm(false);
    setPendingImportData(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Super Admin</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage organizations and allowed domains
        </p>
      </div>

      {/* Organizations Section - Super Admin Only */}
      {isSuperAdmin && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <OrganizationManagement />
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Allowed Domains</h2>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleAddDomain} className="flex gap-2 mb-6">
          <input
            type="text"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="Enter domain (e.g., example.com)"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <Button type="submit" disabled={!newDomain.trim()}>
            Add Domain
          </Button>
        </form>

        {isLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-sm text-gray-500">Loading domains...</p>
          </div>
        ) : allowedDomains.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            <p className="mt-2 text-sm">No allowed domains configured</p>
            <p className="text-xs text-gray-400">Add domains to restrict access</p>
          </div>
        ) : (
          <div className="space-y-2">
            {allowedDomains.map((domain) => (
              <div
                key={domain}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                  <span className="text-sm font-medium text-gray-700">{domain}</span>
                </div>
                <button
                  onClick={() => handleDeleteDomain(domain)}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                  title="Delete domain"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-gray-200">
          <p className="text-xs text-gray-500">
            Total domains: {allowedDomains.length}
          </p>
        </div>
      </div>

      {/* Backup & Restore Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Backup & Restore</h2>

        {importError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {importError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Export */}
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">Export Backup</h3>
                <p className="text-xs text-gray-500">Download all data as JSON</p>
              </div>
            </div>
            <div className="text-xs text-gray-600 mb-3 space-y-1">
              <p>Current data:</p>
              <ul className="list-disc list-inside text-gray-500">
                <li>{objectives.length} objectives</li>
                <li>{keyResults.length} key results</li>
                <li>{teams.length} teams</li>
                <li>{periods.length} periods</li>
                <li>{tags.length} tags</li>
                <li>{usersCount} users</li>
                <li>{orgsCount} organizations</li>
              </ul>
            </div>
            <Button onClick={handleExport} className="w-full">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download Backup
            </Button>
          </div>

          {/* Import */}
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">Restore from Backup</h3>
                <p className="text-xs text-gray-500">Upload a backup JSON file</p>
              </div>
            </div>
            <p className="text-xs text-gray-600 mb-3">
              Select a previously exported backup file to restore your data.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              className="w-full"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Select Backup File
            </Button>
          </div>
        </div>
      </div>

      {/* Import Confirmation Modal */}
      <Modal
        isOpen={showImportConfirm}
        onClose={handleCancelImport}
        title="Confirm Restore"
      >
        <div className="space-y-4">
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex gap-3">
              <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h4 className="font-medium text-yellow-800">Warning: This will overwrite existing data</h4>
                <p className="text-sm text-yellow-700 mt-1">
                  All current objectives, key results, teams, periods, and tags will be replaced with the data from the backup file.
                </p>
              </div>
            </div>
          </div>

          {pendingImportData && (
            <div className="text-sm text-gray-600">
              <p className="font-medium mb-2">Backup file contains:</p>
              <ul className="list-disc list-inside text-gray-500 space-y-1">
                <li>{pendingImportData.objectives.length} objectives</li>
                <li>{pendingImportData.keyResults.length} key results</li>
                <li>{pendingImportData.teams.length} teams</li>
                <li>{pendingImportData.periods.length} periods</li>
                <li>{pendingImportData.tags.length} tags</li>
                {pendingImportData.users && <li>{pendingImportData.users.length} users</li>}
                {pendingImportData.organizations && <li>{pendingImportData.organizations.length} organizations</li>}
              </ul>
              {pendingImportData.exportedAt && (
                <p className="mt-2 text-xs text-gray-400">
                  Exported: {new Date(pendingImportData.exportedAt).toLocaleString()}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <Button variant="secondary" onClick={handleCancelImport}>
              Cancel
            </Button>
            <Button onClick={handleConfirmImport}>
              Yes, Restore Data
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
