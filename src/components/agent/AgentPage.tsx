import { useEffect, useMemo, useRef, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import type { List, User } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';
const SESSIONS_URL = `${API_URL}/api/users/me/agent-sessions`;

type Step = 'root' | 'user' | 'durationType' | 'duration' | 'result' | 'vpEach' | 'vpPick' | 'vpItem';

// Serializable chat messages (so sessions can be persisted and resumed).
type Msg =
  | { role: 'user'; kind: 'text'; text: string }
  | { role: 'agent'; kind: 'text'; text: string; tone?: 'error' }
  | { role: 'agent'; kind: 'menu'; title: string; options: string[]; baseCount: number }
  | { role: 'agent'; kind: 'plan'; planName: string; who: string; period: string; items: { title: string; vp: number; missing?: boolean }[]; total: number }
  | { role: 'agent'; kind: 'children'; parent: string; items: { title: string; vp: number }[] };

interface SessionState {
  step: Step;
  selectedUserId: string;
  durationType: string;
  resultPeriodId: string;
  resultObjectiveIds: string[];
  vpTargetId: string;
  vpEachIndex: number;
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

const ROOT_OPTIONS = ['Set my OKRs'];
const DURATION_TYPES = [
  { label: 'Quarterly', type: 'quarter' },
  { label: 'Monthly', type: 'month' },
  { label: 'Weekly', type: 'week' },
] as const;
const RESULT_ACTIONS = ['Update VP on every item', 'Update VP on a selected item'];
const BACK_LABEL = 'Go back';
const RESTART_LABEL = 'Start over';

const PREV: Record<Step, Step> = {
  root: 'root',
  user: 'root',
  durationType: 'user',
  duration: 'durationType',
  result: 'duration',
  vpEach: 'result',
  vpPick: 'result',
  vpItem: 'vpPick',
};

const VALUE_STEPS: Step[] = ['vpEach', 'vpItem'];

const menuMsg = (title: string, baseOpts: string[]): Msg => ({ role: 'agent', kind: 'menu', title, options: [...baseOpts, BACK_LABEL, RESTART_LABEL], baseCount: baseOpts.length });
const textMsg = (text: string, tone?: 'error'): Msg => ({ role: 'agent', kind: 'text', text, ...(tone ? { tone } : {}) });
const userMsg = (text: string): Msg => ({ role: 'user', kind: 'text', text });
const planMsg = (planName: string, who: string, period: string, items: { title: string; vp: number; missing?: boolean }[], total: number): Msg => ({ role: 'agent', kind: 'plan', planName, who, period, items, total });
const childrenMsg = (parent: string, items: { title: string; vp: number }[]): Msg => ({ role: 'agent', kind: 'children', parent, items });

const rootPromptMsg = (): Msg => menuMsg("Hi — I'm your OKR agent. Type the number of an option:", ROOT_OPTIONS);
const initialState = (): SessionState => ({ step: 'root', selectedUserId: '', durationType: '', resultPeriodId: '', resultObjectiveIds: [], vpTargetId: '', vpEachIndex: 0 });

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
          <p className="mb-1">{m.title}</p>
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
            <table className="mt-2 text-sm">
              <tbody>
                {m.items.map((it, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className="py-1 pr-4 text-gray-400 tabular-nums align-top">{i + 1}.</td>
                    <td className="py-1 pr-6 text-gray-800">{it.title}{it.missing && <span className="text-gray-400"> (not visible)</span>}</td>
                    <td className="py-1 text-gray-600 tabular-nums whitespace-nowrap">{it.vp} VP</td>
                  </tr>
                ))}
                <tr>
                  <td></td>
                  <td className="py-1 pr-6 font-medium text-gray-800">Total</td>
                  <td className="py-1 font-medium text-gray-800 tabular-nums whitespace-nowrap">{m.total} VP</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="text-gray-500 mt-1">This plan has no items yet.</p>
          )}
        </div>
      );
    case 'children':
      return (
        <div>
          <p>Children of "{m.parent}" ({m.items.length}):</p>
          <table className="mt-1 text-sm">
            <tbody>
              {m.items.map((c, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0">
                  <td className="py-1 pr-4 text-gray-400 tabular-nums align-top">{i + 1}.</td>
                  <td className="py-1 pr-6 text-gray-800">{c.title}</td>
                  <td className="py-1 text-gray-600 tabular-nums whitespace-nowrap">{c.vp} VP</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
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

  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeId, setActiveId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('New chat');

  const [step, setStep] = useState<Step>('root');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [durationType, setDurationType] = useState<string>('');
  const [resultPeriodId, setResultPeriodId] = useState('');
  const [resultObjectiveIds, setResultObjectiveIds] = useState<string[]>([]);
  const [vpTargetId, setVpTargetId] = useState('');
  const [vpEachIndex, setVpEachIndex] = useState(0);
  const [input, setInput] = useState('');
  const [transcript, setTranscript] = useState<Msg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

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
  const periodTypeOf = (periodId?: string) => periods.find(p => p.id === periodId)?.type;
  const planCount = (predicate: (p: List) => boolean) => allPlans.filter(predicate).length;
  const withCount = (label: string, c: number) => `${label} (${c} ${c === 1 ? 'plan' : 'plans'})`;
  const userOptions = () => usersSorted.map(u => withCount(u.name || u.email, planCount(p => p.ownerId === u.id)));
  const durationTypeOptions = () => DURATION_TYPES.map(d => withCount(d.label, planCount(p => p.ownerId === selectedUserId && periodTypeOf(p.periodId) === d.type)));
  const durationOptions = (type: string) => periodsOfType(type).map(p => withCount(periodLabel(p), planCount(pl => pl.ownerId === selectedUserId && pl.periodId === p.id)));

  const objTitle = (id: string) => useOKRStore.getState().objectives.find(o => o.id === id)?.title || id;
  const itemLabel = (id: string) => {
    const o = useOKRStore.getState().objectives.find(x => x.id === id);
    return `${o?.title || id} — ${o?.valuePoints ?? 0} VP`;
  };

  const userPrompt = () => menuMsg('Whose OKRs would you like to set? Type the number:', userOptions());
  const durationTypePrompt = () => menuMsg('What kind of duration? Type the number:', durationTypeOptions());
  const durationPrompt = (type: string) => menuMsg('For which duration? Type the number:', durationOptions(type));
  const vpPickPrompt = () => menuMsg('Which item? Type the number:', resultObjectiveIds.map(itemLabel));
  const vpEachPrompt = (index: number): Msg => {
    const o = useOKRStore.getState().objectives.find(x => x.id === resultObjectiveIds[index]);
    return textMsg(`Item ${index + 1} of ${resultObjectiveIds.length} — type the value points for "${o?.title || resultObjectiveIds[index]}" (currently ${o?.valuePoints ?? 0} VP). (Type b to go back, s to start over, or c to see its children.)`);
  };
  const vpItemPrompt = (title: string): Msg => textMsg(`Type the value points to set on "${title}". (Type b to go back, s to start over, or c to see its children.)`);

  const baseOptions = (s: Step): string[] => {
    switch (s) {
      case 'root': return ROOT_OPTIONS;
      case 'user': return userOptions();
      case 'durationType': return durationTypeOptions();
      case 'duration': return durationOptions(durationType);
      case 'result': return resultObjectiveIds.length > 0 ? RESULT_ACTIONS : [];
      case 'vpPick': return resultObjectiveIds.map(itemLabel);
      default: return [];
    }
  };

  const appendAgent = (m: Msg) => setTranscript(t => [...t, m]);
  const appendUser = (text: string) => setTranscript(t => [...t, userMsg(text)]);

  // ---- Sessions ----
  const loadSession = (s: AgentSession) => {
    setActiveId(s.id);
    setSessionTitle(s.title || 'New chat');
    setTranscript(s.transcript || []);
    const st = s.state || initialState();
    setStep(st.step || 'root');
    setSelectedUserId(st.selectedUserId || '');
    setDurationType(st.durationType || '');
    setResultPeriodId(st.resultPeriodId || '');
    setResultObjectiveIds(st.resultObjectiveIds || []);
    setVpTargetId(st.vpTargetId || '');
    setVpEachIndex(st.vpEachIndex || 0);
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
            state: { step, selectedUserId, durationType, resultPeriodId, resultObjectiveIds, vpTargetId, vpEachIndex },
          }),
        });
        if (res.ok) {
          const d = await res.json();
          setSessions(prev => prev.map(s => (s.id === activeId ? d.session : s)));
        }
      } catch { /* ignore */ }
    }, 500);
    return () => clearTimeout(t);
  }, [transcript, step, selectedUserId, durationType, resultPeriodId, resultObjectiveIds, vpTargetId, vpEachIndex, sessionTitle, activeId]);

  const showPlanResult = (periodId: string) => {
    setResultPeriodId(periodId);
    const period = periodsSorted.find(p => p.id === periodId);
    const u = usersSorted.find(x => x.id === selectedUserId);
    const userName = u?.name || u?.email || 'that user';
    const periodName = period ? periodLabel(period) : 'that duration';
    const plan = allPlans.find(p => p.ownerId === selectedUserId && p.periodId === periodId);
    const objs = useOKRStore.getState().objectives;
    setSessionTitle(`${userName} · ${periodName}`);

    if (!plan) {
      setResultObjectiveIds([]);
      appendAgent(textMsg(`No plan is defined for ${userName} for ${periodName}.`));
      appendAgent(menuMsg('What would you like to do next?', []));
      return;
    }

    const sorted = [...plan.items].sort((a, b) => a.order - b.order);
    setResultObjectiveIds(sorted.map(it => it.objectiveId));
    const items = sorted.map(it => {
      const obj = objs.find(o => o.id === it.objectiveId);
      return { title: obj?.title || it.objectiveId, vp: obj?.valuePoints ?? 0, missing: !obj };
    });
    const total = items.reduce((sum, i) => sum + i.vp, 0);
    appendAgent(planMsg(plan.name, userName, periodName, items, total));
    appendAgent(menuMsg('What would you like to do next?', items.length > 0 ? RESULT_ACTIONS : []));
  };

  const showPromptFor = (s: Step) => {
    setStep(s);
    switch (s) {
      case 'root': appendAgent(rootPromptMsg()); break;
      case 'user': appendAgent(userPrompt()); break;
      case 'durationType': appendAgent(durationTypePrompt()); break;
      case 'duration': appendAgent(durationPrompt(durationType)); break;
      case 'result': showPlanResult(resultPeriodId); break;
      case 'vpPick': appendAgent(vpPickPrompt()); break;
      case 'vpEach': appendAgent(vpEachPrompt(vpEachIndex)); break;
      case 'vpItem': appendAgent(vpItemPrompt(objTitle(vpTargetId))); break;
    }
  };

  const goBack = () => showPromptFor(PREV[step]);

  const restart = () => {
    setSelectedUserId('');
    setDurationType('');
    setResultObjectiveIds([]);
    showPromptFor('root');
  };

  const applyVp = async (ids: string[], v: number) => {
    try {
      for (const id of ids) await updateObjective(id, { valuePoints: v }, userEmail);
      appendAgent(textMsg(`Set value points to ${v} on ${ids.length} ${ids.length === 1 ? 'item' : 'items'}.`));
    } catch (err) {
      appendAgent(textMsg(`Couldn't update value points: ${err instanceof Error ? err.message : String(err)}`, 'error'));
    }
    setStep('result');
    showPlanResult(resultPeriodId);
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
      setStep('result');
      showPlanResult(resultPeriodId);
    }
  };

  const showChildren = (id: string) => {
    const objs = useOKRStore.getState().objectives;
    const parent = objs.find(o => o.id === id);
    const children = objs
      .filter(o => o.parentId === id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.title.localeCompare(b.title));
    if (children.length === 0) {
      appendAgent(textMsg(`"${parent?.title || id}" has no children.`));
      return;
    }
    appendAgent(childrenMsg(parent?.title || id, children.map(c => ({ title: c.title, vp: c.valuePoints ?? 0 }))));
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

    switch (step) {
      case 'root':
        showPromptFor('user');
        break;
      case 'user':
        setSelectedUserId(usersSorted[n - 1].id);
        showPromptFor('durationType');
        break;
      case 'durationType': {
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
      case 'duration':
        setStep('result');
        showPlanResult(periodsOfType(durationType)[n - 1].id);
        break;
      case 'result':
        if (n === 1) { setVpEachIndex(0); setStep('vpEach'); appendAgent(vpEachPrompt(0)); }
        else if (n === 2) { setStep('vpPick'); appendAgent(vpPickPrompt()); }
        break;
      case 'vpPick': {
        const id = resultObjectiveIds[n - 1];
        setVpTargetId(id);
        setStep('vpItem');
        appendAgent(vpItemPrompt(objTitle(id)));
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
      <h1 className="text-xl font-bold text-gray-900 mb-4">Agent</h1>
      <div className="flex gap-4" style={{ height: '72vh' }}>
        {/* Sessions */}
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
                    <button
                      onClick={(e) => { e.stopPropagation(); setArchived(s.id, !s.archived); }}
                      className="text-[11px] text-gray-400 hover:text-gray-700 opacity-0 group-hover:opacity-100 flex-shrink-0"
                      title={s.archived ? 'Restore' : 'Archive'}
                    >
                      {s.archived ? 'Restore' : 'Archive'}
                    </button>
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

        {/* Chat */}
        <div className="flex-1 min-w-0 bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {transcript.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                  {renderMsg(m)}
                </div>
              </div>
            ))}
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
