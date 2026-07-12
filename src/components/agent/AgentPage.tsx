import { Component, useEffect, useMemo, useRef, useState } from 'react';
import { useOKRStore, type OKRStore, type ColumnKey } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { ObjectiveTree } from '../objectives/ObjectiveTree';
import { ListsPage } from '../lists';
import type { List, Objective, User, WorkflowStatus } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';
const SESSIONS_URL = `${API_URL}/api/users/me/agent-sessions`;

type Step = 'root' | 'treeBrowse' | 'durationGroupPick' | 'planMembershipPick' | 'user' | 'durationType' | 'planFilter' | 'planResults' | 'planSelect' | 'duration' | 'planPick' | 'result' | 'childPlanPick' | 'splitMenu' | 'vpEach' | 'vpPick' | 'itemAction' | 'changeDuration' | 'vpItem' | 'delivSummary' | 'delivDate' | 'delivAssignee' | 'delivParent' | 'reviewArea' | 'jiraProjectPick' | 'settings' | 'autonomousActions' | 'autonomousEng';

// Serializable chat messages (so sessions can be persisted and resumed).
type Msg =
  | { role: 'user'; kind: 'text'; text: string }
  | { role: 'agent'; kind: 'text'; text: string; tone?: 'error' }
  | { role: 'agent'; kind: 'menu'; title: string; code?: string; options: string[]; baseCount: number }
  | { role: 'agent'; kind: 'plan'; planName: string; who: string; period: string; items: { id: string; title: string; vp: number; missing?: boolean; kr?: boolean }[]; total: number; code?: string }
  | { role: 'agent'; kind: 'children'; parent: string; items: { id: string; title: string; vp: number; duration: string; status: string }[] }
  | { role: 'agent'; kind: 'plans'; who: string; filter?: string; items: { id: string; name: string; type: string; period: string; status: string }[] }
  | { role: 'agent'; kind: 'family'; subject: string; rows: { name: string; rel: string; duration: string; vp: number; owner: string; assignee: string; self?: boolean }[] }
  | { role: 'agent'; kind: 'objlist'; title: string; ids: string[]; code?: string }
  | { role: 'agent'; kind: 'split'; who: string; parentListId: string; childListId: string; parentName: string; childName: string }
  | { role: 'agent'; kind: 'breakdown'; title: string; rows: { name: string; count: number; vp: number }[]; totalCount: number; totalVp: number }
  | { role: 'agent'; kind: 'resolvedWeekly'; title: string; asOf: string; days: number; rows: { name: string; count: number; sp: number }[]; totalCount: number; totalSp: number; parentRows: ParentGroupRow[] }
  | { role: 'agent'; kind: 'deliverable'; summary: string; neededBy: string; assigneeId: string; assigneeName: string; ownerId: string }
  | { role: 'agent'; kind: 'releases'; area: string; sheetTitle: string; asOf: string; groups: { key: string; label: string; items: ReleaseItem[] }[]; recent: ReleaseItem[]; columns: string[]; note?: string; rawHeaders?: string[]; rawRows?: string[][] }
  | { role: 'agent'; kind: 'reauth'; message: string }
  | { role: 'agent'; kind: 'jira'; groups: { version: string; tickets: JiraTicket[] }[]; unknown: string[]; project?: string; jql?: string; asOf?: number };

// One classified row from the Release Calendar. `fields` holds the values for the
// detected display columns (name/status/start/prod); `why` explains the bucket.
interface ReleaseItem { name: string; fields: Record<string, string>; why: string; }

// A Jira issue in a release (fixVersion), as returned by /api/jira/release-tickets.
interface JiraTicket { key: string; summary: string; status: string; statusCategory: string; assignee: string; type: string; url: string; fixVersions: string[]; storyPoints: number; resolved: string | null; parentKey?: string | null; parentSummary?: string | null; }
// One (assignee, parent) group in the weekly resolved breakdown.
interface ParentGroupRow { assignee: string; parentKey: string; parentSummary: string; parentUrl: string; count: number; sp: number; }

interface SessionState {
  step: Step;
  selectedUserId: string;
  durationType: string;
  resultPeriodId: string;
  resultObjectiveIds: string[];
  vpTargetId: string;
  vpEachIndex: number;
  resultPlanId: string;
  planChoiceIds: string[];
  durationGroupBaseIds: string[];
  durationGroups: { periodId: string; label: string; count: number }[];
}

interface AgentSession {
  id: string;
  title: string;
  archived: boolean;
  transcript: Msg[];
  state: SessionState;
  createdAt: string;
  updatedAt: string;
}

const ROOT_OPTIONS = ['Set my OKRs', 'Browse Objective Tree', 'Add a deliverable', 'Review Progress', 'Settings'];
const REVIEW_AREAS = ['Engineering'];
const SETTINGS_OPTIONS = ['Autonomous Actions'];
const AUTONOMOUS_AREAS = ['Engineering'];

// A Loop / Autonomous Action: an action the agent performs on a cadence, with a
// fully autonomous execution. `run` is the step routed to when it's invoked.
interface AutonomousAction { label: string; cadence: string; summary: string; description: string; }
const ENG_AUTONOMOUS_ACTIONS: AutonomousAction[] = [
  {
    label: 'Weekly - Last 7d done, and plan for next 7d',
    cadence: 'Weekly',
    summary: 'Last 7d done, and plan for next 7d',
    description: 'Fetches tickets resolved in the last 7 days and reports the number of tickets resolved by assignee along with the sum of their story points by assignee.',
  },
];
const DURATION_TYPES = [
  { label: 'Quarterly', type: 'quarter' },
  { label: 'Monthly', type: 'month' },
  { label: 'Weekly', type: 'week' },
] as const;
const RESULT_ACTIONS = ['Update VP on every item', 'Select an item', 'Reload the plan', 'View child plan side by side'];
const ITEM_ACTIONS = ['Set value points', 'Show children', 'Show parent & siblings', 'Change duration'];
const TREE_OPTIONS = [
  'Show top level initiatives that are open',
  'Show top level initiatives and their children that are open',
  'Show my objectives whose duration has passed and is still open',
  'Show top level initiatives and their children that are open by duration',
  'Plan membership — mark items against a plan',
];
const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  todo: 'To Do', backlog: 'In Backlog', planning: 'In Planning', in_progress: 'In Progress',
  acceptance: 'In Acceptance', done: 'Done', archived: 'Archived',
};
const HIDDEN_CHILD_STATUSES = new Set(['done', 'archived']);
const BACK_LABEL = 'Go back';
const RESTART_LABEL = 'Start over';

const PREV: Record<Step, Step> = {
  root: 'root',
  treeBrowse: 'root',
  durationGroupPick: 'treeBrowse',
  planMembershipPick: 'treeBrowse',
  user: 'root',
  durationType: 'user',
  planFilter: 'durationType',
  planResults: 'planFilter',
  planSelect: 'planResults',
  duration: 'durationType',
  planPick: 'duration',
  result: 'duration',
  childPlanPick: 'result',
  splitMenu: 'childPlanPick',
  vpEach: 'result',
  vpPick: 'result',
  itemAction: 'vpPick',
  changeDuration: 'itemAction',
  vpItem: 'itemAction',
  delivSummary: 'root',
  delivDate: 'delivSummary',
  delivAssignee: 'delivDate',
  delivParent: 'delivAssignee',
  reviewArea: 'root',
  jiraProjectPick: 'reviewArea',
  settings: 'root',
  autonomousActions: 'settings',
  autonomousEng: 'autonomousActions',
};

const VALUE_STEPS: Step[] = ['vpEach', 'vpItem'];
// Free-text entry steps (summary / need-by date for a new deliverable).
const TEXT_STEPS: Step[] = ['delivSummary', 'delivDate'];

// Stable short code identifying a question by its prompt text, e.g. "Q-1A2B".
// Deterministic so the same question always carries the same code across sessions.
function questionCode(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (Math.imul(h, 31) + title.charCodeAt(i)) | 0;
  return `Q-${(h >>> 0).toString(36).toUpperCase().padStart(4, '0').slice(-4)}`;
}
const menuMsg = (title: string, baseOpts: string[]): Msg => ({ role: 'agent', kind: 'menu', title, code: questionCode(title), options: [...baseOpts, BACK_LABEL, RESTART_LABEL], baseCount: baseOpts.length });
const textMsg = (text: string, tone?: 'error'): Msg => ({ role: 'agent', kind: 'text', text, ...(tone ? { tone } : {}) });
const userMsg = (text: string): Msg => ({ role: 'user', kind: 'text', text });
const planMsg = (planName: string, who: string, period: string, items: { id: string; title: string; vp: number; missing?: boolean; kr?: boolean }[], total: number, code?: string): Msg => ({ role: 'agent', kind: 'plan', planName, who, period, items, total, code });
const childrenMsg = (parent: string, items: { id: string; title: string; vp: number; duration: string; status: string }[]): Msg => ({ role: 'agent', kind: 'children', parent, items });
const plansMsg = (who: string, items: { id: string; name: string; type: string; period: string; status: string }[], filter?: string): Msg => ({ role: 'agent', kind: 'plans', who, filter, items });
const familyMsg = (subject: string, rows: { name: string; rel: string; duration: string; vp: number; owner: string; assignee: string; self?: boolean }[]): Msg => ({ role: 'agent', kind: 'family', subject, rows });
const objlistMsg = (title: string, ids: string[], code?: string): Msg => ({ role: 'agent', kind: 'objlist', title, ids, code });
const splitMsg = (who: string, parentListId: string, childListId: string, parentName: string, childName: string): Msg =>
  ({ role: 'agent', kind: 'split', who, parentListId, childListId, parentName, childName });
const breakdownMsg = (title: string, rows: { name: string; count: number; vp: number }[], totalCount: number, totalVp: number): Msg =>
  ({ role: 'agent', kind: 'breakdown', title, rows, totalCount, totalVp });
const resolvedWeeklyMsg = (title: string, asOf: string, days: number, rows: { name: string; count: number; sp: number }[], totalCount: number, totalSp: number, parentRows: ParentGroupRow[]): Msg =>
  ({ role: 'agent', kind: 'resolvedWeekly', title, asOf, days, rows, totalCount, totalSp, parentRows });

// Group resolved tickets by (assignee, parent issue) with count + summed story
// points. Tickets without a parent are grouped under "None".
function parentBreakdown(tickets: JiraTicket[], browse: string): ParentGroupRow[] {
  const map = new Map<string, ParentGroupRow>();
  for (const t of tickets) {
    const assignee = t.assignee || 'Unassigned';
    const hasParent = !!t.parentKey;
    const parentKey = hasParent ? t.parentKey! : 'None';
    const parentSummary = hasParent ? (t.parentSummary || '') : '';
    const parentUrl = hasParent && browse ? `${browse}/browse/${t.parentKey}` : '';
    const k = `${assignee} ${parentKey}`;
    const e = map.get(k) || { assignee, parentKey, parentSummary, parentUrl, count: 0, sp: 0 };
    e.count += 1;
    e.sp += t.storyPoints || 0;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) =>
    a.assignee.localeCompare(b.assignee) ||
    (a.parentKey === 'None' ? 1 : b.parentKey === 'None' ? -1 : b.count - a.count) ||
    a.parentKey.localeCompare(b.parentKey));
}

// Pivot (assignee, parent) rows into a parent-issue (rows) × assignee (columns)
// matrix, with accessors for count/sp cells, per-parent totals, per-assignee
// column totals, and grand totals.
function pivotParents(rows: ParentGroupRow[]) {
  const assignees: string[] = [];
  const aSeen = new Set<string>();
  const parentMap = new Map<string, { key: string; summary: string; url: string }>();
  const k = (p: string, a: string) => `${p} ${a}`;
  const countAt = new Map<string, number>();
  const spAt = new Map<string, number>();
  for (const r of rows) {
    if (!aSeen.has(r.assignee)) { aSeen.add(r.assignee); assignees.push(r.assignee); }
    if (!parentMap.has(r.parentKey)) parentMap.set(r.parentKey, { key: r.parentKey, summary: r.parentSummary, url: r.parentUrl });
    countAt.set(k(r.parentKey, r.assignee), (countAt.get(k(r.parentKey, r.assignee)) || 0) + r.count);
    spAt.set(k(r.parentKey, r.assignee), (spAt.get(k(r.parentKey, r.assignee)) || 0) + r.sp);
  }
  const count = (p: string, a: string) => countAt.get(k(p, a)) || 0;
  const sp = (p: string, a: string) => spAt.get(k(p, a)) || 0;
  const parents = [...parentMap.values()];
  const parentCount = (p: string) => assignees.reduce((n, a) => n + count(p, a), 0);
  const parentSp = (p: string) => assignees.reduce((n, a) => n + sp(p, a), 0);
  parents.sort((x, y) =>
    (x.key === 'None' ? 1 : y.key === 'None' ? -1 : parentCount(y.key) - parentCount(x.key)) || x.key.localeCompare(y.key));
  const aCount = (a: string) => parents.reduce((n, p) => n + count(p.key, a), 0);
  const aSp = (a: string) => parents.reduce((n, p) => n + sp(p.key, a), 0);
  assignees.sort((a, b) => (a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : aCount(b) - aCount(a)) || a.localeCompare(b));
  const grandCount = parents.reduce((n, p) => n + parentCount(p.key), 0);
  const grandSp = parents.reduce((n, p) => n + parentSp(p.key), 0);
  return { parents, assignees, count, sp, parentCount, parentSp, aCount, aSp, grandCount, grandSp };
}
const deliverableMsg = (summary: string, neededBy: string, assigneeId: string, assigneeName: string, ownerId: string): Msg =>
  ({ role: 'agent', kind: 'deliverable', summary, neededBy, assigneeId, assigneeName, ownerId });

// ---- Release Calendar parsing (Review Progress) ----

// Parse a spreadsheet cell into a local date (midnight), or null. Handles the
// common formatted shapes Sheets returns: ISO (2026-07-15), US (7/15/2026),
// and month-name ("Jul 15, 2026" / "15 Jul 2026").
function parseSheetDate(raw?: string): Date | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // Year-first with -, ., or / separators: 2025-11-24, 2025.11.24, 2025/11/24
  let m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  // Day-first dotted (European): 24.11.2025 => 24 Nov 2025
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  // US month-first: 11/24/2025 or 11-24-25
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new Date(y, +m[1] - 1, +m[2]); }
  const t = Date.parse(s); // "Jul 15, 2026", "15 Jul 2026", etc.
  if (!isNaN(t)) { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  return null;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; };
const fmtShort = (d: Date | null) => d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

