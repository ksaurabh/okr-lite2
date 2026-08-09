import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { UserGroupsSettings } from './UserGroupsSettings';

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

// Saved field mappings: project key -> Jira field name -> field id.
type FieldMapByProject = Record<string, Record<string, string>>;

// One field on the site that could answer to the name we asked about, and what
// it holds on the inspected issue.
interface FieldCandidate {
  id: string;
  name: string;
  match: 'exact' | 'alias' | 'partial' | 'mapped';
  type: string;
  custom: string;
  onIssue: boolean;
  hasValue: boolean;
  valueText: string;
  isPicked: boolean;
  isMapped: boolean;
}

interface FieldDebug {
  issue: { key: string; summary: string; type: string; projectKey: string; url: string };
  name: string;
  pickedFieldId: string | null;
  pickedFrom: 'mapping' | 'name-match' | 'none';
  mappedFieldId: string | null;
  candidates: FieldCandidate[];
}

// One member of the engineering org chart, with their weekly-check settings.
interface WeeklyMember {
  userId: string;
  name: string;
  email: string;
  department: string;
  included: boolean;
  jiraAccountId: string | null;
  jiraName: string | null;
  expectedSp: number | null;              // null = inherit the team default
  maxTicketSize: number | null;           // null = inherit the team default
  effectiveExpectedSp: number;
  effectiveMaxTicketSize: number;
}

