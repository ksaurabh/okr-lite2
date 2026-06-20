import { Component, useEffect, useMemo, useRef, useState } from 'react';
import { useOKRStore, type OKRStore, type ColumnKey } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import { ObjectiveTree } from '../objectives/ObjectiveTree';
import type { List, User, WorkflowStatus } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';
const SESSIONS_URL = `${API_URL}/api/users/me/agent-sessions`;

type Step = 'root' | 'treeBrowse' | 'durationGroupPick' | 'planMembershipPick' | 'user' | 'durationType' | 'planFilter' | 'planResults' | 'planSelect' | 'duration' | 'planPick' | 'result' | 'vpEach' | 'vpPick' | 'itemAction' | 'changeDuration' | 'vpItem';

// Serializable chat messages (so sessions can be persisted and resumed).
type Msg =
  | { role: 'user'; kind: 'text'; text: string }
  | { role: 'agent'; kind: 'text'; text: string; tone?: 'error' }
  | { role: 'agent'; kind: 'menu'; title: string; code?: string; options: string[]; baseCount: number }
  | { role: 'agent'; kind: 'plan'; planName: string; who: string; period: string; items: { id: string; title: string; vp: number; missing?: boolean; kr?: boolean }[]; total: number; code?: string }
  | { role: 'agent'; kind: 'children'; parent: string; items: { id: string; title: string; vp: number; duration: string; status: string }[] }
  | { role: 'agent'; kind: 'plans'; who: string; filter?: string; items: { id: string; name: string; type: string; period: string; status: string }[] }
  | { role: 'agent'; kind: 'family'; subject: string; rows: { name: string; rel: string; duration: string; vp: number; owner: string; assignee: string; self?: boolean }[] }
  | { role: 'agent'; kind: 'objlist'; title: string; ids: string[]; code?: string };

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

const ROOT_OPTIONS = ['Set my OKRs', 'Browse Objective Tree'];
const DURATION_TYPES = [
  { label: 'Quarterly', type: 'quarter' },
  { label: 'Monthly', type: 'month' },
  { label: 'Weekly', type: 'week' },
] as const;
const RESULT_ACTIONS = ['Update VP on every item', 'Select an item', 'Reload the plan'];
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
  vpEach: 'result',
  vpPick: 'result',
  itemAction: 'vpPick',
  changeDuration: 'itemAction',
  vpItem: 'itemAction',
};

const VALUE_STEPS: Step[] = ['vpEach', 'vpItem'];

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
              <p className="mt-1 text-sm font-medium">Total {m.total} VP</p>
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

export function AgentPage() {
  const { user } = useAuth();
  const userEmail = user?.email || '';

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
  const [showSessions, setShowSessions] = useState(true);
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
      case 'vpPick': appendAgent(vpPickPrompt()); break;
      case 'itemAction': appendAgent(itemActionPrompt()); break;
      case 'changeDuration': appendAgent(changeDurationPrompt()); break;
      case 'vpEach': appendAgent(vpEachPrompt(vpEachIndex)); break;
      case 'vpItem': appendAgent(vpItemPrompt(objTitle(vpTargetId))); break;
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
        else { setStep('treeBrowse'); appendAgent(treeBrowsePrompt()); }
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
        break;
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
            {transcript.map((m, i) => {
              // The embedded objective tree needs full width, not the narrow bubble.
              const wide = m.role === 'agent' && m.kind === 'objlist';
              return (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={wide ? 'w-full text-sm text-gray-800' : `max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                    <MsgBoundary>{renderMsg(m)}</MsgBoundary>
                  </div>
                </div>
              );
            })}
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