// Classify the Release Calendar. Columns are pipeline stages (… Dev … Pre-Prod,
// Prod) and each cell is the date a release reached that stage. Per the sheet's
// convention: Dev = when the release starts, Prod = when it reaches production
// (the finish line). Buckets: in progress now, shipped in the last 30 days
// (by Prod), and starting in the next 30 days (by Dev).
function classifyReleases(headers: string[], rows: string[][], today: Date) {
  const norm = (h: string) => String(h ?? '').toLowerCase().trim();
  const exact = (name: string) => headers.findIndex(h => norm(h) === name);

  let nameIdx = headers.findIndex(h => /version|release|feature/i.test(String(h ?? '')));
  if (nameIdx < 0) nameIdx = 0;
  const branchIdx = headers.findIndex(h => /branch/i.test(String(h ?? '')));
  // Prod is matched exactly so it doesn't collide with "Pre-Prod".
  const prodIdx = exact('prod') >= 0 ? exact('prod') : exact('production');
  const devIdx = exact('dev');

  const t0 = startOfDay(today);
  const past30 = addDays(t0, -30);
  const next30 = addDays(t0, 30);
  const cellOf = (row: string[], i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '');

  // Stage/date columns (cells mostly parse as dates), used to describe where a
  // release currently sits. Excludes the name and branch columns.
  const dateIdxs = headers.map((_, i) => i).filter(i => {
    if (i === nameIdx || i === branchIdx) return false;
    let dated = 0, nonEmpty = 0;
    for (const r of rows) { const v = cellOf(r, i); if (v) { nonEmpty++; if (parseSheetDate(v)) dated++; } }
    return nonEmpty > 0 && dated >= Math.ceil(nonEmpty / 2);
  });

  // Rightmost stage already reached (date ≤ today), and the next planned stage.
  const currentStage = (row: string[]) => {
    let last: { name: string; d: Date } | null = null;
    for (const i of dateIdxs) { const d = parseSheetDate(cellOf(row, i)); if (d && d <= t0) last = { name: headers[i], d }; }
    return last;
  };
  const nextStage = (row: string[]) => {
    for (const i of dateIdxs) { const d = parseSheetDate(cellOf(row, i)); if (d && d > t0) return { name: headers[i], d }; }
    return null;
  };
  const stageDatesOf = (row: string[]) => dateIdxs.map(i => parseSheetDate(cellOf(row, i))).filter((d): d is Date => !!d);

  // Display columns: the release name plus the pipeline stage dates, in order.
  const normKey = (h: string) => String(h ?? '').toLowerCase().replace(/[\s_-]/g, '');
  const STAGE_LABELS = ['Dev', 'Test', 'Staging', 'Pre-Prod', 'Prod'];
  const stageDisplayIdxs = STAGE_LABELS
    .map(label => headers.findIndex(h => normKey(h) === normKey(label)))
    .filter(i => i >= 0);
  const columns: string[] = [headers[nameIdx], ...stageDisplayIdxs.map(i => headers[i])];

  const fieldsOf = (row: string[]): Record<string, string> => {
    const f: Record<string, string> = {};
    f[headers[nameIdx]] = cellOf(row, nameIdx) || '(untitled)';
    for (const i of stageDisplayIdxs) f[headers[i]] = cellOf(row, i);
    return f;
  };

  const groups = {
    in_progress: { key: 'in_progress', label: 'In progress now', items: [] as ReleaseItem[] },
    completed: { key: 'completed', label: 'Just shipped (Prod in the last 30 days)', items: [] as ReleaseItem[] },
    upcoming: { key: 'upcoming', label: 'Starting in the next 30 days (Dev)', items: [] as ReleaseItem[] },
  };

  for (const row of rows) {
    const dev = devIdx >= 0 ? parseSheetDate(cellOf(row, devIdx)) : null;
    const prod = prodIdx >= 0 ? parseSheetDate(cellOf(row, prodIdx)) : null;
    const name = cellOf(row, nameIdx) || '(untitled)';
    const fields = fieldsOf(row);

    const stageDates = stageDatesOf(row);
    const maxStage = stageDates.length ? new Date(Math.max(...stageDates.map(d => d.getTime()))) : null;
    const hasFuture = stageDates.some(d => d > t0);
    const recentlyActive = !!maxStage && maxStage >= past30;

    const justShipped = !!prod && prod <= t0 && prod >= past30;
    const shippedLongAgo = !!prod && prod < past30;
    // In progress: started Dev, not yet in Prod, and still active (a future
    // milestone, or activity within the last 30 days) — so long-dead rows with a
    // Dev date but no Prod don't linger here forever.
    const inProgress = !justShipped && !shippedLongAgo && !!dev && dev <= t0 && (!prod || prod > t0) && (hasFuture || recentlyActive);
    const aboutToStart = !justShipped && !shippedLongAgo && !inProgress && !!dev && dev > t0 && dev <= next30;

    // Priority: in progress > just shipped > about to start (each row shown once).
    if (inProgress) {
      const nxt = nextStage(row);
      const cur = currentStage(row);
      let why = nxt ? `Next: ${nxt.name} ${fmtShort(nxt.d)}` : (cur ? `Reached ${cur.name} ${fmtShort(cur.d)}` : `Dev ${fmtShort(dev)}`);
      if (prod && prod > t0) why += ` · Prod due ${fmtShort(prod)}`;
      groups.in_progress.items.push({ name, fields, why });
    } else if (justShipped) {
      groups.completed.items.push({ name, fields, why: `Shipped to Prod ${fmtShort(prod)}` });
    } else if (aboutToStart) {
      groups.upcoming.items.push({ name, fields, why: `Dev starts ${fmtShort(dev)}` });
    }
  }

  // "Last 3 releases": most recently shipped by Prod date — shown as context when
  // nothing is in the three focus windows.
  let recent: ReleaseItem[] = [];
  if (prodIdx >= 0) {
    recent = rows
      .map(row => ({ row, d: parseSheetDate(cellOf(row, prodIdx)) }))
      .filter((x): x is { row: string[]; d: Date } => !!x.d && x.d <= t0)
      .sort((a, b) => b.d.getTime() - a.d.getTime())
      .slice(0, 3)
      .map(({ row, d }) => ({ name: cellOf(row, nameIdx) || '(untitled)', fields: fieldsOf(row), why: `Shipped ${fmtShort(d)}` }));
  }

  const detected = devIdx >= 0 || prodIdx >= 0;
  const orderedGroups = [groups.in_progress, groups.completed, groups.upcoming].filter(g => g.items.length > 0);
  return { columns, groups: orderedGroups, recent, detected, counts: {
    in_progress: groups.in_progress.items.length,
    completed: groups.completed.items.length,
    upcoming: groups.upcoming.items.length,
  } };
}

const releasesMsg = (
  area: string, sheetTitle: string, asOf: string,
  groups: { key: string; label: string; items: ReleaseItem[] }[], recent: ReleaseItem[],
  columns: string[], note?: string, rawHeaders?: string[], rawRows?: string[][],
): Msg => ({ role: 'agent', kind: 'releases', area, sheetTitle, asOf, groups, recent, columns, note, rawHeaders, rawRows });

const jiraMsg = (groups: { version: string; tickets: JiraTicket[] }[], unknown: string[], project?: string, jql?: string, asOf?: number): Msg =>
  ({ role: 'agent', kind: 'jira', groups, unknown, project, jql, asOf });

// Story/Bug/Sub-task types (the work items counted in the weekly resolved view).
const isWorkItem = (t: JiraTicket) => /^(story|bug|sub[-\s]?task)$/i.test(t.type || '');

// Count + summed story points by assignee for a set of tickets.
function countAndSpByAssignee(tickets: JiraTicket[]) {
  const map = new Map<string, { count: number; sp: number }>();
  for (const t of tickets) {
    const who = t.assignee || 'Unassigned';
    const prev = map.get(who) || { count: 0, sp: 0 };
    map.set(who, { count: prev.count + 1, sp: prev.sp + (t.storyPoints || 0) });
  }
  const rows = [...map.entries()].sort((a, b) => {
    if (a[0] === 'Unassigned') return 1;
    if (b[0] === 'Unassigned') return -1;
    return b[1].count - a[1].count || a[0].localeCompare(b[0]);
  });
  const total = { count: tickets.length, sp: tickets.reduce((n, t) => n + (t.storyPoints || 0), 0) };
  return { rows, total };
}

// Pivot a release's tickets into a status (rows) × type (columns) count matrix.
// Statuses are ordered by workflow category (To Do → In Progress → Done).
function pivotByStatusType(tickets: JiraTicket[]) {
  const typeSet = new Set<string>();
  const statuses = new Map<string, { name: string; category: string }>();
  const counts = new Map<string, Map<string, number>>(); // status -> type -> n
  for (const t of tickets) {
    const type = t.type || '—';
    const status = t.status || '—';
    typeSet.add(type);
    if (!statuses.has(status)) statuses.set(status, { name: status, category: t.statusCategory || '' });
    if (!counts.has(status)) counts.set(status, new Map());
    const row = counts.get(status)!;
    row.set(type, (row.get(type) || 0) + 1);
  }
  const catRank = (c: string) => (c === 'new' ? 0 : c === 'indeterminate' ? 1 : c === 'done' ? 2 : 3);
  const rows = [...statuses.values()].sort((a, b) => catRank(a.category) - catRank(b.category) || a.name.localeCompare(b.name));
  const types = [...typeSet].sort((a, b) => a.localeCompare(b));
  const cell = (status: string, type: string) => counts.get(status)?.get(type) || 0;
  const rowTotal = (status: string) => types.reduce((n, ty) => n + cell(status, ty), 0);
  const colTotal = (type: string) => rows.reduce((n, s) => n + cell(s.name, type), 0);
  return { rows, types, cell, rowTotal, colTotal, total: tickets.length };
}

const isEpic = (t: JiraTicket) => /^epic$/i.test(t.type || '');

// Count epics per assignee (rows), highest first, Unassigned last.
function epicsByAssignee(epics: JiraTicket[]) {
  const map = new Map<string, number>();
  for (const t of epics) { const who = t.assignee || 'Unassigned'; map.set(who, (map.get(who) || 0) + 1); }
  const rows = [...map.entries()].sort((a, b) => {
    if (a[0] === 'Unassigned') return 1;
    if (b[0] === 'Unassigned') return -1;
    return b[1] - a[1] || a[0].localeCompare(b[0]);
  });
  return { rows, total: epics.length };
}

// Pivot a release's tickets into an assignee (rows) × type (columns) matrix of
// ticket count + summed story points.
function pivotByAssigneeType(tickets: JiraTicket[]) {
  const typeSet = new Set<string>();
  const assigneeSet = new Set<string>();
  const counts = new Map<string, Map<string, { count: number; sp: number }>>(); // assignee -> type -> {count,sp}
  for (const t of tickets) {
    const type = t.type || '—';
    const who = t.assignee || 'Unassigned';
    typeSet.add(type);
    assigneeSet.add(who);
    if (!counts.has(who)) counts.set(who, new Map());
    const row = counts.get(who)!;
    const prev = row.get(type) || { count: 0, sp: 0 };
    row.set(type, { count: prev.count + 1, sp: prev.sp + (t.storyPoints || 0) });
  }
  const types = [...typeSet].sort((a, b) => a.localeCompare(b));
  // Unassigned last; otherwise by descending ticket count then name.
  const totalFor = (who: string) => types.reduce((n, ty) => n + (counts.get(who)?.get(ty)?.count || 0), 0);
  const rows = [...assigneeSet].sort((a, b) => {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return totalFor(b) - totalFor(a) || a.localeCompare(b);
  });
  const cell = (who: string, type: string) => counts.get(who)?.get(type) || { count: 0, sp: 0 };
  const rowTotal = (who: string) => types.reduce((acc, ty) => { const c = cell(who, ty); return { count: acc.count + c.count, sp: acc.sp + c.sp }; }, { count: 0, sp: 0 });
  const colTotal = (type: string) => rows.reduce((acc, who) => { const c = cell(who, type); return { count: acc.count + c.count, sp: acc.sp + c.sp }; }, { count: 0, sp: 0 });
  const grand = { count: tickets.length, sp: tickets.reduce((n, t) => n + (t.storyPoints || 0), 0) };
  return { rows, types, cell, rowTotal, colTotal, grand };
}

// Side-by-side parent/child plan view. Reuses the exact /plans split (ListsPage in
// embedded mode) so the agent view is identical to the Plans page.
function AgentSplitView({ who, parentListId, childListId, parentName, childName }: { who: string; parentListId: string; childListId: string; parentName: string; childName: string }) {
  const lists = useOKRStore((s: OKRStore) => s.lists);
  const exists = lists.some(l => l.id === parentListId);
  return (
    <div>
      <p className="mb-1">Side-by-side for {who}: <span className="font-medium">{parentName}</span> (parent) and <span className="font-medium">{childName}</span> (child)</p>
      {exists ? (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <ListsPage embedded forcedListId={parentListId} forcedChildListId={childListId} onViewChange={() => {}} />
        </div>
      ) : (
        <p className="text-gray-500">This plan is no longer available.</p>
      )}
    </div>
  );
}

