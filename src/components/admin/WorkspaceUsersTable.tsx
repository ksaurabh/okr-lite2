import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User, Department } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { AutocompleteInput } from './AutocompleteInput';
import { OrgChart } from '../orgchart';

const API_URL = import.meta.env.VITE_API_URL || '';

type RowStatus = { state: 'saving' | 'saved' | 'error'; msg?: string };

// Editable table of users -> manager email + department. Edits are written back
// to Google Workspace (and mirrored locally) via PATCH /api/admin/workspace-user.
export function WorkspaceUsersTable() {
  const { login } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { managerEmail: string; department: string }>>({});
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [filter, setFilter] = useState('');
  // Departments (defined list + the merged selectable list for autocomplete).
  const [departments, setDepartments] = useState<string[]>([]);
  const [definedDepartments, setDefinedDepartments] = useState<Department[]>([]);
  const [newDept, setNewDept] = useState('');
  const [newDeptParent, setNewDeptParent] = useState('');
  // Emails excluded from the reporting structure (lowercase).
  const [excludedEmails, setExcludedEmails] = useState<string[]>([]);
  const [deptsOpen, setDeptsOpen] = useState(false);
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set()); // lowercase dept names
  // JSON export/import of the whole "Users & reporting" set.
  const [porterError, setPorterError] = useState<string | null>(null);
  const [porterResult, setPorterResult] = useState<{ updated: number; departments: number; excludedEmails: number; unmatched: string[]; unknownManagers: string[] } | null>(null);
  const porterFileRef = useRef<HTMLInputElement>(null);
  const [showChart, setShowChart] = useState(false);

  const isExcluded = useCallback((email: string) => excludedEmails.includes(email.toLowerCase()), [excludedEmails]);
  // Managers can only be users that are part of the reporting structure.
  const userEmails = useMemo(() => users.map(u => u.email).filter(e => !isExcluded(e)), [users, isExcluded]);

  // Defined departments flattened into display order with a nesting depth, so the
  // hierarchy renders as an indented tree. Departments whose parent is missing are
  // treated as top-level.
  const orderedDepartments = useMemo(() => {
    const byLower = new Map(definedDepartments.map(d => [d.name.toLowerCase(), d] as const));
    const parentKey = (d: Department) => {
      const p = d.parentName ? d.parentName.toLowerCase() : null;
      return p && p !== d.name.toLowerCase() && byLower.has(p) ? p : null;
    };
    const childrenOf = (parent: string | null) => definedDepartments
      .filter(d => parentKey(d) === parent)
      .sort((a, b) => a.name.localeCompare(b.name));
    const out: { dept: Department; depth: number }[] = [];
    const seen = new Set<string>();
    const walk = (parent: string | null, depth: number) => {
      for (const d of childrenOf(parent)) {
        const key = d.name.toLowerCase();
        if (seen.has(key)) continue; // defensive: never recurse into a cycle
        seen.add(key);
        out.push({ dept: d, depth });
        walk(key, depth + 1);
      }
    };
    walk(null, 0);
    // Safety net: a defined department not reached by the walk (e.g. trapped in a
    // parent cycle) still shows, as a top-level entry.
    for (const d of definedDepartments) {
      const key = d.name.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push({ dept: d, depth: 0 }); }
    }
    return out;
  }, [definedDepartments]);

  // Parent pointer (lowercase) per defined department, and the set of departments
  // that have at least one child — used to make the tree collapsible.
  const { parentOf, hasChildren } = useMemo(() => {
    const byLower = new Map(definedDepartments.map(d => [d.name.toLowerCase(), d] as const));
    const parentOf = new Map<string, string | null>();
    for (const d of definedDepartments) {
      const p = d.parentName ? d.parentName.toLowerCase() : null;
      parentOf.set(d.name.toLowerCase(), p && p !== d.name.toLowerCase() && byLower.has(p) ? p : null);
    }
    const hasChildren = new Set<string>();
    for (const p of parentOf.values()) if (p) hasChildren.add(p);
    return { parentOf, hasChildren };
  }, [definedDepartments]);

  // A department is hidden when any of its ancestors is collapsed.
  const hiddenByCollapse = useCallback((nameLower: string) => {
    let p = parentOf.get(nameLower) ?? null;
    while (p) { if (collapsedDepts.has(p)) return true; p = parentOf.get(p) ?? null; }
    return false;
  }, [parentOf, collapsedDepts]);

  const toggleDept = (nameLower: string) => setCollapsedDepts(prev => {
    const next = new Set(prev);
    if (next.has(nameLower)) next.delete(nameLower); else next.add(nameLower);
    return next;
  });

  // Departments that employees are in (from the merged list) but that aren't in
  // the defined hierarchy — surfaced so every real department is visible.
  const extraDepartments = useMemo(() => {
    const definedLower = new Set(definedDepartments.map(d => d.name.toLowerCase()));
    return departments.filter(name => !definedLower.has(name.toLowerCase())).sort((a, b) => a.localeCompare(b));
  }, [departments, definedDepartments]);

  // Employee counts per department (rollup: the department + all its
  // sub-departments) and the company total. Excluded emails don't count.
  const { deptCount, companyTotal } = useMemo(() => {
    const active = users.filter(u => !isExcluded(u.email));
    const direct = new Map<string, number>();
    for (const u of active) {
      const key = (u.department || '').trim().toLowerCase();
      if (key) direct.set(key, (direct.get(key) || 0) + 1);
    }
    const byLower = new Map(definedDepartments.map(d => [d.name.toLowerCase(), d] as const));
    const parentKeyOf = (d: Department) => {
      const p = d.parentName ? d.parentName.toLowerCase() : null;
      return p && p !== d.name.toLowerCase() && byLower.has(p) ? p : null;
    };
    const childrenLower = (parent: string) => definedDepartments.filter(d => parentKeyOf(d) === parent).map(d => d.name.toLowerCase());
    const memo = new Map<string, number>();
    const inStack = new Set<string>();
    const rollup = (nameLower: string): number => {
      if (memo.has(nameLower)) return memo.get(nameLower)!;
      if (inStack.has(nameLower)) return direct.get(nameLower) || 0; // cycle guard
      inStack.add(nameLower);
      let sum = direct.get(nameLower) || 0;
      for (const c of childrenLower(nameLower)) sum += rollup(c);
      inStack.delete(nameLower);
      memo.set(nameLower, sum);
      return sum;
    };
    const deptCount = new Map<string, number>();
    for (const d of definedDepartments) deptCount.set(d.name.toLowerCase(), rollup(d.name.toLowerCase()));
    // In-use departments that aren't defined: direct count (no sub-departments).
    for (const [key, n] of direct) if (!deptCount.has(key)) deptCount.set(key, n);
    return { deptCount, companyTotal: active.length };
  }, [users, isExcluded, definedDepartments]);

  const loadDepartments = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/departments`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setDepartments(data.departments || []);
      setDefinedDepartments(data.defined || []);
    } catch { /* ignore */ }
  }, []);

  const loadExcludedEmails = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/excluded-emails`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setExcludedEmails(data.excludedEmails || []);
    } catch { /* ignore */ }
  }, []);

  const saveExcludedEmails = async (next: string[]) => {
    const clean = [...new Set(next.map(e => e.trim().toLowerCase()).filter(Boolean))];
    setExcludedEmails(clean);
    try {
      const res = await fetch(`${API_URL}/api/admin/excluded-emails`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excludedEmails: clean }),
      });
      // The manager tree changes server-side, so reload users to reflect cleared links.
      if (res.ok) { await loadExcludedEmails(); await load(); }
    } catch { /* ignore */ }
  };
  const excludeEmail = (email: string) => saveExcludedEmails([...excludedEmails, email]);
  const includeEmail = (email: string) => saveExcludedEmails(excludedEmails.filter(e => e !== email.toLowerCase()));

  const exportReporting = async () => {
    setPorterError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/users-reporting/export`, { credentials: 'include' });
      if (!res.ok) { setPorterError(`Export failed (${res.status}).`); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'users-reporting.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setPorterError(`Couldn't export: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const importReporting = async (file: File) => {
    setPorterError(null);
    setPorterResult(null);
    try {
      const text = await file.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch { setPorterError('That file is not valid JSON.'); return; }
      const res = await fetch(`${API_URL}/api/admin/users-reporting/import`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) { setPorterError(result?.error || `Import failed (${res.status}).`); return; }
      setPorterResult(result);
      await load();
      await loadDepartments();
      await loadExcludedEmails();
    } catch (err) {
      setPorterError(`Couldn't import: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (porterFileRef.current) porterFileRef.current.value = '';
    }
  };

  const saveDefinedDepartments = async (next: Department[]) => {
    setDefinedDepartments(next);
    try {
      const res = await fetch(`${API_URL}/api/admin/departments`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departments: next }),
      });
      if (res.ok) await loadDepartments();
    } catch { /* ignore */ }
  };

  const addDepartment = () => {
    const v = newDept.trim();
    if (!v || definedDepartments.some(d => d.name.toLowerCase() === v.toLowerCase())) { setNewDept(''); return; }
    const parentName = newDeptParent && definedDepartments.some(d => d.name === newDeptParent) ? newDeptParent : null;
    saveDefinedDepartments([...definedDepartments, { name: v, parentName }]);
    setNewDept('');
    setNewDeptParent('');
  };
  // Remove a department; re-parent its children onto its own parent so nothing is
  // orphaned.
  const removeDepartment = (name: string) => {
    const grandparent = definedDepartments.find(d => d.name === name)?.parentName ?? null;
    const next = definedDepartments
      .filter(d => d.name !== name)
      .map(d => (d.parentName === name ? { ...d, parentName: grandparent } : d));
    saveDefinedDepartments(next);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/users`, { credentials: 'include' });
      if (!res.ok) { setError(`Couldn't load users (${res.status}).`); return; }
      const data = await res.json();
      const list: User[] = (data.users || []).slice().sort((a: User, b: User) => (a.email || '').localeCompare(b.email || ''));
      setUsers(list);
      const d: Record<string, { managerEmail: string; department: string }> = {};
      for (const u of list) d[u.email] = { managerEmail: u.managerEmail || '', department: u.department || '' };
      setDrafts(d);
    } catch (err) {
      setError(`Couldn't reach the server: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); loadDepartments(); loadExcludedEmails(); }, [load, loadDepartments, loadExcludedEmails]);

  const isDirty = (u: User) => {
    const d = drafts[u.email];
    if (!d) return false;
    return d.managerEmail.trim().toLowerCase() !== (u.managerEmail || '').toLowerCase() ||
      d.department.trim() !== (u.department || '');
  };

  const setDraft = (email: string, field: 'managerEmail' | 'department', value: string) => {
    setDrafts(prev => ({ ...prev, [email]: { ...prev[email], [field]: value } }));
    setStatus(prev => { const n = { ...prev }; delete n[email]; return n; });
  };

  const save = async (u: User) => {
    const d = drafts[u.email];
    if (!d) return;
    const body: { email: string; managerEmail?: string; department?: string } = { email: u.email };
    if (d.managerEmail.trim().toLowerCase() !== (u.managerEmail || '').toLowerCase()) body.managerEmail = d.managerEmail.trim();
    if (d.department.trim() !== (u.department || '')) body.department = d.department.trim();
    if (body.managerEmail === undefined && body.department === undefined) return;

    setStatus(prev => ({ ...prev, [u.email]: { state: 'saving' } }));
    setNeedsReauth(false);
    try {
      const res = await fetch(`${API_URL}/api/admin/workspace-user`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.error === 'google_reauth_required') setNeedsReauth(true);
        const detail = data?.detail ? ` (${data.detail})` : '';
        setStatus(prev => ({ ...prev, [u.email]: { state: 'error', msg: `${data?.message || data?.error || `Error ${res.status}`}${detail}` } }));
        return;
      }
      // Update the local baseline so the row is no longer dirty.
      setUsers(prev => prev.map(x => x.email === u.email
        ? { ...x, managerEmail: body.managerEmail !== undefined ? (data.managerEmail || undefined) : x.managerEmail, managerId: data.managerId ?? x.managerId, department: body.department !== undefined ? (body.department || undefined) : x.department }
        : x));
      setStatus(prev => ({ ...prev, [u.email]: { state: 'saved', msg: 'Saved to Workspace' } }));
    } catch (err) {
      setStatus(prev => ({ ...prev, [u.email]: { state: 'error', msg: err instanceof Error ? err.message : String(err) } }));
    }
  };

  // Excluded emails are dropped from the reporting-structure table.
  const visible = users.filter(u => {
    if (isExcluded(u.email)) return false;
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return u.email.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q) ||
      (drafts[u.email]?.managerEmail || '').toLowerCase().includes(q) || (drafts[u.email]?.department || '').toLowerCase().includes(q);
  });
  // Names to show for excluded chips (fall back to the raw email).
  const nameByEmail = useMemo(() => new Map(users.map(u => [u.email.toLowerCase(), u.name])), [users]);

  return (
    <div className="mt-6 pt-6 border-t border-gray-100">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="font-medium text-gray-900">Users &amp; reporting</h3>
        <div className="flex items-center gap-3">
          <button onClick={exportReporting} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Export JSON</button>
          <button onClick={() => porterFileRef.current?.click()} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Import JSON</button>
          <input ref={porterFileRef} type="file" accept=".json,application/json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importReporting(f); }} />
          <button
            onClick={() => setShowChart(o => !o)}
            aria-expanded={showChart}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3h6v4H9zM3 17h6v4H3zm12 0h6v4h-6zM12 7v6M6 13h12M6 13v4m12-4v4" />
            </svg>
            {showChart ? 'Hide org chart' : 'Org chart'}
          </button>
          <button onClick={load} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Refresh</button>
        </div>
      </div>
      <p className="text-sm text-gray-600 mb-3">
        Edit a user's manager email or department — changes are written back to Google Workspace when you click Save.
        Start typing to pick from suggestions. Export/Import JSON captures the whole set: each user's manager and
        department, the department hierarchy, and the excluded emails (import updates local records only).
      </p>

      {porterResult && (
        <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
          Imported reporting for {porterResult.updated} {porterResult.updated === 1 ? 'user' : 'users'}, {porterResult.departments} departments, {porterResult.excludedEmails} excluded emails.
          {porterResult.unmatched.length > 0 && <div className="text-green-700 mt-1">Emails not found as users: {porterResult.unmatched.join(', ')}</div>}
          {porterResult.unknownManagers.length > 0 && <div className="text-green-700 mt-1">Manager emails not found as users: {porterResult.unknownManagers.join(', ')}</div>}
        </div>
      )}
      {porterError && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{porterError}</div>}
      {showChart && (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <OrgChart users={users.filter(u => !isExcluded(u.email))} />
        </div>
      )}

      <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
        <button
          type="button"
          onClick={() => setDeptsOpen(o => !o)}
          aria-expanded={deptsOpen}
          className="flex items-center gap-1.5 w-full text-left text-sm font-medium text-gray-800"
        >
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${deptsOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Departments
          {definedDepartments.length > 0 && <span className="text-xs font-normal text-gray-400">({definedDepartments.length})</span>}
          <span className="ml-auto text-xs font-normal text-gray-500">{companyTotal} {companyTotal === 1 ? 'employee' : 'employees'} company-wide</span>
        </button>
        {deptsOpen && (
          <div className="mt-2">
            <div className="mb-2 space-y-1">
              {definedDepartments.length === 0 && <span className="text-xs text-gray-400">None defined yet — departments synced from Workspace are still selectable.</span>}
              {orderedDepartments.filter(({ dept }) => !hiddenByCollapse(dept.name.toLowerCase())).map(({ dept, depth }) => {
                const key = dept.name.toLowerCase();
                const kids = hasChildren.has(key);
                const collapsed = collapsedDepts.has(key);
                return (
                  <div key={dept.name} className="flex items-center" style={{ paddingLeft: depth * 18 }}>
                    {kids ? (
                      <button onClick={() => toggleDept(key)} aria-expanded={!collapsed} title={collapsed ? 'Expand' : 'Collapse'} className="mr-1 text-gray-400 hover:text-gray-600">
                        <svg className={`w-3.5 h-3.5 transition-transform ${collapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    ) : (
                      <span className="mr-1 inline-block w-3.5" />
                    )}
                    {depth > 0 && <span className="text-gray-300 mr-1 leading-none">└</span>}
                    <span className="inline-flex items-center gap-1 text-xs bg-white border border-gray-300 rounded-full pl-2.5 pr-1 py-0.5 text-gray-700">
                      {dept.name}
                      <button onClick={() => removeDepartment(dept.name)} title="Remove" className="text-gray-400 hover:text-red-600 rounded-full w-4 h-4 leading-none">×</button>
                    </span>
                    <span className="ml-2 text-xs text-gray-500 tabular-nums" title="Employees in this department and its sub-departments">
                      {deptCount.get(key) ?? 0}
                    </span>
                    {kids && collapsed && <span className="ml-1 text-[11px] text-gray-400">(collapsed)</span>}
                  </div>
                );
              })}
              {extraDepartments.map(name => (
                <div key={`x-${name}`} className="flex items-center">
                  <span className="inline-flex items-center gap-1 text-xs bg-white border border-dashed border-gray-300 rounded-full px-2.5 py-0.5 text-gray-500 italic" title="In use (from Workspace), not yet defined">
                    {name}
                  </span>
                  <span className="ml-2 text-xs text-gray-500 tabular-nums">{deptCount.get(name.toLowerCase()) ?? 0}</span>
                  <button
                    onClick={() => saveDefinedDepartments([...definedDepartments, { name, parentName: null }])}
                    title="Add to the defined department list"
                    className="ml-2 text-[11px] text-blue-600 hover:text-blue-700"
                  >+ define</button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newDept}
                onChange={(e) => setNewDept(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDepartment(); } }}
                placeholder="Add a department…"
                className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={newDeptParent}
                onChange={(e) => setNewDeptParent(e.target.value)}
                title="Nest under a parent department"
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Top level</option>
                {[...definedDepartments].sort((a, b) => a.name.localeCompare(b.name)).map(d => (
                  <option key={d.name} value={d.name}>Under {d.name}</option>
                ))}
              </select>
              <button onClick={addDepartment} disabled={!newDept.trim()} className="text-sm font-medium px-3 py-1.5 rounded-lg bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:opacity-40">Add</button>
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
        <div className="text-sm font-medium text-gray-800 mb-1">Excluded from reporting</div>
        <p className="text-xs text-gray-500 mb-2">
          Excluded emails are left out of the reporting structure — hidden from the table below, not selectable as a manager, and skipped on Workspace sync. Use the “Exclude” button on a row to add one.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {excludedEmails.length === 0 && <span className="text-xs text-gray-400">None excluded.</span>}
          {[...excludedEmails].sort((a, b) => a.localeCompare(b)).map(email => (
            <span key={email} className="inline-flex items-center gap-1 text-xs bg-white border border-gray-300 rounded-full pl-2.5 pr-1 py-0.5 text-gray-700" title={nameByEmail.get(email) || email}>
              {email}
              <button onClick={() => includeEmail(email)} title="Re-include in reporting" className="text-gray-400 hover:text-green-600 rounded-full w-4 h-4 leading-none">×</button>
            </span>
          ))}
        </div>
      </div>

      {needsReauth && (
        <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
          Google needs to be reconnected with directory write access.
          <button onClick={login} className="ml-2 text-xs font-medium bg-amber-600 text-white rounded px-3 py-1.5 hover:bg-amber-700">Reconnect Google</button>
        </div>
      )}
      {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by email, name, manager, or department…"
        className="w-full mb-3 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />

      {loading ? (
        <p className="text-sm text-gray-500 py-4">Loading users…</p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 text-left">
              <tr>
                <th className="py-2 px-3 font-medium">User email</th>
                <th className="py-2 px-3 font-medium">Manager email</th>
                <th className="py-2 px-3 font-medium">Department</th>
                <th className="py-2 px-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(u => {
                const d = drafts[u.email] || { managerEmail: '', department: '' };
                const st = status[u.email];
                const dirty = isDirty(u);
                return (
                  <tr key={u.email} className={`border-t border-gray-100${u.active === false ? ' bg-gray-50 text-gray-400' : ''}`}>
                    <td className="py-1.5 px-3 whitespace-nowrap" title={u.name}>
                      <span className={u.active === false ? 'text-gray-500' : 'text-gray-800'}>{u.email}</span>
                      {u.active === false && (
                        <span className="ml-2 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">Inactive</span>
                      )}
                    </td>
                    <td className="py-1.5 px-3 min-w-[220px]">
                      <AutocompleteInput value={d.managerEmail} onChange={(v) => setDraft(u.email, 'managerEmail', v)}
                        options={userEmails} placeholder="manager@…" />
                    </td>
                    <td className="py-1.5 px-3 min-w-[180px]">
                      <AutocompleteInput value={d.department} onChange={(v) => setDraft(u.email, 'department', v)}
                        options={departments} placeholder="Department" />
                    </td>
                    <td className="py-1.5 px-3 whitespace-nowrap">
                      <button onClick={() => save(u)} disabled={!dirty || st?.state === 'saving'}
                        className="text-xs font-medium px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
                        {st?.state === 'saving' ? 'Saving…' : 'Save'}
                      </button>
                      {st?.state === 'saved' && <span className="ml-2 text-xs text-green-600">{st.msg}</span>}
                      {st?.state === 'error' && <span className="ml-2 text-xs text-red-600" title={st.msg}>Failed</span>}
                      <button onClick={() => excludeEmail(u.email)} title="Exclude from the reporting structure"
                        className="ml-2 text-xs font-medium px-3 py-1 rounded bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600">
                        Exclude
                      </button>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={4} className="py-4 px-3 text-gray-400 text-center">No users.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
