import { useEffect, useMemo, useRef, useState } from 'react';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { useAuth } from '../../context/AuthContext';
import type { List, User } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';

type Step = 'root' | 'user' | 'durationType' | 'duration' | 'result' | 'vpEach' | 'vpPick' | 'vpItem';

interface Entry {
  role: 'agent' | 'user';
  content: React.ReactNode;
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

// Which step "Go back" returns to from each step.
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

// Steps where the typed input is a free value (the VP number) rather than a menu index.
const VALUE_STEPS: Step[] = ['vpEach', 'vpItem'];

function fmtDate(d?: string): string {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function periodLabel(p: { name: string; startDate?: string; endDate?: string }): string {
  const range = [fmtDate(p.startDate), fmtDate(p.endDate)].filter(Boolean).join(' – ');
  return range ? `${p.name} (${range})` : p.name;
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
  const [step, setStep] = useState<Step>('root');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [durationType, setDurationType] = useState<string>('');
  const [resultPeriodId, setResultPeriodId] = useState('');
  const [resultObjectiveIds, setResultObjectiveIds] = useState<string[]>([]);
  const [vpTargetId, setVpTargetId] = useState('');
  const [vpEachIndex, setVpEachIndex] = useState(0);
  const [input, setInput] = useState('');
  const [transcript, setTranscript] = useState<Entry[]>([]);
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

  // Durations of the given type that are still active or start in the future
  // (not already ended). Periods with no end date are treated as ongoing.
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

  // Renders a menu prompt: domain options, then "Go back" and "Start over",
  // numbered continuously so the user can type any of them.
  const optionsNode = (title: string, baseOpts: string[]) => {
    const all = [...baseOpts, BACK_LABEL, RESTART_LABEL];
    return (
      <div>
        <p className="mb-1">{title}</p>
        <ol className="space-y-0.5">
          {all.map((o, i) => (
            <li key={i} className={i >= baseOpts.length ? 'text-gray-500' : undefined}>
              <span className="text-gray-400 tabular-nums">{i + 1}.</span> {o}
            </li>
          ))}
        </ol>
      </div>
    );
  };

  const rootPrompt = () => optionsNode("Hi — I'm your OKR agent. Type the number of an option:", ROOT_OPTIONS);
  const userPrompt = () => optionsNode('Whose OKRs would you like to set? Type the number:', userOptions());
  const durationTypePrompt = () => optionsNode('What kind of duration? Type the number:', durationTypeOptions());
  const durationPrompt = (type: string) => optionsNode('For which duration? Type the number:', durationOptions(type));
  const vpPickPrompt = () => optionsNode('Which item? Type the number:', resultObjectiveIds.map(itemLabel));
  const vpEachPrompt = (index: number) => {
    const id = resultObjectiveIds[index];
    const o = useOKRStore.getState().objectives.find(x => x.id === id);
    return (
      <>
        Item {index + 1} of {resultObjectiveIds.length} — type the value points for "{o?.title || id}" (currently {o?.valuePoints ?? 0} VP).
        {' '}(Type <span className="font-medium">b</span> to go back, <span className="font-medium">s</span> to start over, or <span className="font-medium">c</span> to see its children.)
      </>
    );
  };
  const vpItemPrompt = (title: string) => (
    <>Type the value points to set on "{title}". (Type <span className="font-medium">b</span> to go back, <span className="font-medium">s</span> to start over, or <span className="font-medium">c</span> to see its children.)</>
  );

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

  const appendAgent = (content: React.ReactNode) => setTranscript(t => [...t, { role: 'agent', content }]);
  const appendUser = (content: React.ReactNode) => setTranscript(t => [...t, { role: 'user', content }]);

  useEffect(() => {
    fetchSharedPlans();
    fetch(`${API_URL}/api/users`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { users: [] }))
      .then(d => setOrgUsers(d.users || []))
      .catch(() => { /* ignore */ });
    setTranscript([{ role: 'agent', content: rootPrompt() }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSharedPlans]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [transcript]);

  const showPlanResult = (periodId: string) => {
    setResultPeriodId(periodId);
    const period = periodsSorted.find(p => p.id === periodId);
    const u = usersSorted.find(x => x.id === selectedUserId);
    const userName = u?.name || u?.email || 'that user';
    const periodName = period ? periodLabel(period) : 'that duration';
    const plan = allPlans.find(p => p.ownerId === selectedUserId && p.periodId === periodId);
    const objs = useOKRStore.getState().objectives;

    if (!plan) {
      setResultObjectiveIds([]);
      appendAgent(<p>No plan is defined for <span className="font-medium">{userName}</span> for <span className="font-medium">{periodName}</span>.</p>);
      appendAgent(optionsNode('What would you like to do next?', []));
      return;
    }

    const sortedItems = [...plan.items].sort((a, b) => a.order - b.order);
    setResultObjectiveIds(sortedItems.map(it => it.objectiveId));
    const items = sortedItems.map(it => {
      const obj = objs.find(o => o.id === it.objectiveId);
      return { title: obj?.title || it.objectiveId, vp: obj?.valuePoints ?? 0, missing: !obj };
    });
    const total = items.reduce((sum, i) => sum + i.vp, 0);

    appendAgent(
      <div>
        <p>
          Plan <span className="font-medium">{plan.name}</span> for <span className="font-medium">{userName}</span> · <span className="font-medium">{periodName}</span>
          {' '}— {items.length} {items.length === 1 ? 'item' : 'items'}:
        </p>
        {items.length > 0 ? (
          <table className="mt-2 text-sm">
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0">
                  <td className="py-1 pr-4 text-gray-400 tabular-nums align-top">{i + 1}.</td>
                  <td className="py-1 pr-6 text-gray-800">{it.title}{it.missing && <span className="text-gray-400"> (not visible)</span>}</td>
                  <td className="py-1 text-gray-600 tabular-nums whitespace-nowrap">{it.vp} VP</td>
                </tr>
              ))}
              <tr>
                <td></td>
                <td className="py-1 pr-6 font-medium text-gray-800">Total</td>
                <td className="py-1 font-medium text-gray-800 tabular-nums whitespace-nowrap">{total} VP</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="text-gray-500 mt-1">This plan has no items yet.</p>
        )}
      </div>
    );
    appendAgent(optionsNode('What would you like to do next?', items.length > 0 ? RESULT_ACTIONS : []));
  };