// Interactive parent picker for "Add a deliverable": shows the objectives owned by
// the current user and assigned to the chosen user as a tree. Hovering an item
// reveals "+ Child" (quick-add a child to build structure) and "Select parent"
// (place the deliverable under that item). Only interactive while `active`.
function AgentDeliverablePicker({ draft, active, onSelect, onCancel }: {
  draft: { summary: string; neededBy: string; assigneeId: string; assigneeName: string; ownerId: string };
  active: boolean;
  onSelect: (parent: Objective | null) => void;
  onCancel: () => void;
}) {
  const objectives = useOKRStore((s: OKRStore) => s.objectives);
  const addObjective = useOKRStore((s: OKRStore) => s.addObjective);
  const { user, organization } = useAuth();
  const matching = useMemo(
    () => objectives.filter((o: Objective) => o.ownerId === draft.ownerId && o.assigneeId === draft.assigneeId),
    [objectives, draft.ownerId, draft.assigneeId]
  );
  const matchingIds = useMemo(() => new Set(matching.map((o: Objective) => o.id)), [matching]);
  const childrenOf = (parentId: string | null): Objective[] =>
    matching
      .filter((o: Objective) => (parentId === null ? (!o.parentId || !matchingIds.has(o.parentId)) : o.parentId === parentId))
      .sort((a: Objective, b: Objective) => a.title.localeCompare(b.title));

  const addChild = async (parent: Objective) => {
    const title = window.prompt(`Title for a new child under "${parent.title}":`);
    if (!title || !title.trim()) return;
    await addObjective({
      title: title.trim(),
      level: parent.level,
      parentId: parent.id,
      ownerId: draft.ownerId,
      assigneeId: draft.assigneeId,
      periodId: parent.periodId,
      workflowStatus: 'todo',
    }, { orgId: organization?.id || '', userEmail: user?.email || '', shared: true });
  };

  const renderNode = (o: Objective, depth: number): React.ReactNode => (
    <div key={o.id}>
      <div className="group flex items-center gap-2 py-1 pr-2 rounded hover:bg-gray-50" style={{ paddingLeft: 8 + depth * 16 }}>
        <span className="flex-1 truncate text-sm text-gray-800" title={o.title}>{o.title}</span>
        {active && (
          <span className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <button onClick={() => addChild(o)} className="text-[11px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100" title="Add a child under this item">+ Child</button>
            <button onClick={() => onSelect(o)} className="text-[11px] px-1.5 py-0.5 rounded border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100" title="Use this item as the parent">Select parent</button>
          </span>
        )}
      </div>
      {childrenOf(o.id).map(k => renderNode(k, depth + 1))}
    </div>
  );

  const roots = childrenOf(null);
  return (
    <div className="border border-gray-200 rounded-lg p-2 bg-white">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-sm">Select a parent for <span className="font-medium">&ldquo;{draft.summary}&rdquo;</span> <span className="text-gray-400">· assignee: {draft.assigneeName}{draft.neededBy ? ` · by ${draft.neededBy}` : ''}</span></p>
        {active && <button onClick={onCancel} className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 flex-shrink-0">Cancel</button>}
      </div>
      {roots.length === 0 ? (
        <p className="text-xs text-gray-400 px-2 py-1">No objectives owned by you and assigned to {draft.assigneeName} yet — add one at the top level.</p>
      ) : (
        <div>{roots.map(r => renderNode(r, 0))}</div>
      )}
      {active && (
        <div className="mt-1 pt-1 border-t border-gray-100">
          <button onClick={() => onSelect(null)} className="text-[11px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100" title="Add the deliverable at the top level (no parent)">+ Add at top level (no parent)</button>
        </div>
      )}
      {!active && <p className="text-[11px] text-gray-400 mt-1 italic">Picker closed.</p>}
    </div>
  );
}

// Renders an already-filtered set of objectives using the Objectives-page tree
// component (no filter panel). Memoizes the id set so it's stable across renders.
// Per-question column memory: when `code` is set, the visible-column selection
// is remembered in localStorage under that question's code and reused for every
// objective tree rendered in response to that question. Without a code, the tree
// uses the global column selection.
function AgentObjectiveTree({ ids, code }: { ids: string[]; code?: string }) {
  const restrict = useMemo(() => new Set(ids), [ids]);
  const globalCols = useOKRStore((s: OKRStore) => s.visibleColumns);
  const storeKey = code ? `okr-agent-cols-${code}` : '';
  const [cols, setCols] = useState<ColumnKey[] | null>(() => {
    if (!storeKey) return null;
    try { const v = localStorage.getItem(storeKey); return v ? JSON.parse(v) as ColumnKey[] : null; } catch { return null; }
  });
  if (!code) return <ObjectiveTree restrictIds={restrict} hideFilters />;
  const effCols = cols ?? globalCols;
  const toggle = (col: ColumnKey) => {
    if (col === 'title') return;
    setCols(prev => {
      const base = prev ?? globalCols;
      const next = base.includes(col) ? base.filter(c => c !== col) : [...base, col];
      try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  return <ObjectiveTree restrictIds={restrict} hideFilters columnsOverride={effCols} onToggleColumn={toggle} />;
}

const rootPromptMsg = (): Msg => menuMsg("Hi — I'm your OKR agent. Type the number of an option:", ROOT_OPTIONS);
const initialState = (): SessionState => ({ step: 'root', selectedUserId: '', durationType: '', resultPeriodId: '', resultObjectiveIds: [], vpTargetId: '', vpEachIndex: 0, resultPlanId: '', planChoiceIds: [], durationGroupBaseIds: [], durationGroups: [] });

function fmtDate(d?: string): string {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(iso?: string): string {
  if (!iso) return '';
  const dt = new Date(iso);
  return isNaN(dt.getTime()) ? '' : dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function periodLabel(p: { name: string; startDate?: string; endDate?: string }): string {
  const range = [fmtDate(p.startDate), fmtDate(p.endDate)].filter(Boolean).join(' – ');
  return range ? `${p.name} (${range})` : p.name;
}

function renderMsg(m: Msg): React.ReactNode {
  if (m.role === 'user') return <>{m.text}</>;
  switch (m.kind) {
    case 'text':
      return <span className={m.tone === 'error' ? 'text-red-600' : undefined}>{m.text}</span>;
    case 'menu':
      return (
        <div>
          <p className="mb-1">
            {m.title} <span className="text-xs text-gray-400 font-mono">[{m.code || questionCode(m.title)}]</span>
          </p>
          <ol className="space-y-0.5">
            {m.options.map((o, i) => (
              <li key={i} className={i >= m.baseCount ? 'text-gray-500' : undefined}>
                <span className="text-gray-400 tabular-nums">{i + 1}.</span> {o}
              </li>
            ))}
          </ol>
        </div>
      );
    case 'plan':
      return (
        <div>
          <p>
            Plan <span className="font-medium">{m.planName}</span> for <span className="font-medium">{m.who}</span> · <span className="font-medium">{m.period}</span>
            {' '}— {m.items.length} {m.items.length === 1 ? 'item' : 'items'}:
          </p>
          {m.items.length > 0 ? (
            <>
              <div className="mt-1"><AgentObjectiveTree ids={m.items.map(it => it.id)} code={m.code} /></div>
              <p className="mt-1 text-sm font-medium">Total {m.total} VP <span className="text-gray-500 font-normal ml-2">Items: {m.items.length}</span></p>
            </>
          ) : (
            <p className="text-gray-500 mt-1">This plan has no items yet.</p>
          )}
        </div>
      );
    case 'children':
      return (
        <div>
          <p>Children of "{m.parent}" ({m.items.length}):</p>
          <ObjTable
            columns={[
              { key: 'idx', label: '#', width: 36 },
              { key: 'title', label: 'Objective', width: 220 },
              { key: 'duration', label: 'Duration', width: 150, edit: 'duration' },
              { key: 'status', label: 'Status', width: 140, edit: 'status' },
              { key: 'vp', label: 'VP', width: 90, align: 'right', edit: 'vp' },
            ]}
            rows={m.items.map((c, i) => ({ _id: c.id, idx: `${i + 1}.`, title: c.title }))}
          />
        </div>
      );
    case 'plans':
      return (
        <div>
          <p>{m.who}'s plans{m.filter ? ` · ${m.filter}` : ''} ({m.items.length}):</p>
          {m.items.length > 0 ? (
            <table className="mt-1 text-sm">
              <thead>
                <tr className="text-xs text-gray-400 text-left">
                  <th className="py-1 pr-4 font-medium"></th>
                  <th className="py-1 pr-6 font-medium">Name</th>
                  <th className="py-1 pr-6 font-medium">Type</th>
                  <th className="py-1 pr-6 font-medium">Period</th>
                  <th className="py-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {m.items.map((it, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className="py-1 pr-4 text-gray-400 tabular-nums align-top">{i + 1}.</td>
                    <td className="py-1 pr-6 text-gray-800">{it.name}</td>
                    <td className="py-1 pr-6 text-gray-600">{it.type}</td>
                    <td className="py-1 pr-6 text-gray-500">{it.period}</td>
                    <td className="py-1"><EditableListStatus listId={it.id} fallback={it.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-gray-500 mt-1">No plans.</p>
          )}
        </div>
      );
    case 'family':
      return (
        <div>
          <p>Context for "{m.subject}":</p>
          <table className="mt-1 text-sm">
            <thead>
              <tr className="text-xs text-gray-400 text-left">
                <th className="py-1 pr-4 font-medium"></th>
                <th className="py-1 pr-4 font-medium">Item</th>
                <th className="py-1 pr-4 font-medium">Duration</th>
                <th className="py-1 pr-4 font-medium">VP</th>
                <th className="py-1 pr-4 font-medium">Owner</th>
                <th className="py-1 font-medium">Assignee</th>
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r, i) => (
                <tr key={i} className={`border-b border-gray-100 last:border-0 ${r.self ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
                  <td className="py-1 pr-4 text-gray-400">{r.rel}</td>
                  <td className="py-1 pr-4">{r.name}</td>
                  <td className="py-1 pr-4 text-gray-600">{r.duration}</td>
                  <td className="py-1 pr-4 tabular-nums">{r.vp}</td>
                  <td className="py-1 pr-4 text-gray-600">{r.owner}</td>
                  <td className="py-1 text-gray-600">{r.assignee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'objlist':
      return (
        <div>
          <p className="mb-1">{m.title} ({(m.ids || ((m as { items?: { id: string }[] }).items || []).map(it => it.id)).length}):</p>
          {(() => {
            const ids = m.ids || ((m as { items?: { id: string }[] }).items || []).map(it => it.id);
            return ids.length > 0 ? <AgentObjectiveTree ids={ids} code={m.code} /> : <p className="text-gray-500">None.</p>;
          })()}
        </div>
      );
    case 'split':
      return <AgentSplitView who={m.who} parentListId={m.parentListId} childListId={m.childListId} parentName={m.parentName} childName={m.childName} />;
    case 'breakdown':
      return (
        <div>
          <p className="mb-1">{m.title}:</p>
          <table className="mt-1 text-sm">
            <thead>
              <tr className="text-xs text-gray-400 text-left">
                <th className="py-1 pr-6 font-medium">Assignee</th>
                <th className="py-1 pr-6 font-medium text-right">Items</th>
                <th className="py-1 font-medium text-right">VP</th>
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0">
                  <td className="py-1 pr-6 text-gray-800">{r.name}</td>
                  <td className="py-1 pr-6 text-gray-600 text-right tabular-nums">{r.count}</td>
                  <td className="py-1 text-gray-600 text-right tabular-nums">{r.vp}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-1 pr-6">Total</td>
                <td className="py-1 pr-6 text-right tabular-nums">{m.totalCount}</td>
                <td className="py-1 text-right tabular-nums">{m.totalVp}</td>
              </tr>
            </tbody>
          </table>
        </div>
      );
    case 'resolvedWeekly':
      return (
        <div>
          <p className="mb-1">{m.title}</p>
          <p className="text-xs text-gray-400 mb-1">Resolved in the last {m.days} days · Story / Bug / Sub-task by assignee · as of {m.asOf}</p>
          {m.rows.length === 0 ? (
            <p className="text-gray-500 text-sm">Nothing resolved in the last {m.days} days.</p>
          ) : (
            <table className="mt-1 text-sm">
              <thead>
                <tr className="text-xs text-gray-400 text-left">
                  <th className="py-1 pr-6 font-medium">Assignee</th>
                  <th className="py-1 pr-6 font-medium text-right">Tickets resolved</th>
                  <th className="py-1 font-medium text-right">Story points</th>
                </tr>
              </thead>
              <tbody>
                {m.rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className="py-1 pr-6 text-gray-800">{r.name}</td>
                    <td className="py-1 pr-6 text-gray-600 text-right tabular-nums">{r.count}</td>
                    <td className="py-1 text-gray-600 text-right tabular-nums">{r.sp}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="py-1 pr-6">Total</td>
                  <td className="py-1 pr-6 text-right tabular-nums">{m.totalCount}</td>
                  <td className="py-1 text-right tabular-nums">{m.totalSp}</td>
                </tr>
              </tbody>
            </table>
          )}
          {(m.parentRows?.length ?? 0) > 0 && (() => {
            const pv = pivotParents(m.parentRows);
            const parentCell = (p: { key: string; summary: string; url: string }) =>
              p.key === 'None' ? <span className="text-gray-400">None</span> : (
                <>
                  {p.url
                    ? <a href={p.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium">{p.key}</a>
                    : <span className="font-medium">{p.key}</span>}
                  {p.summary ? <span className="text-gray-500"> — {p.summary}</span> : null}
                </>
              );
            const matrix = (label: string, at: (p: string, a: string) => number, rowTot: (p: string) => number, colTot: (a: string) => number, grand: number) => (
              <div className="mt-3">
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <div className="overflow-x-auto">
                  <table className="text-sm border-collapse">
                    <thead>
                      <tr className="text-xs text-gray-400 text-left">
                        <th className="py-1 pr-6 font-medium">Parent issue</th>
                        {pv.assignees.map(a => <th key={a} className="py-1 px-3 font-medium text-right">{a}</th>)}
                        <th className="py-1 pl-3 font-medium text-right border-l border-gray-200">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pv.parents.map(p => (
                        <tr key={p.key} className="border-t border-gray-100">
                          <td className="py-1 pr-6 text-gray-700 whitespace-nowrap">{parentCell(p)}</td>
                          {pv.assignees.map(a => { const v = at(p.key, a); return <td key={a} className={`py-1 px-3 text-right tabular-nums ${v ? 'text-gray-700' : 'text-gray-300'}`}>{v || '·'}</td>; })}
                          <td className="py-1 pl-3 text-right tabular-nums font-medium border-l border-gray-200">{rowTot(p.key)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-300 font-medium">
                        <td className="py-1 pr-6">Total</td>
                        {pv.assignees.map(a => <td key={a} className="py-1 px-3 text-right tabular-nums">{colTot(a)}</td>)}
                        <td className="py-1 pl-3 text-right tabular-nums border-l border-gray-200">{grand}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
            return (
              <div className="mt-3">
                {matrix('Ticket count · parent issue (rows) × assignee (columns)', pv.count, pv.parentCount, pv.aCount, pv.grandCount)}
                {matrix('Story points · parent issue (rows) × assignee (columns)', pv.sp, pv.parentSp, pv.aSp, pv.grandSp)}
                <div className="mt-3">
                  <p className="text-xs text-gray-400 mb-1">By parent issue</p>
                  <div className="overflow-x-auto">
                    <table className="text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 text-left">
                          <th className="py-1 pr-6 font-medium">Parent issue</th>
                          <th className="py-1 pr-6 font-medium text-right">Issues</th>
                          <th className="py-1 font-medium text-right">Story points</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pv.parents.map(p => (
                          <tr key={p.key} className="border-b border-gray-100 last:border-0">
                            <td className="py-1 pr-6 text-gray-700 whitespace-nowrap">{parentCell(p)}</td>
                            <td className="py-1 pr-6 text-gray-600 text-right tabular-nums">{pv.parentCount(p.key)}</td>
                            <td className="py-1 text-gray-600 text-right tabular-nums">{pv.parentSp(p.key)}</td>
                          </tr>
                        ))}
                        <tr className="font-medium">
                          <td className="py-1 pr-6">Total</td>
                          <td className="py-1 pr-6 text-right tabular-nums">{pv.grandCount}</td>
                          <td className="py-1 text-right tabular-nums">{pv.grandSp}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      );
    case 'releases': {
      // Tolerate older persisted messages that predate some of these fields.
      const groups = m.groups ?? [];
      const recent = m.recent ?? [];
      const cols = m.columns ?? [];
      const total = groups.reduce((s, g) => s + (g.items?.length ?? 0), 0);
      const groupTable = (key: string, label: string, items: ReleaseItem[]) => (
        <div key={key} className="mt-2">
          <p className="text-sm font-medium text-gray-700">{label} ({items.length})</p>
          <div className="overflow-x-auto">
            <table className="mt-1 text-sm">
              <thead>
                <tr className="text-xs text-gray-400 text-left">
                  {cols.map((c, i) => <th key={i} className="py-1 pr-6 font-medium">{c}</th>)}
                  <th className="py-1 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    {cols.map((c, ci) => (
                      <td key={ci} className={`py-1 pr-6 ${ci === 0 ? 'text-gray-800 font-medium' : 'text-gray-600'}`}>{it.fields[c] || ''}</td>
                    ))}
                    <td className="py-1 text-gray-500">{it.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
      return (
        <div>
          <p className="mb-1">
            {m.area} · <span className="font-medium">{m.sheetTitle || 'Release Calendar'}</span>
            {' '}— {total} {total === 1 ? 'release' : 'releases'} in focus
            <span className="text-gray-400 text-xs ml-2">as of {m.asOf}</span>
          </p>
          {m.note && <p className="text-amber-600 text-xs mb-1">{m.note}</p>}
          {total === 0 && !m.note && (
            <p className="text-gray-500">Nothing in progress, recently shipped, or due in the next 30 days.</p>
          )}
          {groups.map(g => groupTable(g.key, g.label, g.items ?? []))}
          {/* Fallback context when nothing is in focus: the most recent releases. */}
          {total === 0 && !m.note && recent.length > 0 &&
            groupTable('recent', `Last ${recent.length} release${recent.length === 1 ? '' : 's'}`, recent)}
          {/* When column detection failed, show the raw sheet so nothing is hidden. */}
          {m.note && m.rawHeaders && m.rawRows && (
            <div className="overflow-x-auto mt-2">
              <table className="text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 text-left">
                    {m.rawHeaders.map((h, i) => <th key={i} className="py-1 pr-6 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {m.rawRows.slice(0, 25).map((r, ri) => (
                    <tr key={ri} className="border-b border-gray-100 last:border-0">
                      {m.rawHeaders!.map((_, ci) => <td key={ci} className="py-1 pr-6 text-gray-600">{r[ci] || ''}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }
    case 'jira': {
      const totalTickets = m.groups.reduce((s, g) => s + g.tickets.length, 0);
      return (
        <div>
          <p className="mb-1">
            Jira tickets in the in-progress releases — {totalTickets} {totalTickets === 1 ? 'ticket' : 'tickets'} across {m.groups.length} {m.groups.length === 1 ? 'release' : 'releases'}
            {m.project ? <span className="text-gray-400 text-xs ml-2">project {m.project}</span> : null}
          </p>
          {m.jql && (
            <p className="text-[11px] text-gray-400 font-mono mb-1 break-all">JQL: {m.jql}</p>
          )}
          {m.unknown.length > 0 && (
            <p className="text-amber-600 text-xs mb-1">
              No matching Jira fix version for: {m.unknown.join(', ')} — skipped.
            </p>
          )}
          {(() => { const asOf = m.asOf || Date.now(); const weekAgo = asOf - 7 * 24 * 60 * 60 * 1000;
          return m.groups.map(g => {
            const epics = g.tickets.filter(isEpic);
            const nonEpics = g.tickets.filter(t => !isEpic(t));
            const p = pivotByStatusType(g.tickets);
            const a = pivotByAssigneeType(nonEpics); // epics excluded from count/SP by assignee
            const ep = epicsByAssignee(epics);
            // Story/Bug/Sub-task resolved within the last 7 days.
            const recent = g.tickets.filter(t => isWorkItem(t) && t.resolved && Date.parse(t.resolved) >= weekAgo);
            const rr = countAndSpByAssignee(recent);
            return (
              <div key={g.version} className="mt-3">
                <p className="text-sm font-medium text-gray-700">{g.version} ({g.tickets.length})</p>
                {g.tickets.length === 0 ? (
                  <p className="text-gray-500 text-sm">No tickets in this release.</p>
                ) : (
                  <>
                    <p className="text-xs text-gray-400 mt-1">Tickets by status × type</p>
                    <div className="overflow-x-auto">
                      <table className="mt-0.5 text-sm border-collapse">
                        <thead>
                          <tr className="text-xs text-gray-500">
                            <th className="py-1 pr-4 font-medium text-left">Status \ Type</th>
                            {p.types.map(ty => <th key={ty} className="py-1 px-3 font-medium text-right">{ty}</th>)}
                            <th className="py-1 pl-3 font-medium text-right border-l border-gray-200">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.rows.map(s => (
                            <tr key={s.name} className="border-t border-gray-100">
                              <td className="py-1 pr-4 text-gray-800 whitespace-nowrap">{s.name}</td>
                              {p.types.map(ty => {
                                const n = p.cell(s.name, ty);
                                return <td key={ty} className={`py-1 px-3 text-right tabular-nums ${n ? 'text-gray-700' : 'text-gray-300'}`}>{n || '·'}</td>;
                              })}
                              <td className="py-1 pl-3 text-right tabular-nums font-medium border-l border-gray-200">{p.rowTotal(s.name)}</td>
                            </tr>
                          ))}
                          <tr className="border-t border-gray-300 font-medium">
                            <td className="py-1 pr-4 text-right">Total</td>
                            {p.types.map(ty => <td key={ty} className="py-1 px-3 text-right tabular-nums">{p.colTotal(ty)}</td>)}
                            <td className="py-1 pl-3 text-right tabular-nums border-l border-gray-200">{p.total}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {(['count', 'sp'] as const).map(metric => (
                      <div key={metric}>
                        <p className="text-xs text-gray-400 mt-2">{metric === 'count' ? 'Ticket count' : 'Story points'} by assignee × type <span className="text-gray-300">(excl. epics)</span></p>
                        <div className="overflow-x-auto">
                          <table className="mt-0.5 text-sm border-collapse">
                            <thead>
                              <tr className="text-xs text-gray-500">
                                <th className="py-1 pr-4 font-medium text-left">Assignee \ Type</th>
                                {a.types.map(ty => <th key={ty} className="py-1 px-3 font-medium text-right">{ty}</th>)}
                                <th className="py-1 pl-3 font-medium text-right border-l border-gray-200">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {a.rows.map(who => (
                                <tr key={who} className="border-t border-gray-100">
                                  <td className="py-1 pr-4 text-gray-800 whitespace-nowrap">{who}</td>
                                  {a.types.map(ty => {
                                    const v = a.cell(who, ty)[metric];
                                    return <td key={ty} className={`py-1 px-3 text-right tabular-nums ${v ? 'text-gray-700' : 'text-gray-300'}`}>{v || '·'}</td>;
                                  })}
                                  <td className="py-1 pl-3 text-right tabular-nums font-medium border-l border-gray-200">{a.rowTotal(who)[metric]}</td>
                                </tr>
                              ))}
                              <tr className="border-t border-gray-300 font-medium">
                                <td className="py-1 pr-4 text-right">Total</td>
                                {a.types.map(ty => <td key={ty} className="py-1 px-3 text-right tabular-nums">{a.colTotal(ty)[metric]}</td>)}
                                <td className="py-1 pl-3 text-right tabular-nums border-l border-gray-200">{a.grand[metric]}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}

                    <p className="text-xs text-gray-400 mt-2">Epics by assignee {epics.length === 0 && <span className="text-gray-300">(none)</span>}</p>
                    {epics.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="mt-0.5 text-sm border-collapse">
                          <thead>
                            <tr className="text-xs text-gray-500">
                              <th className="py-1 pr-6 font-medium text-left">Assignee</th>
                              <th className="py-1 font-medium text-right">Epics</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ep.rows.map(([who, n]) => (
                              <tr key={who} className="border-t border-gray-100">
                                <td className="py-1 pr-6 text-gray-800 whitespace-nowrap">{who}</td>
                                <td className="py-1 text-right tabular-nums text-gray-700">{n}</td>
                              </tr>
                            ))}
                            <tr className="border-t border-gray-300 font-medium">
                              <td className="py-1 pr-6 text-right">Total</td>
                              <td className="py-1 text-right tabular-nums">{ep.total}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    <p className="text-xs text-gray-400 mt-2">Resolved in the last 7 days · Story / Bug / Sub-task by assignee</p>
                    {recent.length === 0 ? (
                      <p className="text-gray-500 text-sm">Nothing resolved in the last 7 days.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="mt-0.5 text-sm border-collapse">
                          <thead>
                            <tr className="text-xs text-gray-500">
                              <th className="py-1 pr-6 font-medium text-left">Assignee</th>
                              <th className="py-1 pr-6 font-medium text-right">Tickets</th>
                              <th className="py-1 font-medium text-right">Story points</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rr.rows.map(([who, v]) => (
                              <tr key={who} className="border-t border-gray-100">
                                <td className="py-1 pr-6 text-gray-800 whitespace-nowrap">{who}</td>
                                <td className="py-1 pr-6 text-right tabular-nums text-gray-700">{v.count}</td>
                                <td className="py-1 text-right tabular-nums text-gray-700">{v.sp}</td>
                              </tr>
                            ))}
                            <tr className="border-t border-gray-300 font-medium">
                              <td className="py-1 pr-6 text-right">Total</td>
                              <td className="py-1 pr-6 text-right tabular-nums">{rr.total.count}</td>
                              <td className="py-1 text-right tabular-nums">{rr.total.sp}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          });
          })()}
        </div>
      );
    }
    default:
      return null;
  }
}

// Plan stages are org-level config; cache the fetch so each status cell doesn't refetch.
let planStagesCache: string[] | null = null;
function usePlanStages(): string[] {
  const [stages, setStages] = useState<string[]>(planStagesCache || []);
  useEffect(() => {
    if (planStagesCache) return;
    let active = true;
    fetch(`${API_URL}/api/plan-stages`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { stages: [] }))
      .then(d => { planStagesCache = d.stages || []; if (active) setStages(planStagesCache!); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return stages;
}

// Inline editor for a plan's status, bound to the live list. Writes through setListStatus.
function EditableListStatus({ listId, fallback }: { listId: string; fallback?: string }) {
  const list = useOKRStore((s: OKRStore) => s.lists.find(l => l.id === listId));
  const setListStatus = useOKRStore((s: OKRStore) => s.setListStatus);
  const stages = usePlanStages();
  const value = list?.status ?? fallback ?? '';
  return (
    <select
      value={value}
      onChange={(e) => setListStatus(listId, e.target.value)}
      className="border border-gray-300 rounded px-1 py-0.5 text-xs bg-white"
    >
      {!value && <option value="">—</option>}
      {stages.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

// An inline editor bound to a live objective: number input for VP, selects for
// status and duration. Writes through updateObjective.
function EditableCell({ type, id }: { type: 'vp' | 'status' | 'duration'; id: string }) {
  const obj = useOKRStore((s: OKRStore) => s.objectives.find(o => o.id === id));
  const periods = useOKRStore((s: OKRStore) => s.periods);
  const updateObjective = useOKRStore((s: OKRStore) => s.updateObjective);
  const { user } = useAuth();
  const email = user?.email || '';
  if (!obj) return <span className="text-gray-300">—</span>;
  const cls = 'w-full bg-transparent border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-1 py-0.5 text-sm focus:outline-none';
  if (type === 'vp') {
    // Uncontrolled + key so external VP changes re-seed the input without an effect.
    return (
      <input
        key={obj.valuePoints ?? 0}
        type="number"
        min={0}
        defaultValue={obj.valuePoints ?? 0}
        onBlur={e => { const v = Number(e.currentTarget.value); if (Number.isFinite(v) && v >= 0 && v !== (obj.valuePoints ?? 0)) updateObjective(id, { valuePoints: v }, email); }}
        onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
        className={`${cls} text-right tabular-nums`}
      />
    );
  }
  if (type === 'status') {
    return (
      <select value={obj.workflowStatus} onChange={e => updateObjective(id, { workflowStatus: e.target.value as WorkflowStatus }, email)} className={cls}>
        {Object.entries(WORKFLOW_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    );
  }
  return (
    <select value={obj.periodId || ''} onChange={e => updateObjective(id, { periodId: e.target.value }, email)} className={cls}>
      {[...periods].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '')).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

interface ObjColumn { key: string; label: string; width: number; align?: 'right'; edit?: 'vp' | 'status' | 'duration'; }

// A fixed-layout table with a header and drag-to-resize columns. Each instance
// manages its own column widths.
function ObjTable({ columns, rows }: { columns: ObjColumn[]; rows: (Record<string, React.ReactNode> & { _id?: string })[] }) {
  const [widths, setWidths] = useState<number[]>(() => columns.map(c => c.width));
  const drag = useRef<{ i: number; x: number; w: number } | null>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      setWidths(ws => { const n = [...ws]; n[d.i] = Math.max(40, d.w + (e.clientX - d.x)); return n; });
    };
    const up = () => { if (drag.current) { drag.current = null; document.body.style.cursor = ''; } };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  return (
    <div className="overflow-x-auto mt-1">
      <table className="text-sm border-collapse" style={{ tableLayout: 'fixed', width: widths.reduce((a, b) => a + b, 0) }}>
        <colgroup>{columns.map((c, i) => <col key={c.key} style={{ width: widths[i] }} />)}</colgroup>
        <thead>
          <tr className="text-xs text-gray-500 border-b border-gray-200">
            {columns.map((c, i) => (
              <th key={c.key} className={`relative py-1 px-2 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                <div className="truncate">{c.label}</div>
                <span
                  onMouseDown={(e) => { drag.current = { i, x: e.clientX, w: widths[i] }; document.body.style.cursor = 'col-resize'; e.preventDefault(); }}
                  className="absolute -right-px top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400"
                  title="Drag to resize"
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-gray-100 last:border-0">
              {columns.map(c => (
                <td key={c.key} className={`py-1 px-2 align-top ${c.align === 'right' ? 'text-right tabular-nums whitespace-nowrap' : ''}`}>
                  {c.edit && r._id ? <EditableCell type={c.edit} id={r._id} /> : <div className="truncate">{r[c.key]}</div>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Guards a single chat message: a malformed/old persisted message renders a
// small fallback instead of blanking the whole transcript.
class MsgBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <span className="text-gray-400 text-xs">[unable to display this message]</span>
      : this.props.children;
  }
}

// Renders one message via renderMsg. Calling renderMsg inside a child component
// (rather than eagerly as MsgBoundary's children) ensures any error it throws
// happens within the boundary's subtree, so MsgBoundary actually catches it.
function RenderedMsg({ m }: { m: Msg }) {
  return <>{renderMsg(m)}</>;
}

export function AgentPage() {
  const { user, organization, login } = useAuth();
  const userEmail = user?.email || '';
  const orgId = organization?.id || '';

  const addObjective = useOKRStore((s: OKRStore) => s.addObjective);
  const lists = useOKRStore((s: OKRStore) => s.lists);
  const sharedPlans = useOKRStore((s: OKRStore) => s.sharedPlans);
  const periods = useOKRStore((s: OKRStore) => s.periods);
  const fetchSharedPlans = useOKRStore((s: OKRStore) => s.fetchSharedPlans);
  const updateObjective = useOKRStore((s: OKRStore) => s.updateObjective);
  const setShowListMembership = useOKRStore((s: OKRStore) => s.setShowListMembership);
  const setListMembershipListId = useOKRStore((s: OKRStore) => s.setListMembershipListId);

  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeId, setActiveId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showSessions, setShowSessions] = useState<boolean>(() => {
    try { return localStorage.getItem('okr-agent-show-sessions') !== 'false'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('okr-agent-show-sessions', String(showSessions)); } catch { /* ignore */ }
  }, [showSessions]);
  const [sessionTitle, setSessionTitle] = useState('New chat');

  const [step, setStep] = useState<Step>('root');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [durationType, setDurationType] = useState<string>('');
  const [resultPeriodId, setResultPeriodId] = useState('');
  const [resultObjectiveIds, setResultObjectiveIds] = useState<string[]>([]);
  const [vpTargetId, setVpTargetId] = useState('');
  const [vpEachIndex, setVpEachIndex] = useState(0);
  const [resultPlanId, setResultPlanId] = useState('');
  const [planChoiceIds, setPlanChoiceIds] = useState<string[]>([]);
  const [durationGroupBaseIds, setDurationGroupBaseIds] = useState<string[]>([]);
  const [durationGroups, setDurationGroups] = useState<{ periodId: string; label: string; count: number }[]>([]);
  const [input, setInput] = useState('');
  // Seed with the opening prompt so the chat is never blank, even before a
  // session loads or if the sessions API is unreachable.
  const [transcript, setTranscript] = useState<Msg[]>(() => [rootPromptMsg()]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Code of the question the user is currently answering — tagged onto any
  // objective tree rendered as a result, so columns can be remembered per question.
  const answeredCodeRef = useRef('');

  const usersSorted = useMemo(
    () => [...orgUsers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)),
    [orgUsers]
  );
  const currentUserId = useMemo(
    () => orgUsers.find(u => u.email?.toLowerCase() === userEmail.toLowerCase())?.id || '',
    [orgUsers, userEmail]
  );
  // Draft for the "Add a deliverable" flow.
  const [delivSummary, setDelivSummary] = useState('');
  const [delivNeededBy, setDelivNeededBy] = useState('');
  // Ephemeral state for the Jira project picker (when the default project isn't found).
  const [jiraProjects, setJiraProjects] = useState<{ key: string; name: string }[]>([]);
  const [pendingJiraVersions, setPendingJiraVersions] = useState<string[]>([]);
  const periodsSorted = useMemo(
    () => [...periods].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '') || a.name.localeCompare(b.name)),
    [periods]
  );
  const allPlans = useMemo(() => {
    const byId = new Map<string, List>();
    [...lists, ...sharedPlans].forEach(l => { if (l.ownerId && l.periodId) byId.set(l.id, l); });
    return Array.from(byId.values());
  }, [lists, sharedPlans]);

  const periodsOfType = (type: string) => {
    const today = new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd, local
    return periodsSorted.filter(p => p.type === type && (!p.endDate || p.endDate >= today));
  };

  // Per-option plan counts matching the selection funnel so far.
  const planCount = (predicate: (p: List) => boolean) => allPlans.filter(predicate).length;
  const withCount = (label: string, c: number) => `${label} (${c} ${c === 1 ? 'plan' : 'plans'})`;
  const userOptions = () => usersSorted.map(u => withCount(u.name || u.email, planCount(p => p.ownerId === u.id)));
  // "Open" plans are those whose period is still offered in the duration step
  // (active or upcoming); "closed" plans are in periods that have already ended.
  // Showing both makes clear why the next step lists only the open ones.
  const periodTypeOf = (periodId?: string) => periods.find(p => p.id === periodId)?.type;
  const offeredPeriodIdsOfType = (type: string) => new Set(periodsOfType(type).map(p => p.id));
  const durationTypeOptions = (userId = selectedUserId) => [
    ...DURATION_TYPES.map(d => {
      const ids = offeredPeriodIdsOfType(d.type);
      const ofType = allPlans.filter(p => p.ownerId === userId && periodTypeOf(p.periodId) === d.type);
      const open = ofType.filter(p => p.periodId !== undefined && ids.has(p.periodId)).length;
      const closed = ofType.length - open;
      const parts = [`${open} open`];
      if (closed) parts.push(`${closed} closed`);
      return `${d.label} (${parts.join(', ')})`;
    }),
    withCount('Show all plans and their duration type', planCount(p => p.ownerId === userId)),
  ];
  const durationOptions = (type: string) => periodsOfType(type).map(p => withCount(periodLabel(p), planCount(pl => pl.ownerId === selectedUserId && pl.periodId === p.id)));
  const planStages = usePlanStages();
  const planFilterOptions = () => {
    const owner = (p: List) => p.ownerId === selectedUserId;
    return [
      withCount('All but archived', planCount(p => owner(p) && p.status !== 'Archived')),
      withCount('All statuses', planCount(owner)),
      ...planStages.map(s => withCount(s, planCount(p => owner(p) && p.status === s))),
    ];
  };

  const objTitle = (id: string) => useOKRStore.getState().objectives.find(o => o.id === id)?.title || id;
  const itemLabel = (id: string) => {
    const o = useOKRStore.getState().objectives.find(x => x.id === id);
    return `${o?.title || id} — ${o?.valuePoints ?? 0} VP`;
  };

  const userPrompt = () => menuMsg('Whose OKRs would you like to set? Type the number:', userOptions());
  const durationTypePrompt = (userId = selectedUserId) => menuMsg('What kind of duration? Type the number:', durationTypeOptions(userId));
  const durationPrompt = (type: string) => menuMsg('For which duration? Type the number:', durationOptions(type));
  const planFilterPrompt = () => menuMsg('Filter plans by status, then I\'ll list them. Type the number:', planFilterOptions());
  const planResultsOptions = (ids = planChoiceIds): string[] =>
    ids.length > 0 ? ['Select one of the results', 'Search again for plans'] : ['Search again for plans'];
  const planResultsPrompt = (ids = planChoiceIds) => menuMsg('What would you like to do next? Type the number:', planResultsOptions(ids));
  const planSelectPrompt = () => menuMsg('Select a plan. Type the number:', planChoiceIds.map(planLabel));
  const vpPickPrompt = () => menuMsg('Which item? Type the number:', resultObjectiveIds.map(itemLabel));
  const itemActionPrompt = (id = vpTargetId) => menuMsg(`What would you like to do with "${objTitle(id)}"? Type the number:`, ITEM_ACTIONS);
  const periodChoiceLabel = (p: { name: string; startDate?: string; endDate?: string; type?: string }) => {
    const t = DURATION_TYPES.find(d => d.type === p.type)?.label || (p.type || '');
    return t ? `${periodLabel(p)} · ${t}` : periodLabel(p);
  };
  const changeDurationPrompt = () => menuMsg('Change duration to which period? Type the number:', periodsSorted.map(periodChoiceLabel));
  const vpEachPrompt = (index: number): Msg => {
    const o = useOKRStore.getState().objectives.find(x => x.id === resultObjectiveIds[index]);
    return textMsg(`Item ${index + 1} of ${resultObjectiveIds.length} — type the value points for "${o?.title || resultObjectiveIds[index]}" (currently ${o?.valuePoints ?? 0} VP). (Type b to go back, s to start over, or c to see its children.)`);
  };
  const vpItemPrompt = (title: string): Msg => textMsg(`Type the value points to set on "${title}". (Type b to go back, s to start over, or c to see its children.)`);

  const baseOptions = (s: Step): string[] => {
    switch (s) {
      case 'root': return ROOT_OPTIONS;
      case 'treeBrowse': return TREE_OPTIONS;
      case 'durationGroupPick': return durationGroups.map(durationGroupLabel);
      case 'planMembershipPick': return [...myPlans().map(p => p.name), 'Turn off plan membership'];
      case 'user': return userOptions();
      case 'durationType': return durationTypeOptions();
      case 'planFilter': return planFilterOptions();
      case 'planResults': return planResultsOptions();
      case 'planSelect': return planChoiceIds.map(planLabel);
      case 'duration': return durationOptions(durationType);
      case 'result': return resultObjectiveIds.length > 0 ? RESULT_ACTIONS : [];
      case 'childPlanPick': return childPlansOf(resultPlanId).map(p => planLabel(p.id));
      case 'splitMenu': return ['Show breakdown by assignee', 'Show unassigned items in the child plan', 'Go up to the plan'];
      case 'delivAssignee': return usersSorted.map(u => u.name || u.email);
      case 'delivParent': return [];
      case 'reviewArea': return REVIEW_AREAS;
      case 'settings': return SETTINGS_OPTIONS;
      case 'autonomousActions': return AUTONOMOUS_AREAS;
      case 'autonomousEng': return ENG_AUTONOMOUS_ACTIONS.map(a => a.label);
      case 'jiraProjectPick': return [...jiraProjects.map(p => `${p.key} — ${p.name}`), 'None (skip Jira)'];
      case 'planPick': return planChoiceIds.map(planLabel);
      case 'vpPick': return resultObjectiveIds.map(itemLabel);
      case 'itemAction': return ITEM_ACTIONS;
      case 'changeDuration': return periodsSorted.map(periodChoiceLabel);
      default: return [];
    }
  };

  const appendAgent = (m: Msg) => setTranscript(t => [...t, m]);
  const appendUser = (text: string) => setTranscript(t => [...t, userMsg(text)]);

  // ---- Sessions ----
  const loadSession = (s: AgentSession) => {
    setActiveId(s.id);
    setSessionTitle(s.title || 'New chat');
    const tr = s.transcript && s.transcript.length > 0 ? s.transcript : [rootPromptMsg()];
    // Refresh a stale opening prompt so newly added top-level options appear.
    const refreshed = tr.map((m, i) =>
      (i === 0 && m.role === 'agent' && m.kind === 'menu' && m.title.startsWith("Hi — I'm your OKR agent"))
        ? rootPromptMsg() : m);
    setTranscript(refreshed);
    const st = s.state || initialState();
    setStep(st.step || 'root');
    setSelectedUserId(st.selectedUserId || '');
    setDurationType(st.durationType || '');
    setResultPeriodId(st.resultPeriodId || '');
    setResultObjectiveIds(st.resultObjectiveIds || []);
    setVpTargetId(st.vpTargetId || '');
    setVpEachIndex(st.vpEachIndex || 0);
    setResultPlanId(st.resultPlanId || '');
    setPlanChoiceIds(st.planChoiceIds || []);
    setDurationGroupBaseIds(st.durationGroupBaseIds || []);
    setDurationGroups(st.durationGroups || []);
    setInput('');
  };

  const startNew = async () => {
    try {
      const res = await fetch(SESSIONS_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New chat', transcript: [rootPromptMsg()], state: initialState() }),
      });
      if (res.ok) {
        const d = await res.json();
        setSessions(prev => [d.session, ...prev]);
        loadSession(d.session);
      }
    } catch { /* ignore */ }
  };

  const setArchived = async (id: string, archived: boolean) => {
    try {
      const res = await fetch(`${SESSIONS_URL}/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
      if (res.ok) {
        const d = await res.json();
        setSessions(prev => prev.map(s => (s.id === id ? d.session : s)));
      }
    } catch { /* ignore */ }
    if (archived && id === activeId) {
      const others = sessions
        .filter(s => s.id !== id && !s.archived)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      if (others.length) loadSession(others[0]);
      else await startNew();
    }
  };

  // Question codes used by objective trees in a session's transcript. The current
  // in-memory transcript is freshest for the active session.
  const treeCodesIn = (s: AgentSession) => {
    const tr = s.id === activeId ? transcript : s.transcript;
    const codes = new Set<string>();
    for (const m of tr || []) {
      if (m.role === 'agent' && (m.kind === 'plan' || m.kind === 'objlist') && m.code) codes.add(m.code);
    }
    return codes;
  };

  const deleteSession = async (id: string) => {
    const s = sessions.find(x => x.id === id);
    if (!window.confirm(`Delete chat "${s?.title || 'New chat'}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${SESSIONS_URL}/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) return;
    } catch { return; }
    const remaining = sessions.filter(x => x.id !== id);
    // Drop column memory for this session's question codes, but only those no
    // remaining session still uses (codes are deterministic and can be shared).
    if (s) {
      const stillUsed = new Set<string>();
      remaining.forEach(r => treeCodesIn(r).forEach(c => stillUsed.add(c)));
      treeCodesIn(s).forEach(code => {
        if (!stillUsed.has(code)) { try { localStorage.removeItem(`okr-agent-cols-${code}`); } catch { /* ignore */ } }
      });
    }
    setSessions(remaining);
    if (id === activeId) {
      const next = remaining
        .filter(x => !x.archived)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      if (next.length) loadSession(next[0]);
      else await startNew();
    }
  };

  useEffect(() => {
    fetchSharedPlans();
    fetch(`${API_URL}/api/users`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { users: [] }))
      .then(d => setOrgUsers(d.users || []))
      .catch(() => { /* ignore */ });
    (async () => {
      try {
        const res = await fetch(SESSIONS_URL, { credentials: 'include' });
        const d = res.ok ? await res.json() : { sessions: [] };
        const all: AgentSession[] = d.sessions || [];
        setSessions(all);
        const active = all.filter(s => !s.archived).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
        if (active) loadSession(active);
        else await startNew();
      } catch {
        await startNew();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [transcript]);

  // Persist the active session (debounced) whenever its content/state changes.
  useEffect(() => {
    if (!activeId) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${SESSIONS_URL}/${activeId}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: sessionTitle,
            transcript,
            state: { step, selectedUserId, durationType, resultPeriodId, resultObjectiveIds, vpTargetId, vpEachIndex, resultPlanId, planChoiceIds, durationGroupBaseIds, durationGroups },
          }),
        });
        if (res.ok) {
          const d = await res.json();
          setSessions(prev => prev.map(s => (s.id === activeId ? d.session : s)));
        }
      } catch { /* ignore */ }
    }, 500);
    return () => clearTimeout(t);
  }, [transcript, step, selectedUserId, durationType, resultPeriodId, resultObjectiveIds, vpTargetId, vpEachIndex, resultPlanId, planChoiceIds, durationGroupBaseIds, durationGroups, sessionTitle, activeId]);

  const planLabel = (id: string) => {
    const p = allPlans.find(x => x.id === id);
    if (!p) return id;
    return `${p.name} (${p.items.length} ${p.items.length === 1 ? 'item' : 'items'})`;
  };
  const planPickPrompt = () => menuMsg('Multiple plans match this duration. Which one? Type the number:', planChoiceIds.map(planLabel));
  // Child plans are plans (owner+period) whose parentId points at the given plan.
  const childPlansOf = (parentId?: string) => parentId ? allPlans.filter(p => p.parentId === parentId) : [];
  const childPlanPickPrompt = () => menuMsg('Which child plan to show side by side? Type the number:', childPlansOf(resultPlanId).map(p => planLabel(p.id)));
  // VP-ordered item ids + total for one side of the side-by-side view.
  // One level deeper, after a child plan is shown side by side.
  const splitMenuPrompt = () => menuMsg('Now showing them side by side. What next? Type the number:', ['Show breakdown by assignee', 'Show unassigned items in the child plan', 'Go up to the plan']);
  const lastSplitChildId = (): string => {
    const m = [...transcript].reverse().find(mm => mm.role === 'agent' && mm.kind === 'split');
    return m && m.kind === 'split' ? m.childListId : '';
  };
  const showAssigneeBreakdown = () => {
    const child = allPlans.find(p => p.id === lastSplitChildId());
    if (!child) { appendAgent(textMsg('No child plan is being shown to break down.')); return; }
    const objs = useOKRStore.getState().objectives;
    const uName = (uid?: string) => { if (!uid) return 'Unassigned'; const u = orgUsers.find(x => x.id === uid); return u?.name || u?.email || uid; };
    const groups = new Map<string, { count: number; vp: number }>();
    for (const it of child.items) {
      const o = objs.find(x => x.id === it.objectiveId);
      const key = o?.assigneeId || '';
      const g = groups.get(key) || { count: 0, vp: 0 };
      g.count += 1; g.vp += o?.valuePoints ?? 0;
      groups.set(key, g);
    }
    const rows = [...groups.entries()]
      .map(([uid, g]) => ({ name: uName(uid), count: g.count, vp: g.vp }))
      .sort((a, b) => b.vp - a.vp || b.count - a.count);
    const totalCount = rows.reduce((s, r) => s + r.count, 0);
    const totalVp = rows.reduce((s, r) => s + r.vp, 0);
    appendAgent(breakdownMsg(`${child.name} — breakdown by assignee`, rows, totalCount, totalVp));
  };
  const showUnassignedChildItems = () => {
    const child = allPlans.find(p => p.id === lastSplitChildId());
    if (!child) { appendAgent(textMsg('No child plan is being shown.')); return; }
    const objs = useOKRStore.getState().objectives;
    const ids = child.items
      .filter(it => !objs.find(x => x.id === it.objectiveId)?.assigneeId)
      .map(it => it.objectiveId)
      .filter(id => objs.some(o => o.id === id));
    if (ids.length === 0) appendAgent(textMsg(`No unassigned items in "${child.name}".`));
    else appendAgent(objlistMsg(`Unassigned items in ${child.name}`, ids, answeredCodeRef.current));
  };

  const showSplit = (parent: List, child: List) => {
    const u = usersSorted.find(x => x.id === selectedUserId);
    const userName = u?.name || u?.email || 'that user';
    appendAgent(splitMsg(userName, parent.id, child.id, parent.name, child.name));
    // Go one level deeper into the split menu.
    setStep('splitMenu');
    appendAgent(splitMenuPrompt());
  };

  // ---- Add a deliverable ----
  const delivSummaryPrompt = () => textMsg("Add a deliverable. Type a one-line summary of what it is (or 'b' to go back):");
  const delivDatePrompt = () => textMsg("When do we need it by? Type a date like 2026-09-30 (or '-' for none):");
  const delivAssigneePrompt = () => menuMsg('Who should it be assigned to? Type the number:', usersSorted.map(u => u.name || u.email));
  const delivPickerNote = () => menuMsg('Pick a parent in the tree above — hover an item and choose "Select parent" (or "+ Child" to add structure). Or:', []);
  const startDeliverableParent = (assignee: User) => {
    appendAgent(deliverableMsg(delivSummary, delivNeededBy, assignee.id, assignee.name || assignee.email, currentUserId));
    setStep('delivParent');
    appendAgent(delivPickerNote());
  };
  const createDeliverableFrom = async (m: { summary: string; neededBy: string; assigneeId: string; assigneeName: string; ownerId: string }, parent: Objective | null) => {
    const fallbackPeriod = periodsSorted[periodsSorted.length - 1]?.id || periods[0]?.id || '';
    const periodId = parent?.periodId || fallbackPeriod;
    if (!periodId) { appendAgent(textMsg('Could not determine a period for the deliverable. Add a period first.')); return; }
    await addObjective({
      title: m.summary,
      level: parent?.level || 'individual',
      parentId: parent?.id,
      ownerId: m.ownerId || currentUserId || undefined,
      assigneeId: m.assigneeId,
      periodId,
      nextStepDate: m.neededBy || undefined,
      workflowStatus: 'todo',
    }, { orgId, userEmail, shared: true });
    appendAgent(textMsg(`Added "${m.summary}"${parent ? ` under "${parent.title}"` : ' at the top level'}, assigned to ${m.assigneeName}${m.neededBy ? `, needed by ${m.neededBy}` : ''}.`));
    setStep('root');
    appendAgent(rootPromptMsg());
  };
  const cancelDeliverable = () => {
    appendAgent(textMsg('Cancelled adding the deliverable.'));
    setStep('root');
    appendAgent(rootPromptMsg());
  };

  // ---- Review Progress ----
  const reviewAreaPrompt = () => menuMsg('Which area would you like to review? Type the number:', REVIEW_AREAS);
  const settingsPrompt = () => menuMsg('Settings — type the number of an option:', SETTINGS_OPTIONS);
  const autonomousActionsPrompt = () => menuMsg('Autonomous Actions — pick an area. Type the number:', AUTONOMOUS_AREAS);
  const autonomousEngPrompt = () => menuMsg('Engineering autonomous actions — type the number to run one:', ENG_AUTONOMOUS_ACTIONS.map(a => `${a.label} (${a.cadence})`));

  // Return to the area menu (Engineering, …) after a review finishes.
  const backToArea = () => { setStep('reviewArea'); appendAgent(reviewAreaPrompt()); };

  // Engineering review: pull the Release Calendar sheet and show what's in
  // progress, just shipped (Prod within 30 days), or due in the next 30 days.
  const reviewEngineering = async () => {
    appendAgent(textMsg('Fetching the Release Calendar…'));
    try {
      const res = await fetch(`${API_URL}/api/release-calendar`, { credentials: 'include' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}) as Record<string, string>);
        if (d?.error === 'google_reauth_required') {
          // Not signed out — the session is valid but Google denied the read.
          // Offer an explicit reconnect (see the 'reauth' render branch), and
          // surface Google's own message when present so the cause is visible.
          const extra = d.detail ? ` (Google said: ${d.detail})` : '';
          appendAgent({ role: 'agent', kind: 'reauth', message: (d.message || 'Reconnect your Google account to read the Release Calendar.') + extra });
          backToArea();
          return;
        }
        if (d?.error === 'sheet_not_found') {
          appendAgent(textMsg(d.message || 'The Release Calendar was not found or is not shared with your Google account.', 'error'));
          backToArea();
          return;
        }
        const detail = d?.detail ? ` — ${d.detail}` : (d?.message ? ` — ${d.message}` : '');
        appendAgent(textMsg(`Couldn't load the Release Calendar (error ${res.status})${detail}.`, 'error'));
        backToArea();
        return;
      }
      const data = await res.json() as { sheetTitle: string; tab: string; headers: string[]; rows: string[][] };
      const headers = data.headers || [];
      const rows = data.rows || [];
      if (headers.length === 0 || rows.length === 0) {
        appendAgent(textMsg('The Release Calendar appears to be empty.', 'error'));
        backToArea();
        return;
      }
      const today = new Date();
      const { columns, groups, recent, detected, counts } = classifyReleases(headers, rows, today);
      const asOf = today.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const note = detected
        ? undefined
        : "I couldn't confidently find a Prod/date/status column, so I'm showing the sheet as-is below — tell me the column names and I'll refine the filter.";
      appendAgent(releasesMsg(
        'Engineering', data.sheetTitle || 'Release Calendar', asOf,
        groups, recent, columns.length ? columns : headers.slice(0, 4), note,
        detected ? undefined : headers, detected ? undefined : rows,
      ));
      if (detected) {
        appendAgent(textMsg(`In progress: ${counts.in_progress} · Just completed: ${counts.completed} · Upcoming: ${counts.upcoming}.`));
      }
      // Then pull the Jira tickets for whatever is in progress now.
      const inProgress = groups.find(g => g.key === 'in_progress');
      const names = inProgress ? inProgress.items.map(it => it.name) : [];
      if (names.length) await fetchJiraForReleases(names);
      else backToArea();
    } catch (err) {
      appendAgent(textMsg(`Couldn't reach the server: ${err instanceof Error ? err.message : String(err)}`, 'error'));
      backToArea();
    }
  };

  // Back to the Engineering autonomous-actions menu after an action runs.
  const backToAutonomousEng = () => { setStep('autonomousEng'); appendAgent(autonomousEngPrompt()); };

  // The "Weekly" autonomous action: fetch tickets resolved in the last 7 days and
  // report resolved count + summed story points by assignee (Story/Bug/Sub-task).
  const runWeeklyResolved = async () => {
    appendAgent(textMsg('Fetching tickets resolved in the last 7 days…'));
    try {
      const res = await fetch(`${API_URL}/api/jira/resolved-recently?days=7`, { credentials: 'include' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as { error?: string; message?: string; detail?: string }));
        appendAgent(textMsg(`Couldn't load resolved tickets: ${d?.message || d?.error || `error ${res.status}`}`, 'error'));
        if (d?.detail) appendAgent(textMsg(`Jira project lookup: ${d.detail}`));
        backToAutonomousEng();
        return;
      }
      const data = await res.json() as { configured: boolean; tickets?: JiraTicket[]; days?: number; browse?: string };
      if (!data.configured) {
        appendAgent(textMsg('Jira isn\'t configured for your organization yet — an admin can set it up under Admin → Jira.', 'error'));
        backToAutonomousEng();
        return;
      }
      const days = data.days || 7;
      const workItems = (data.tickets || []).filter(isWorkItem);
      const { rows, total } = countAndSpByAssignee(workItems);
      const parentRows = parentBreakdown(workItems, data.browse || '');
      const asOf = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      appendAgent(resolvedWeeklyMsg(
        'Weekly — resolved in the last 7 days',
        asOf, days,
        rows.map(([name, v]) => ({ name, count: v.count, sp: v.sp })),
        total.count, total.sp,
        parentRows,
      ));
      backToAutonomousEng();
    } catch (err) {
      appendAgent(textMsg(`Couldn't reach the server: ${err instanceof Error ? err.message : String(err)}`, 'error'));
      backToAutonomousEng();
    }
  };

  // Fetch Jira tickets (by fixVersion) for the given release names. `project`
  // overrides/persists the release project. If the project can't be found, drop
  // into a picker so the user can choose one (or none). Releases with no matching
  // Jira fix version are reported and skipped.
  const fetchJiraForReleases = async (versions: string[], project?: string) => {
    appendAgent(textMsg(`Fetching Jira tickets for in-progress ${versions.length === 1 ? 'release' : 'releases'}: ${versions.join(', ')}…`));
    try {
      const qs = `versions=${encodeURIComponent(versions.join(','))}${project ? `&project=${encodeURIComponent(project)}` : ''}`;
      const res = await fetch(`${API_URL}/api/jira/release-tickets?${qs}`, { credentials: 'include' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as { error?: string; message?: string; detail?: string; projectNotFound?: boolean; projects?: { key: string; name: string }[] }));
        if (d?.projectNotFound && Array.isArray(d.projects) && d.projects.length) {
          // Let the user pick which Jira project holds these releases.
          setPendingJiraVersions(versions);
          setJiraProjects(d.projects);
          setStep('jiraProjectPick');
          appendAgent(jiraProjectPrompt(d.projects));
          return; // picker is showing — no area prompt
        }
        appendAgent(textMsg(`Couldn't load Jira tickets: ${d?.message || d?.error || `error ${res.status}`}`, 'error'));
        if (d?.detail) appendAgent(textMsg(`Jira project lookup: ${d.detail}`));
        backToArea();
        return;
      }
      const data = await res.json() as { configured: boolean; groups?: { version: string; tickets: JiraTicket[] }[]; unknown?: string[]; project?: string; jql?: string };
      if (!data.configured) {
        appendAgent(textMsg('Jira isn\'t configured for your organization yet — an admin can set it up under Admin → Jira.', 'error'));
      } else {
        appendAgent(jiraMsg(data.groups || [], data.unknown || [], data.project, data.jql, Date.now()));
      }
      backToArea();
    } catch (err) {
      appendAgent(textMsg(`Couldn't reach Jira: ${err instanceof Error ? err.message : String(err)}`, 'error'));
      backToArea();
    }
  };

  const jiraProjectPrompt = (projects: { key: string; name: string }[]) =>
    menuMsg("I couldn't find the release project in Jira. Pick which project holds these releases (or None to skip). Type the number:",
      [...projects.map(p => `${p.key} — ${p.name}`), 'None (skip Jira)']);

  const showPlanItems = (plan: List, code: string = answeredCodeRef.current) => {
    const u = usersSorted.find(x => x.id === selectedUserId);
    const userName = u?.name || u?.email || 'that user';
    const period = periodsSorted.find(p => p.id === plan.periodId);
    const periodName = period ? periodLabel(period) : 'that duration';
    const objs = useOKRStore.getState().objectives;
    setResultPlanId(plan.id);
    setResultPeriodId(plan.periodId || '');
    setSessionTitle(`${userName} · ${plan.name}`);
    // Order items by VP assigned, highest first.
    const items = plan.items
      .map(it => {
        const obj = objs.find(o => o.id === it.objectiveId);
        return { id: it.objectiveId, title: obj?.title || it.objectiveId, vp: obj?.valuePoints ?? 0, missing: !obj, kr: !!obj?.isKeyResult };
      })
      .sort((a, b) => b.vp - a.vp);
    setResultObjectiveIds(items.map(it => it.id));
    const total = items.reduce((sum, i) => sum + i.vp, 0);
    appendAgent(planMsg(plan.name, userName, periodName, items, total, code));
    appendAgent(menuMsg('What would you like to do next?', items.length > 0 ? RESULT_ACTIONS : []));
    setStep('result');
  };

  const showNoPlan = (periodId: string) => {
    const u = usersSorted.find(x => x.id === selectedUserId);
    const userName = u?.name || u?.email || 'that user';
    const period = periodsSorted.find(p => p.id === periodId);
    const periodName = period ? periodLabel(period) : 'that duration';
    setResultPlanId('');
    setResultPeriodId(periodId);
    setResultObjectiveIds([]);
    setSessionTitle(`${userName} · ${periodName}`);
    appendAgent(textMsg(`No plan is defined for ${userName} for ${periodName}.`));
    appendAgent(menuMsg('What would you like to do next?', []));
    setStep('result');
  };

  // After a duration is chosen, resolve the plan(s) for owner + period.
  // 0 -> "no plan", 1 -> show it, many -> ask which one first.
  const enterDuration = (periodId: string) => {
    const matches = allPlans.filter(p => p.ownerId === selectedUserId && p.periodId === periodId);
    if (matches.length === 0) { showNoPlan(periodId); return; }
    if (matches.length === 1) { showPlanItems(matches[0]); return; }
    setResultPeriodId(periodId);
    setPlanChoiceIds(matches.map(m => m.id));
    setStep('planPick');
    appendAgent(menuMsg('Multiple plans match this duration. Which one? Type the number:', matches.map(m => `${m.name} (${m.items.length} ${m.items.length === 1 ? 'item' : 'items'})`)));
  };

  const reshowResult = () => {
    const plan = allPlans.find(p => p.id === resultPlanId);
    if (!plan) { showNoPlan(resultPeriodId); return; }
    // Reuse the column-memory code from the plan message that's already shown so a
    // reload keeps the same per-question columns instead of the reload menu's code.
    const lastPlan = [...transcript].reverse().find(mm => mm.role === 'agent' && mm.kind === 'plan');
    const code = lastPlan && lastPlan.kind === 'plan' ? lastPlan.code : undefined;
    showPlanItems(plan, code ?? answeredCodeRef.current);
  };

  const showPromptFor = (s: Step) => {
    setStep(s);
    switch (s) {
      case 'root': appendAgent(rootPromptMsg()); break;
      case 'treeBrowse': appendAgent(treeBrowsePrompt()); break;
      case 'durationGroupPick': appendAgent(durationGroupPrompt(durationGroups)); break;
      case 'planMembershipPick': appendAgent(planMembershipPrompt()); break;
      case 'user': appendAgent(userPrompt()); break;
      case 'durationType': appendAgent(durationTypePrompt()); break;
      case 'planFilter': appendAgent(planFilterPrompt()); break;
      case 'planResults': appendAgent(planResultsPrompt()); break;
      case 'planSelect': appendAgent(planSelectPrompt()); break;
      case 'duration': appendAgent(durationPrompt(durationType)); break;
      case 'planPick': appendAgent(planPickPrompt()); break;
      case 'result': reshowResult(); break;
      case 'childPlanPick': appendAgent(childPlanPickPrompt()); break;
      case 'splitMenu': appendAgent(splitMenuPrompt()); break;
      case 'delivSummary': appendAgent(delivSummaryPrompt()); break;
      case 'delivDate': appendAgent(delivDatePrompt()); break;
      case 'delivAssignee': appendAgent(delivAssigneePrompt()); break;
      case 'delivParent': appendAgent(deliverableMsg(delivSummary, delivNeededBy, '', '', currentUserId)); appendAgent(delivPickerNote()); break;
      case 'vpPick': appendAgent(vpPickPrompt()); break;
      case 'itemAction': appendAgent(itemActionPrompt()); break;
      case 'changeDuration': appendAgent(changeDurationPrompt()); break;
      case 'vpEach': appendAgent(vpEachPrompt(vpEachIndex)); break;
      case 'vpItem': appendAgent(vpItemPrompt(objTitle(vpTargetId))); break;
      case 'reviewArea': appendAgent(reviewAreaPrompt()); break;
      case 'settings': appendAgent(settingsPrompt()); break;
      case 'autonomousActions': appendAgent(autonomousActionsPrompt()); break;
      case 'autonomousEng': appendAgent(autonomousEngPrompt()); break;
      case 'jiraProjectPick': appendAgent(jiraProjectPrompt(jiraProjects)); break;
    }
  };

  const goBack = () => showPromptFor(PREV[step]);

  const restart = () => {
    setSelectedUserId('');
    setDurationType('');
    setResultObjectiveIds([]);
    setResultPlanId('');
    setPlanChoiceIds([]);
    showPromptFor('root');
  };

  // Clears the current session's transcript and all flow state, returning to a
  // blank chat with just the opening prompt. The debounced persist effect saves
  // the cleared session back to the server.
  const startOver = () => {
    const st = initialState();
    setStep(st.step);
    setSelectedUserId(st.selectedUserId);
    setDurationType(st.durationType);
    setResultPeriodId(st.resultPeriodId);
    setResultObjectiveIds(st.resultObjectiveIds);
    setVpTargetId(st.vpTargetId);
    setVpEachIndex(st.vpEachIndex);
    setResultPlanId(st.resultPlanId);
    setPlanChoiceIds(st.planChoiceIds);
    setDurationGroupBaseIds(st.durationGroupBaseIds);
    setDurationGroups(st.durationGroups);
    setDelivSummary('');
    setDelivNeededBy('');
    setInput('');
    setSessionTitle('New chat');
    setTranscript([rootPromptMsg()]);
  };

  const applyVp = async (ids: string[], v: number) => {
    try {
      for (const id of ids) await updateObjective(id, { valuePoints: v }, userEmail);
      appendAgent(textMsg(`Set value points to ${v} on ${ids.length} ${ids.length === 1 ? 'item' : 'items'}.`));
    } catch (err) {
      appendAgent(textMsg(`Couldn't update value points: ${err instanceof Error ? err.message : String(err)}`, 'error'));
    }
    reshowResult();
  };

  const changeItemDuration = async (id: string, period: { id: string; name: string }) => {
    try {
      await updateObjective(id, { periodId: period.id }, userEmail);
      appendAgent(textMsg(`Changed the duration of "${objTitle(id)}" to ${period.name}.`));
    } catch (err) {
      appendAgent(textMsg(`Couldn't change the duration: ${err instanceof Error ? err.message : String(err)}`, 'error'));
    }
    setStep('itemAction');
    appendAgent(itemActionPrompt(id));
  };

  // Walk every item one at a time, setting a (possibly different) VP on each.
  const handleVpEach = async (v: number) => {
    const id = resultObjectiveIds[vpEachIndex];
    try {
      await updateObjective(id, { valuePoints: v }, userEmail);
    } catch (err) {
      appendAgent(textMsg(`Couldn't update "${objTitle(id)}": ${err instanceof Error ? err.message : String(err)}`, 'error'));
    }
    const next = vpEachIndex + 1;
    if (next < resultObjectiveIds.length) {
      setVpEachIndex(next);
      appendAgent(vpEachPrompt(next));
    } else {
      appendAgent(textMsg(`Done — updated value points on all ${resultObjectiveIds.length} ${resultObjectiveIds.length === 1 ? 'item' : 'items'}.`));
      reshowResult();
    }
  };

  const treeBrowsePrompt = () => menuMsg('Browse the objective tree. Type the number:', TREE_OPTIONS);
  const myPlans = () => lists.filter(l => l.ownerId && l.periodId);
  const planMembershipPrompt = () => menuMsg('Pick a plan to mark membership against (solid bookmark = in the plan, outline = not; click to add/remove). Type the number:', [...myPlans().map(p => p.name), 'Turn off plan membership']);
  const durationGroupLabel = (g: { label: string; count: number }) => `${g.label} — ${g.count} ${g.count === 1 ? 'item' : 'items'}`;
  const durationGroupPrompt = (groups: { periodId: string; label: string; count: number }[]) => menuMsg('Durations in the result set — pick one to filter by. Type the number:', groups.map(durationGroupLabel));

  // Open top-level initiatives + open children, grouped by duration (period).
  const showDurationGroups = () => {
    const objs = useOKRStore.getState().objectives;
    const isOpen = (ws: string) => !HIDDEN_CHILD_STATUSES.has(ws);
    const roots = objs.filter(o => !o.parentId && o.type === 'initiative' && isOpen(o.workflowStatus));
    const baseIds: string[] = [];
    const add = (o: typeof objs[number]) => {
      baseIds.push(o.id);
      objs.filter(c => c.parentId === o.id && isOpen(c.workflowStatus)).forEach(add);
    };
    roots.forEach(add);
    const counts = new Map<string, number>();
    for (const id of baseIds) {
      const pid = objs.find(o => o.id === id)?.periodId || '';
      counts.set(pid, (counts.get(pid) || 0) + 1);
    }
    const groups = Array.from(counts.entries())
      .map(([periodId, count]) => {
        const p = periods.find(x => x.id === periodId);
        return { periodId, label: p ? periodLabel(p) : 'No duration', count };
      })
      .sort((a, b) => {
        const pa = periods.find(x => x.id === a.periodId)?.startDate || '';
        const pb = periods.find(x => x.id === b.periodId)?.startDate || '';
        return pa.localeCompare(pb) || a.label.localeCompare(b.label);
      });
    if (groups.length === 0) { appendAgent(textMsg('No open top-level initiatives found.')); appendAgent(treeBrowsePrompt()); setStep('treeBrowse'); return; }
    setDurationGroupBaseIds(baseIds);
    setDurationGroups(groups);
    setStep('durationGroupPick');
    appendAgent(durationGroupPrompt(groups));
  };

  // "Open" = not done/archived. Show open top-level initiatives, optionally with
  // their open descendants (indented).
  const showTopInitiatives = (withChildren: boolean) => {
    const objs = useOKRStore.getState().objectives;
    const isOpen = (ws: string) => !HIDDEN_CHILD_STATUSES.has(ws);
    const roots = objs.filter(o => !o.parentId && o.type === 'initiative' && isOpen(o.workflowStatus));
    const ids: string[] = [];
    const add = (o: typeof objs[number]) => {
      ids.push(o.id);
      if (withChildren) objs.filter(c => c.parentId === o.id && isOpen(c.workflowStatus)).forEach(add);
    };
    roots.forEach(add);
    const title = withChildren ? 'Open top-level initiatives and their children' : 'Open top-level initiatives';
    if (ids.length === 0) appendAgent(textMsg('No open top-level initiatives found.'));
    else appendAgent(objlistMsg(title, ids, answeredCodeRef.current));
  };

  // Objectives I own whose period has already ended (endDate before today).
  const showMyPassedObjectives = () => {
    const myId = orgUsers.find(u => u.email?.toLowerCase() === userEmail.toLowerCase())?.id;
    if (!myId) { appendAgent(textMsg('Could not determine your user yet — try again in a moment.')); return; }
    const today = new Date().toLocaleDateString('en-CA');
    const periodPassed = (pid?: string) => { const p = periods.find(x => x.id === pid); return !!(p?.endDate && p.endDate < today); };
    const objs = useOKRStore.getState().objectives;
    const ids = objs
      .filter(o => o.ownerId === myId && periodPassed(o.periodId) && !HIDDEN_CHILD_STATUSES.has(o.workflowStatus))
      .map(o => o.id);
    if (ids.length === 0) appendAgent(textMsg('You have no open objectives whose duration has passed.'));
    else appendAgent(objlistMsg('My open objectives whose duration has passed', ids, answeredCodeRef.current));
  };

  const showChildren = (id: string) => {
    const objs = useOKRStore.getState().objectives;
    const parent = objs.find(o => o.id === id);
    // Hide Done/Archived children by default.
    const children = objs
      .filter(o => o.parentId === id && !HIDDEN_CHILD_STATUSES.has(o.workflowStatus))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.title.localeCompare(b.title));
    if (children.length === 0) {
      appendAgent(textMsg(`"${parent?.title || id}" has no active children.`));
      return;
    }
    const durName = (pid?: string) => periods.find(p => p.id === pid)?.name || '—';
    appendAgent(childrenMsg(parent?.title || id, children.map(c => ({
      id: c.id,
      title: c.title,
      vp: c.valuePoints ?? 0,
      duration: durName(c.periodId),
      status: WORKFLOW_STATUS_LABELS[c.workflowStatus] || c.workflowStatus,
    }))));
  };

  // Parent + siblings + the item itself, each with duration, VP, owner, assignee.
  const showFamily = (id: string) => {
    const objs = useOKRStore.getState().objectives;
    const self = objs.find(o => o.id === id);
    if (!self) { appendAgent(textMsg('That item could not be found.')); return; }
    const durName = (pid?: string) => periods.find(p => p.id === pid)?.name || '—';
    const uName = (uid?: string) => { const u = orgUsers.find(x => x.id === uid); return u?.name || u?.email || '—'; };
    const toRow = (o: typeof self, rel: string) => ({
      name: o.title,
      rel,
      duration: durName(o.periodId),
      vp: o.valuePoints ?? 0,
      owner: uName(o.ownerId),
      assignee: uName(o.assigneeId),
      self: o.id === id,
    });
    const rows = [];
    const parent = self.parentId ? objs.find(o => o.id === self.parentId) : undefined;
    if (parent) rows.push(toRow(parent, 'Parent'));
    objs
      .filter(o => (o.parentId || null) === (self.parentId || null))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.title.localeCompare(b.title))
      .forEach(s => rows.push(toRow(s, s.id === id ? 'Self' : 'Sibling')));
    appendAgent(familyMsg(self.title, rows));
  };

  const showAllPlans = (statusPred: (p: List) => boolean = (p) => p.status !== 'Archived', filterLabel = 'all but archived') => {
    const u = usersSorted.find(x => x.id === selectedUserId);
    const userName = u?.name || u?.email || 'that user';
    const typeLabel = (t?: string) => DURATION_TYPES.find(d => d.type === t)?.label || (t || '—');
    const items = allPlans
      .filter(p => p.ownerId === selectedUserId && statusPred(p))
      .map(p => {
        const per = periods.find(pp => pp.id === p.periodId);
        return { id: p.id, name: p.name, type: typeLabel(per?.type), period: per ? periodLabel(per) : '—', status: p.status || '' };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    appendAgent(plansMsg(userName, items, filterLabel));
    const ids = items.map(i => i.id);
    setPlanChoiceIds(ids);
    return ids;
  };

  const handleSubmit = () => {
    const raw = input.trim();
    if (!raw) return;
    setInput('');
    appendUser(raw);

    // Free value-entry steps: the input is the VP number (or a command).
    if (VALUE_STEPS.includes(step)) {
      const lower = raw.toLowerCase();
      if (lower === 'b' || lower === 'back') {
        if (step === 'vpEach' && vpEachIndex > 0) {
          const prev = vpEachIndex - 1;
          setVpEachIndex(prev);
          appendAgent(vpEachPrompt(prev));
        } else {
          goBack();
        }
        return;
      }
      if (lower === 's' || lower === 'start' || lower === 'restart') { restart(); return; }
      if (lower === 'c' || lower === 'children') {
        const curId = step === 'vpEach' ? resultObjectiveIds[vpEachIndex] : vpTargetId;
        showChildren(curId);
        if (step === 'vpEach') appendAgent(vpEachPrompt(vpEachIndex));
        else appendAgent(vpItemPrompt(objTitle(vpTargetId)));
        return;
      }
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) {
        appendAgent(textMsg("Please type a number for the value points, or b to go back, s to start over, or c to see its children."));
        return;
      }
      if (step === 'vpEach') handleVpEach(v);
      else applyVp([vpTargetId], v);
      return;
    }

    // Free-text steps for the deliverable flow.
    if (TEXT_STEPS.includes(step)) {
      const lower = raw.toLowerCase();
      if (lower === 'b' || lower === 'back') { goBack(); return; }
      if (lower === 's' || lower === 'start' || lower === 'restart') { restart(); return; }
      if (step === 'delivSummary') {
        setDelivSummary(raw);
        setStep('delivDate');
        appendAgent(delivDatePrompt());
      } else if (step === 'delivDate') {
        setDelivNeededBy(raw === '-' || lower === 'none' ? '' : raw);
        setStep('delivAssignee');
        appendAgent(delivAssigneePrompt());
      }
      return;
    }

    // Menu steps: input is an option number (domain options + back + start over).
    const base = baseOptions(step);
    const totalOpts = base.length + 2;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > totalOpts) {
      appendAgent(textMsg(`Please type a number between 1 and ${totalOpts}.`));
      return;
    }
    if (n === base.length + 1) { goBack(); return; }
    if (n === base.length + 2) { restart(); return; }

    // Remember which question is being answered so trees rendered in response
    // can key their column selection off it.
    const lastMenu = [...transcript].reverse().find(mm => mm.role === 'agent' && mm.kind === 'menu');
    answeredCodeRef.current = lastMenu && lastMenu.kind === 'menu' ? (lastMenu.code ?? questionCode(lastMenu.title)) : '';

    switch (step) {
      case 'root':
        if (n === 1) showPromptFor('user');
        else if (n === 2) { setStep('treeBrowse'); appendAgent(treeBrowsePrompt()); }
        else if (n === 3) { setDelivSummary(''); setDelivNeededBy(''); setStep('delivSummary'); appendAgent(delivSummaryPrompt()); }
        else if (n === 4) { setStep('reviewArea'); appendAgent(reviewAreaPrompt()); }
        else { setStep('settings'); appendAgent(settingsPrompt()); }
        break;
      case 'reviewArea':
        if (n === 1) reviewEngineering(); // shows its own follow-up prompt when done
        break;
      case 'settings':
        if (n === 1) { setStep('autonomousActions'); appendAgent(autonomousActionsPrompt()); } // Autonomous Actions
        break;
      case 'autonomousActions':
        if (n === 1) { setStep('autonomousEng'); appendAgent(autonomousEngPrompt()); } // Engineering
        break;
      case 'autonomousEng':
        if (n === 1) runWeeklyResolved(); // shows its own follow-up prompt when done
        break;
      case 'jiraProjectPick':
        if (n <= jiraProjects.length) {
          const proj = jiraProjects[n - 1];
          fetchJiraForReleases(pendingJiraVersions, proj.key);
        } else {
          appendAgent(textMsg('Skipped Jira for these releases.'));
          backToArea();
        }
        break;
      case 'treeBrowse':
        if (n === 1) { showTopInitiatives(false); appendAgent(treeBrowsePrompt()); }
        else if (n === 2) { showTopInitiatives(true); appendAgent(treeBrowsePrompt()); }
        else if (n === 3) { showMyPassedObjectives(); appendAgent(treeBrowsePrompt()); }
        else if (n === 4) { showDurationGroups(); }
        else if (n === 5) { setStep('planMembershipPick'); appendAgent(planMembershipPrompt()); }
        break;
      case 'planMembershipPick': {
        const plans = myPlans();
        if (n <= plans.length) {
          const plan = plans[n - 1];
          setShowListMembership(true);
          setListMembershipListId(plan.id);
          appendAgent(textMsg(`Marking plan membership for "${plan.name}". In the objective tree above, a solid bookmark means the item is in the plan and an outline means it is not — click a bookmark to add/remove (you'll be asked to confirm).`));
        } else {
          setShowListMembership(false);
          setListMembershipListId(null);
          appendAgent(textMsg('Plan membership view turned off.'));
        }
        setStep('treeBrowse');
        appendAgent(treeBrowsePrompt());
        break;
      }
      case 'durationGroupPick': {
        const g = durationGroups[n - 1];
        const objs = useOKRStore.getState().objectives;
        const ids = durationGroupBaseIds.filter(id => (objs.find(o => o.id === id)?.periodId || '') === g.periodId);
        if (ids.length === 0) appendAgent(textMsg('No items for that duration.'));
        else appendAgent(objlistMsg(`Open top-level initiatives & children · ${g.label}`, ids, answeredCodeRef.current));
        // Stay in the duration loop — re-show the duration menu. "Go back" goes up a level.
        appendAgent(durationGroupPrompt(durationGroups));
        break;
      }
      case 'user': {
        const uid = usersSorted[n - 1].id;
        setSelectedUserId(uid);
        setStep('durationType');
        appendAgent(durationTypePrompt(uid));
        break;
      }
      case 'durationType': {
        if (n === DURATION_TYPES.length + 1) {
          // "Show all plans" — first offer status filter options, then list.
          setStep('planFilter');
          appendAgent(planFilterPrompt());
          break;
        }
        const dt = DURATION_TYPES[n - 1];
        setDurationType(dt.type);
        const ps = periodsOfType(dt.type);
        if (ps.length === 0) {
          appendAgent(textMsg(`No ${dt.label.toLowerCase()} durations are active or upcoming. Pick another type:`));
          appendAgent(durationTypePrompt());
        } else {
          setStep('duration');
          appendAgent(durationPrompt(dt.type));
        }
        break;
      }
      case 'planFilter': {
        let ids: string[];
        if (n === 1) ids = showAllPlans(p => p.status !== 'Archived', 'all but archived');
        else if (n === 2) ids = showAllPlans(() => true, 'all statuses');
        else {
          const stage = planStages[n - 3];
          ids = showAllPlans(p => p.status === stage, stage);
        }
        // After listing, offer to select a result or search again.
        setStep('planResults');
        appendAgent(planResultsPrompt(ids));
        break;
      }
      case 'planResults': {
        if (planChoiceIds.length > 0 && n === 1) {
          setStep('planSelect');
          appendAgent(planSelectPrompt());
        } else {
          // "Search again for plans" (n===1 when no results, n===2 otherwise).
          setStep('planFilter');
          appendAgent(planFilterPrompt());
        }
        break;
      }
      case 'planSelect': {
        const plan = allPlans.find(p => p.id === planChoiceIds[n - 1]);
        if (plan) showPlanItems(plan);
        break;
      }
      case 'duration':
        enterDuration(periodsOfType(durationType)[n - 1].id);
        break;
      case 'planPick': {
        const plan = allPlans.find(p => p.id === planChoiceIds[n - 1]);
        if (plan) showPlanItems(plan);
        break;
      }
      case 'result':
        if (n === 1) { setVpEachIndex(0); setStep('vpEach'); appendAgent(vpEachPrompt(0)); }
        else if (n === 2) { setStep('vpPick'); appendAgent(vpPickPrompt()); }
        else if (n === 3) { reshowResult(); }
        else if (n === 4) {
          const kids = childPlansOf(resultPlanId);
          if (kids.length === 0) {
            appendAgent(textMsg('This plan has no child plans.'));
            appendAgent(menuMsg('What would you like to do next?', resultObjectiveIds.length > 0 ? RESULT_ACTIONS : []));
          } else {
            setStep('childPlanPick');
            appendAgent(childPlanPickPrompt());
          }
        }
        break;
      case 'childPlanPick': {
        const child = childPlansOf(resultPlanId)[n - 1];
        const parent = allPlans.find(p => p.id === resultPlanId);
        if (child && parent) showSplit(parent, child);
        break;
      }
      case 'splitMenu': {
        if (n === 1) { showAssigneeBreakdown(); appendAgent(splitMenuPrompt()); }
        else if (n === 2) { showUnassignedChildItems(); appendAgent(splitMenuPrompt()); }
        else if (n === 3) { showPromptFor('result'); }
        break;
      }
      case 'delivAssignee': {
        const u = usersSorted[n - 1];
        if (u) startDeliverableParent(u);
        break;
      }
      case 'vpPick': {
        const id = resultObjectiveIds[n - 1];
        setVpTargetId(id);
        setStep('itemAction');
        appendAgent(itemActionPrompt(id));
        break;
      }
      case 'itemAction':
        if (n === 1) { setStep('vpItem'); appendAgent(vpItemPrompt(objTitle(vpTargetId))); }
        else if (n === 2) { showChildren(vpTargetId); appendAgent(itemActionPrompt(vpTargetId)); }
        else if (n === 3) { showFamily(vpTargetId); appendAgent(itemActionPrompt(vpTargetId)); }
        else if (n === 4) { setStep('changeDuration'); appendAgent(changeDurationPrompt()); }
        break;
      case 'changeDuration': {
        const period = periodsSorted[n - 1];
        changeItemDuration(vpTargetId, period);
        break;
      }
      default:
        break;
    }
  };

  const visibleSessions = sessions
    .filter(s => (showArchived ? true : !s.archived))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-xl font-bold text-gray-900">Agent</h1>
        <button
          onClick={startOver}
          className="text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-300 rounded px-2 py-1"
          title="Clear this chat and start over"
        >
          Start over
        </button>
        <button
          onClick={() => setShowSessions(v => !v)}
          className="text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-300 rounded px-2 py-1"
        >
          {showSessions ? 'Hide Sessions' : 'Show sessions'}
        </button>
      </div>
      <div className="flex gap-4" style={{ height: '72vh' }}>
        {/* Sessions */}
        {showSessions && (
        <div className="w-64 flex-shrink-0 bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col">
          <div className="p-3 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">Sessions</span>
            <button onClick={startNew} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ New</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {visibleSessions.length === 0 ? (
              <p className="p-3 text-xs text-gray-400">No sessions yet.</p>
            ) : (
              visibleSessions.map(s => (
                <div
                  key={s.id}
                  onClick={() => loadSession(s)}
                  className={`group px-3 py-2 border-b border-gray-100 cursor-pointer ${s.id === activeId ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm text-gray-800 truncate" title={s.title}>{s.title || 'New chat'}</span>
                    <div className="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); setArchived(s.id, !s.archived); }}
                        className="text-[11px] text-gray-400 hover:text-gray-700"
                        title={s.archived ? 'Restore' : 'Archive'}
                      >
                        {s.archived ? 'Restore' : 'Archive'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                        className="text-[11px] text-gray-400 hover:text-red-600"
                        title="Delete"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-400">{fmtDateTime(s.updatedAt)}{s.archived ? ' · archived' : ''}</div>
                </div>
              ))
            )}
          </div>
          <label className="p-2 border-t border-gray-200 flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            Show archived
          </label>
        </div>
        )}

        {/* Chat */}
        <div className="flex-1 min-w-0 bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {(() => {
              const lastDelivIdx = transcript.reduce((acc, mm, idx) => (mm.role === 'agent' && mm.kind === 'deliverable' ? idx : acc), -1);
              return transcript.map((m, i) => {
                // Reconnect prompt — needs a live callback to start the OAuth flow.
                if (m.role === 'agent' && m.kind === 'reauth') {
                  return (
                    <div key={i} className="flex justify-start">
                      <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-amber-50 border border-amber-200 text-amber-900">
                        <p className="mb-2">{m.message}</p>
                        <button
                          onClick={login}
                          className="text-xs font-medium bg-amber-600 text-white rounded px-3 py-1.5 hover:bg-amber-700"
                        >
                          Reconnect Google
                        </button>
                        <p className="text-[11px] text-amber-700 mt-2">You'll return here after granting access — then pick Engineering again.</p>
                      </div>
                    </div>
                  );
                }
                // The deliverable picker is interactive and rendered with live callbacks.
                if (m.role === 'agent' && m.kind === 'deliverable') {
                  return (
                    <div key={i} className="flex justify-start">
                      <div className="w-full text-sm text-gray-800">
                        <MsgBoundary>
                          <AgentDeliverablePicker
                            draft={m}
                            active={step === 'delivParent' && i === lastDelivIdx}
                            onSelect={(parent) => createDeliverableFrom(m, parent)}
                            onCancel={cancelDeliverable}
                          />
                        </MsgBoundary>
                      </div>
                    </div>
                  );
                }
                // The embedded objective tree needs full width, not the narrow bubble.
                const wide = m.role === 'agent' && (m.kind === 'objlist' || m.kind === 'split' || m.kind === 'releases' || m.kind === 'jira');
                return (
                  <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    <div className={wide ? 'w-full text-sm text-gray-800' : `max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                      <MsgBoundary><RenderedMsg m={m} /></MsgBoundary>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
            className="border-t border-gray-200 p-3 flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a number…"
              autoFocus
              className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