interface WeeklyConfig { rootDepartment: string; expectedSp: number; maxTicketSize: number; thresholdPct: number; }

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
  // Field mapping: pin a Jira field name to a field id per project, so a site
  // with several same-named fields reads the right one. See FieldDebug below.
  const [fieldMap, setFieldMap] = useState<FieldMapByProject>({});
  const [fdIssue, setFdIssue] = useState('');
  const [fdName, setFdName] = useState('Story Points');
  const [fdLoading, setFdLoading] = useState(false);
  const [fdResult, setFdResult] = useState<FieldDebug | null>(null);
  const [fdSavingId, setFdSavingId] = useState<string | null>(null);

  // Weekly engineering check: expected story points per person, the flag threshold,
  // and per-member include/exclude + Jira identity.
  const [wcOpen, setWcOpen] = useState(true);
  const [wcConfig, setWcConfig] = useState<WeeklyConfig | null>(null);
  const [wcMembers, setWcMembers] = useState<WeeklyMember[]>([]);
  const [wcDepartments, setWcDepartments] = useState<string[]>([]);
  const [wcExpected, setWcExpected] = useState('');
  const [wcMaxSize, setWcMaxSize] = useState('');
  const [wcThreshold, setWcThreshold] = useState('');
  const wcRef = useRef<HTMLDivElement>(null);
  const [wcSaving, setWcSaving] = useState(false);
  const [wcSaved, setWcSaved] = useState(false);
  const [wcError, setWcError] = useState<string | null>(null);
  const [wcJiraUsers, setWcJiraUsers] = useState<Array<{ accountId: string; displayName: string }>>([]);
  const [wcPickerFor, setWcPickerFor] = useState<string | null>(null);
  const [wcPickerSearch, setWcPickerSearch] = useState('');

  const loadWeeklyCheck = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/weekly-check`, { credentials: 'include' });
      if (!res.ok) return;
      const d = await res.json();
      setWcConfig(d.config);
      setWcMembers(d.members || []);
      setWcDepartments(d.departments || []);
      setWcExpected(String(d.config?.expectedSp ?? ''));
      setWcMaxSize(String(d.config?.maxTicketSize ?? ''));
      setWcThreshold(String(d.config?.thresholdPct ?? ''));
    } catch { /* ignore */ }
  }, []);

  // Arriving from the report's "set expectations" link (/settings#weekly-check):
  // open this section and scroll to it.
  useEffect(() => {
    if (window.location.hash !== '#weekly-check') return;
    setWcOpen(true);
    const t = setTimeout(() => wcRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    return () => clearTimeout(t);
  }, [wcMembers.length]);

  const saveWeeklyConfig = async (patch: { expectedSp?: number; maxTicketSize?: number; thresholdPct?: number }) => {
    setWcSaving(true); setWcError(null); setWcSaved(false);
    try {
      const res = await fetch(`${API_URL}/api/admin/weekly-check`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`);
      setWcConfig(d.config);
      setWcMembers(d.members || []);
      setWcSaved(true);
      setTimeout(() => setWcSaved(false), 2000);
    } catch (err) {
      setWcError(err instanceof Error ? err.message : String(err));
    } finally {
      setWcSaving(false);
    }
  };

  const saveWeeklyMember = async (userId: string, patch: { included?: boolean; jiraAccountId?: string | null; jiraName?: string | null; expectedSp?: number | null; maxTicketSize?: number | null }) => {
    setWcError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/weekly-check/member`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...patch }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`);
      setWcMembers(d.members || []);
    } catch (err) {
      setWcError(err instanceof Error ? err.message : String(err));
    }
  };

  // Jira accounts for the "link this person to Jira" picker.
  const searchJiraUsers = async (query: string) => {
    try {
      const res = await fetch(`${API_URL}/api/admin/jira/users?query=${encodeURIComponent(query)}`, { credentials: 'include' });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`);
      setWcJiraUsers(d.users || []);
    } catch (err) {
      setWcError(err instanceof Error ? err.message : String(err));
      setWcJiraUsers([]);
    }
  };

  const inspectField = async () => {
    const issue = fdIssue.trim();
    const name = fdName.trim();
    if (!issue || !name) return;
    setFdLoading(true); setJiraError(null); setFdResult(null);
    try {
      const qs = `issue=${encodeURIComponent(issue)}&name=${encodeURIComponent(name)}`;
      const res = await fetch(`${API_URL}/api/admin/jira/field-debug?${qs}`, { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setFdResult(data);
    } catch (err) {
      setJiraError(err instanceof Error ? err.message : String(err));
    } finally {
      setFdLoading(false);
    }
  };

  // fieldId '' clears the mapping for (project, name) and falls back to name matching.
  const saveFieldMapping = async (project: string, name: string, fieldId: string) => {
    setFdSavingId(fieldId || `clear:${project}:${name}`); setJiraError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/jira/field-map`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, name, fieldId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setFieldMap(data.fieldMapByProject || {});
      // Re-inspect so the "reads" line reflects the mapping we just saved.
      if (fdResult && fdResult.issue.projectKey === project && fdResult.name === name) await inspectField();
    } catch (err) {
      setJiraError(err instanceof Error ? err.message : String(err));
    } finally {
      setFdSavingId(null);
    }
  };

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
  const jiraFileInputRef = useRef<HTMLInputElement>(null);

  // ---- Plan stages ----
  const [planStages, setPlanStagesState] = useState<string[]>([]);
  const [planStagesOpen, setPlanStagesOpen] = useState(true);
  const [planStagesSaving, setPlanStagesSaving] = useState(false);
  const [planStagesError, setPlanStagesError] = useState<string | null>(null);
  const [planStagesSaved, setPlanStagesSaved] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/plan-stages`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { stages: [] }))
      .then(d => setPlanStagesState(d.stages || []))
      .catch(() => { /* ignore */ });
  }, []);

  const savePlanStages = async () => {
    setPlanStagesError(null); setPlanStagesSaved(false);
    const clean = planStages.map(s => s.trim()).filter(Boolean);
    if (clean.length === 0) { setPlanStagesError('Add at least one stage.'); return; }
    setPlanStagesSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/plan-stages`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages: clean }),
      });
      if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(t || `HTTP ${res.status}`); }
      const d = await res.json();
      setPlanStagesState(d.stages || clean);
      setPlanStagesSaved(true);
      setTimeout(() => setPlanStagesSaved(false), 2000);
    } catch (err) {
      setPlanStagesError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlanStagesSaving(false);
    }
  };

  const refreshJiraConfig = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/admin/jira-config`, { credentials: 'include' });
      const d = r.ok ? await r.json() : { config: null };
      const cfg = d?.config;
      if (cfg) {
        setJiraBaseUrl(cfg.baseUrl || '');
        setJiraEmail(cfg.email || '');
        setJiraProjectKey(cfg.projectKey || '');
        setJiraHasToken(!!cfg.hasToken);
        setPeriodFieldKey(cfg.periodFieldKey || '');
        setPeriodValueMap(cfg.periodValueMap || {});
        setFieldMap(cfg.fieldMapByProject || {});
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!(isSuperAdmin || isOrgAdmin)) return;
    refreshJiraConfig();
    loadWeeklyCheck();
  }, [isSuperAdmin, isOrgAdmin, refreshJiraConfig, loadWeeklyCheck]);

  // Download the org's Jira integration settings as a JSON file.
  const handleDownloadJira = async () => {
    setJiraError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/jira-config/export`, { credentials: 'include' });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(res.status === 404 ? 'No Jira settings saved yet.' : (t || `HTTP ${res.status}`));
      }
      const cfg = await res.json();
      const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'jira-integration-settings.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setJiraError(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Import Jira integration settings from an uploaded JSON file.
  const handleImportJiraFile = async (file: File) => {
    setJiraError(null); setJiraSaved(false);
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object') throw new Error('File is not a valid settings object.');
      const body: Record<string, unknown> = {};
      if (typeof parsed.baseUrl === 'string') body.baseUrl = parsed.baseUrl;
      if (typeof parsed.email === 'string') body.email = parsed.email;
      if (typeof parsed.apiToken === 'string') body.apiToken = parsed.apiToken;
      if (typeof parsed.projectKey === 'string') body.projectKey = parsed.projectKey;
      if (typeof parsed.epicIssueTypeId === 'string') body.epicIssueTypeId = parsed.epicIssueTypeId;
      if (typeof parsed.periodFieldKey === 'string') body.periodFieldKey = parsed.periodFieldKey;
      if (parsed.periodValueMap && typeof parsed.periodValueMap === 'object') body.periodValueMap = parsed.periodValueMap;
      if (Object.keys(body).length === 0) throw new Error('No recognizable Jira settings in this file.');
      setJiraSaving(true);
      const res = await fetch(`${API_URL}/api/admin/jira-config`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(t || `HTTP ${res.status}`); }
      await refreshJiraConfig();
      setJiraSaved(true);
      setTimeout(() => setJiraSaved(false), 2000);
    } catch (err) {
      setJiraError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setJiraSaving(false);
    }
  };

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

      {(isSuperAdmin || isOrgAdmin) && <UserGroupsSettings />}

      {(isSuperAdmin || isOrgAdmin) && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <button
            type="button"
            onClick={() => setPlanStagesOpen(!planStagesOpen)}
            className="w-full p-4 flex items-center justify-between hover:bg-gray-50"
          >
            <h2 className="text-base font-semibold text-gray-900">Plan stages</h2>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${planStagesOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {planStagesOpen && (
            <div className="p-4 border-t border-gray-200 space-y-3">
              <p className="text-xs text-gray-500">The stages a plan can be in. The first stage is the default for new plans; order defines the progression.</p>
              <div className="space-y-2">
                {planStages.map((stage, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-5 tabular-nums">{i + 1}.</span>
                    <input
                      type="text"
                      value={stage}
                      onChange={(e) => setPlanStagesState(prev => prev.map((s, idx) => (idx === i ? e.target.value : s)))}
                      className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm"
                    />
                    <button type="button" disabled={i === 0} onClick={() => setPlanStagesState(prev => { const a = [...prev]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a; })} className="px-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move up">↑</button>
                    <button type="button" disabled={i === planStages.length - 1} onClick={() => setPlanStagesState(prev => { const a = [...prev]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; return a; })} className="px-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move down">↓</button>
                    <button type="button" onClick={() => setPlanStagesState(prev => prev.filter((_, idx) => idx !== i))} className="px-1.5 text-gray-400 hover:text-red-600" title="Remove">✕</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={() => setPlanStagesState(prev => [...prev, ''])} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">+ Add stage</button>
                <button type="button" onClick={() => setPlanStagesState(['New', 'In Review', 'In Execution', 'In Retrospective', 'Closed', 'Archived'])} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">Reset to defaults</button>
                <button type="button" onClick={savePlanStages} disabled={planStagesSaving} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">{planStagesSaving ? 'Saving…' : 'Save stages'}</button>
                {planStagesSaved && <span className="text-xs text-green-700">Saved.</span>}
                {planStagesError && <span className="text-xs text-red-600">{planStagesError}</span>}
              </div>
            </div>
          )}
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
                <span className="mx-1 h-5 w-px bg-gray-200" />
                <button onClick={handleDownloadJira} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50" title="Download these Jira settings as a JSON file (includes the API token)">
                  Download JSON
                </button>
                <button onClick={() => jiraFileInputRef.current?.click()} disabled={jiraSaving} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50" title="Import Jira settings from a JSON file">
                  Import JSON
                </button>
                <input
                  ref={jiraFileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportJiraFile(f); e.target.value = ''; }}
                />
                {jiraSaved && <span className="text-xs text-green-700">Saved.</span>}
              </div>
              <p className="text-[11px] text-gray-400">The downloaded file contains your Jira API token — store it securely. Importing overwrites the fields present in the file.</p>
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

              <div className="border-t border-gray-200 pt-3">
                <div className="text-xs font-semibold text-gray-700">Field mapping</div>
                <p className="text-[11px] text-gray-400 mb-2">
                  Jira's field list is site-wide, so several custom fields can share one name — a site can hold three fields called "Story Points", each on a different project's screens. Without a mapping the app reads whichever Jira lists first, which may be empty on this project's issues. Inspect a real ticket to see what each candidate actually holds, then pin the right field for that project.
                </p>
                <div className="flex items-end gap-2">
                  <div className="w-40">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Issue key</label>
                    <input
                      type="text"
                      value={fdIssue}
                      onChange={(e) => setFdIssue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') inspectField(); }}
                      placeholder="DEV-12207"
                      className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Field name</label>
                    <input
                      type="text"
                      value={fdName}
                      onChange={(e) => setFdName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') inspectField(); }}
                      placeholder="Story Points"
                      className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                    />
                  </div>
                  <button
                    onClick={inspectField}
                    disabled={fdLoading || !fdIssue.trim() || !fdName.trim()}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    {fdLoading ? 'Inspecting…' : 'Inspect'}
                  </button>
                </div>

                {fdResult && (() => {
                  const picked = fdResult.candidates.find(c => c.isPicked) || null;
                  const project = fdResult.issue.projectKey;
                  // The pick is suspect when it reads nothing but another candidate holds a value.
                  const suspect = !!picked && !picked.hasValue && fdResult.candidates.some(c => !c.isPicked && c.hasValue);
                  return (
                    <div className="mt-3 border border-gray-200 rounded">
                      <div className="px-2 py-2 bg-gray-50 border-b border-gray-200 text-xs">
                        <a href={fdResult.issue.url} target="_blank" rel="noreferrer" className="font-medium text-blue-700 hover:underline">{fdResult.issue.key}</a>
                        <span className="text-gray-700"> {fdResult.issue.summary}</span>
                        <span className="text-gray-400"> · {fdResult.issue.type} · project <span className="font-mono">{project}</span></span>
                      </div>
                      <div className={`px-2 py-2 text-xs border-b border-gray-200 ${suspect ? 'bg-amber-50 text-amber-900' : 'text-gray-700'}`}>
                        {picked ? (
                          <>
                            Reads <span className="font-mono font-medium">{picked.id}</span> ({picked.name}) — {fdResult.pickedFrom === 'mapping' ? 'your saved mapping' : 'first name match, no mapping saved'} — value on this issue: <span className="font-medium">{picked.valueText}</span>.
                            {suspect && <> This field is empty here while another candidate below has a value, so <span className="font-medium">{fdResult.name}</span> is likely showing as 0 across {project}. Pin the right field below.</>}
                          </>
                        ) : (
                          <>No field on this site matches "{fdResult.name}" — the app reads nothing and shows 0.</>
                        )}
                      </div>
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Field id</th>
                            <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Name</th>
                            <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Match</th>
                            <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Value on {fdResult.issue.key}</th>
                            <th className="text-right px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Use for {project}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {fdResult.candidates.map(c => (
                            <tr key={c.id} className={c.isPicked ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                              <td className="px-2 py-1 font-mono text-gray-700">{c.id}</td>
                              <td className="px-2 py-1 text-gray-800">
                                {c.name}
                                {c.isPicked && <span className="ml-1 text-[10px] text-blue-700 font-medium">(in use)</span>}
                                {c.custom && <span className="ml-1 text-gray-400">· {c.custom}</span>}
                              </td>
                              <td className="px-2 py-1 text-gray-500">{c.match}</td>
                              <td className={`px-2 py-1 ${c.hasValue ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>{c.valueText}</td>
                              <td className="px-2 py-1 text-right">
                                {c.isMapped ? (
                                  <button
                                    onClick={() => saveFieldMapping(project, fdResult.name, '')}
                                    disabled={fdSavingId !== null}
                                    className="px-2 py-0.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                                    title="Remove the mapping and fall back to matching by name"
                                  >
                                    Mapped — clear
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => saveFieldMapping(project, fdResult.name, c.id)}
                                    disabled={fdSavingId !== null}
                                    className="px-2 py-0.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                                  >
                                    {fdSavingId === c.id ? 'Saving…' : 'Use this'}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {Object.keys(fieldMap).length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-600 mb-1">Saved mappings</div>
                    <div className="border border-gray-200 rounded">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Project</th>
                            <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Field name</th>
                            <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Field id</th>
                            <th className="text-right px-2 py-1"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {Object.entries(fieldMap).flatMap(([project, names]) =>
                            Object.entries(names).map(([name, id]) => (
                              <tr key={`${project}:${name}`} className="hover:bg-gray-50">
                                <td className="px-2 py-1 font-mono text-gray-700">{project}</td>
                                <td className="px-2 py-1 text-gray-800">{name}</td>
                                <td className="px-2 py-1 font-mono text-gray-700">{id}</td>
                                <td className="px-2 py-1 text-right">
                                  <button
                                    onClick={() => saveFieldMapping(project, name, '')}
                                    disabled={fdSavingId !== null}
                                    className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                                    title="Clear this mapping"
                                  >
                                    ✕
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">Used wherever the app reads that field for that project — story points in the Agent's release and weekly views.</p>
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

      {(isSuperAdmin || isOrgAdmin) && (
        <div id="weekly-check" ref={wcRef} className="bg-white rounded-lg shadow-sm border border-gray-200 scroll-mt-4">
          <button
            onClick={() => setWcOpen(!wcOpen)}
            className="w-full p-4 flex items-center justify-between hover:bg-gray-50"
          >
            <h2 className="text-base font-semibold text-gray-900">Weekly engineering check</h2>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${wcOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {wcOpen && (
            <div className="p-4 border-t border-gray-200 space-y-3">
              <p className="text-xs text-gray-500">
                The Agent's weekly report shows each engineer's resolved story points against an expected target, and flags anyone below a percentage of it.
                {wcConfig && wcDepartments.length > 0 && (
                  <> Members come from the org chart — <span className="font-medium text-gray-700">{wcConfig.rootDepartment}</span> and everything under it ({wcDepartments.slice(1).join(', ') || 'no sub-departments'}) — currently {wcMembers.length} {wcMembers.length === 1 ? 'person' : 'people'}.</>
                )}
              </p>

              <div className="text-xs font-semibold text-gray-700">Team defaults</div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Story points expected last 7d per person</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={wcExpected}
                    onChange={(e) => setWcExpected(e.target.value)}
                    onBlur={() => { const n = Number(wcExpected); if (Number.isFinite(n) && n >= 0 && n !== wcConfig?.expectedSp) saveWeeklyConfig({ expectedSp: n }); }}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Scaled to the report window — a 14-day report expects twice this.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Max ticket size</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={wcMaxSize}
                    onChange={(e) => setWcMaxSize(e.target.value)}
                    onBlur={() => { const n = Number(wcMaxSize); if (Number.isFinite(n) && n >= 0 && n !== wcConfig?.maxTicketSize) saveWeeklyConfig({ maxTicketSize: n }); }}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">A ceiling, not a target: any resolved ticket worth more than this is counted in the oversized-tickets report. Epics don't count.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Flag anyone below this % of expected story points</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={wcThreshold}
                    onChange={(e) => setWcThreshold(e.target.value)}
                    onBlur={() => { const n = Number(wcThreshold); if (Number.isFinite(n) && n >= 0 && n !== wcConfig?.thresholdPct) saveWeeklyConfig({ thresholdPct: n }); }}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    {wcConfig ? `Below ${(wcConfig.expectedSp * wcConfig.thresholdPct / 100).toFixed(1)} points in 7 days gets flagged. The max ticket size has no threshold — one ticket over it counts.` : ''}
                    {wcSaving ? ' Saving…' : wcSaved ? ' Saved.' : ''}
                  </p>
                </div>
              </div>

              {wcMembers.length === 0 ? (
                <p className="text-xs text-gray-400">No one in the org chart has a department under {wcConfig?.rootDepartment || 'Software Engineering'} yet.</p>
              ) : (
                <div className="border border-gray-200 rounded max-h-96 overflow-y-auto">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Engineer</th>
                        <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Department</th>
                        <th className="text-left px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">Jira account</th>
                        <th className="text-right px-2 py-1 font-medium text-gray-500 uppercase tracking-wider" title="Story points expected per 7 days. Blank uses the team default.">Points / 7d</th>
                        <th className="text-right px-2 py-1 font-medium text-gray-500 uppercase tracking-wider" title="Any resolved ticket worth more than this is counted as oversized. Blank uses the team default.">Max ticket size</th>
                        <th className="text-center px-2 py-1 font-medium text-gray-500 uppercase tracking-wider">In weekly check</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {wcMembers.map(m => (
                        <tr key={m.userId} className={`hover:bg-gray-50 ${m.included ? '' : 'opacity-50'}`}>
                          <td className="px-2 py-1 text-gray-800">{m.name}</td>
                          <td className="px-2 py-1 text-gray-500">{m.department}</td>
                          <td className="px-2 py-1">
                            {m.jiraAccountId ? (
                              <span className="text-gray-800">
                                {m.jiraName || m.jiraAccountId}
                                <button
                                  onClick={() => saveWeeklyMember(m.userId, { jiraAccountId: null, jiraName: null })}
                                  className="ml-1.5 text-gray-400 hover:text-red-600"
                                  title="Unpin — go back to matching by name"
                                >
                                  ✕
                                </button>
                              </span>
                            ) : wcPickerFor === m.userId ? (
                              <div className="relative">
                                <input
                                  autoFocus
                                  type="text"
                                  value={wcPickerSearch}
                                  onChange={(e) => { setWcPickerSearch(e.target.value); searchJiraUsers(e.target.value); }}
                                  onBlur={() => setTimeout(() => setWcPickerFor(null), 150)}
                                  placeholder="Search Jira users…"
                                  className="w-40 border border-gray-300 rounded px-2 py-0.5 text-xs"
                                />
                                {wcJiraUsers.length > 0 && (
                                  <div className="absolute left-0 top-full mt-1 z-30 w-56 bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto">
                                    {wcJiraUsers.map(j => (
                                      <button
                                        key={j.accountId}
                                        type="button"
                                        onClick={() => {
                                          saveWeeklyMember(m.userId, { jiraAccountId: j.accountId, jiraName: j.displayName });
                                          setWcPickerFor(null); setWcPickerSearch(''); setWcJiraUsers([]);
                                        }}
                                        className="w-full text-left px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                                      >
                                        {j.displayName}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <button
                                onClick={() => { setWcPickerFor(m.userId); setWcPickerSearch(m.name.split(' ')[0]); searchJiraUsers(m.name.split(' ')[0]); }}
                                className="text-gray-400 hover:text-blue-600"
                                title="Pin this person's Jira account. Without a pin they're matched by display name."
                              >
                                matched by name — pin
                              </button>
                            )}
                          </td>
                          {/* Blank = inherit the team default; the placeholder shows what that is. */}
                          <td className="px-2 py-1 text-right">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              defaultValue={m.expectedSp ?? ''}
                              placeholder={String(wcConfig?.expectedSp ?? '')}
                              onBlur={(e) => {
                                const raw = e.target.value.trim();
                                const next = raw === '' ? null : Number(raw);
                                if (next !== null && (!Number.isFinite(next) || next < 0)) { e.target.value = String(m.expectedSp ?? ''); return; }
                                if (next !== m.expectedSp) saveWeeklyMember(m.userId, { expectedSp: next });
                              }}
                              className={`w-16 border border-gray-300 rounded px-1 py-0.5 text-xs text-right ${m.expectedSp == null ? 'text-gray-400' : 'text-gray-900 font-medium'}`}
                            />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              defaultValue={m.maxTicketSize ?? ''}
                              placeholder={String(wcConfig?.maxTicketSize ?? '')}
                              onBlur={(e) => {
                                const raw = e.target.value.trim();
                                const next = raw === '' ? null : Number(raw);
                                if (next !== null && (!Number.isFinite(next) || next < 0)) { e.target.value = String(m.maxTicketSize ?? ''); return; }
                                if (next !== m.maxTicketSize) saveWeeklyMember(m.userId, { maxTicketSize: next });
                              }}
                              className={`w-16 border border-gray-300 rounded px-1 py-0.5 text-xs text-right ${m.maxTicketSize == null ? 'text-gray-400' : 'text-gray-900 font-medium'}`}
                            />
                          </td>
                          <td className="px-2 py-1 text-center">
                            <input
                              type="checkbox"
                              checked={m.included}
                              onChange={(e) => saveWeeklyMember(m.userId, { included: e.target.checked })}
                              className="rounded border-gray-300"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-gray-400">
                Leave a target blank to use the team default. Jira hides user emails, so people are linked to Jira by display name — pin an account for anyone whose Jira name differs too much to match (or is ambiguous).
              </p>

              {wcError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2 whitespace-pre-wrap">{wcError}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