  const showPromptFor = (s: Step) => {
    setStep(s);
    switch (s) {
      case 'root': appendAgent(rootPrompt()); break;
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
      appendAgent(<>Set value points to <span className="font-medium">{v}</span> on {ids.length} {ids.length === 1 ? 'item' : 'items'}.</>);
    } catch (err) {
      appendAgent(<span className="text-red-600">Couldn't update value points: {err instanceof Error ? err.message : String(err)}</span>);
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
      appendAgent(<span className="text-red-600">Couldn't update "{objTitle(id)}": {err instanceof Error ? err.message : String(err)}</span>);
    }
    const next = vpEachIndex + 1;
    if (next < resultObjectiveIds.length) {
      setVpEachIndex(next);
      appendAgent(vpEachPrompt(next));
    } else {
      appendAgent(<>Done — updated value points on all {resultObjectiveIds.length} {resultObjectiveIds.length === 1 ? 'item' : 'items'}.</>);
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
      appendAgent(<>"{parent?.title || id}" has no children.</>);
      return;
    }
    appendAgent(
      <div>
        <p>Children of "{parent?.title || id}" ({children.length}):</p>
        <table className="mt-1 text-sm">
          <tbody>
            {children.map((c, i) => (
              <tr key={c.id} className="border-b border-gray-100 last:border-0">
                <td className="py-1 pr-4 text-gray-400 tabular-nums align-top">{i + 1}.</td>
                <td className="py-1 pr-6 text-gray-800">{c.title}</td>
                <td className="py-1 text-gray-600 tabular-nums whitespace-nowrap">{c.valuePoints ?? 0} VP</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const handleSubmit = () => {
    const raw = input.trim();
    if (!raw) return;
    setInput('');
    appendUser(raw);

    // Free value-entry steps: the input is the VP number (or a back/start command).
    if (VALUE_STEPS.includes(step)) {
      const lower = raw.toLowerCase();
      if (lower === 'b' || lower === 'back') {
        // In the per-item walk, "back" steps to the previous item first.
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
        // Re-show the current prompt so the user can keep entering the value.
        if (step === 'vpEach') appendAgent(vpEachPrompt(vpEachIndex));
        else appendAgent(vpItemPrompt(objTitle(vpTargetId)));
        return;
      }
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) {
        appendAgent(<>Please type a number for the value points, or <span className="font-medium">b</span> to go back, <span className="font-medium">s</span> to start over, or <span className="font-medium">c</span> to see its children.</>);
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
      appendAgent(<>Please type a number between 1 and {totalOpts}.</>);
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
          appendAgent(<>No {dt.label.toLowerCase()} durations are active or upcoming. Pick another type:</>);
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

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-4">Agent</h1>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col" style={{ height: '70vh' }}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {transcript.map((e, i) => (
            <div key={i} className={e.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  e.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'
                }`}
              >
                {e.content}
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
  );
}
