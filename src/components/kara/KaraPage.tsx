import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { renderNoteMarkdown } from '../mindmaps/markdown';
import { Modal } from '../common/Modal';
import { MarkdownAnswerEditor, MarkdownAnswerView } from './MarkdownAnswer';
import { useOKRStore } from '../../store/okrStore';
import type { ObjectiveType, Period } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || '';
const KARA_URL = `${API_URL}/api/kara`;
const DEFAULT_GOAL = 'Weekly check-in on my objectives and key results';

type CheckinStatus = 'active' | 'wrapping-up' | 'completed';

interface CheckinSummary {
  id: string;
  goal: string;
  status: CheckinStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  hasReport: boolean;
}

const OBJECTIVE_TYPES: ObjectiveType[] = ['initiative', 'saga', 'epic', 'story', 'subtask'];

interface Proposal {
  action: 'create_objective';
  title: string;
  type: string;
  period: string;
  reason?: string;
  status: 'pending' | 'created' | 'declined' | 'skipped';
  objectiveId?: string;
}

type ProposalDecision = { accept: false } | { accept: true; title: string; type: string; periodId: string };

interface KaraMessage {
  id?: string;
  role: 'kara' | 'user';
  text: string;
  at: string;
  regenerated?: boolean;
  options?: string[];
  proposal?: Proposal;
}

interface Checkin {
  id: string;
  goal: string;
  status: CheckinStatus;
  createdAt: string;
  updatedAt: string;
  messages: KaraMessage[];
  answers: { topic: string; question: string; answer: string; at: string }[];
  report: string | null;
  reportAt: string | null;
}

interface Playbook {
  content: string;
  updatedAt: string | null;
  updatedBy: string | null;
  canEdit: boolean;
  canAdmin?: boolean;
}

// The exact request sent to Claude for one of Kara's messages (super admins).
interface PromptRecord {
  at: string;
  request: { system: string; messages: { role: string; content: string }[] } & Record<string, unknown>;
  response: { model?: string; stop_reason?: string; usage?: Record<string, unknown>; text: string };
}

type Pane = 'start' | 'chat' | 'report' | 'answers';

// Width of the playbook panel, remembered per browser.
const PLAYBOOK_WIDTH_KEY = 'kara-playbook-width';
const PLAYBOOK_MIN_WIDTH = 260;
const CHAT_MIN_WIDTH = 360;

function loadPlaybookWidth(): number {
  try {
    const w = Number(localStorage.getItem(PLAYBOOK_WIDTH_KEY));
    return Number.isFinite(w) && w >= PLAYBOOK_MIN_WIDTH ? w : 440;
  } catch {
    return 440;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${KARA_URL}${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

function Markdown({ text }: { text: string }) {
  return <div className="note-md text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: renderNoteMarkdown(text) }} />;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const STATUS_LABEL: Record<CheckinStatus, string> = {
  active: 'In progress',
  'wrapping-up': 'Ready for report',
  completed: 'Complete',
};

export function KaraPage({ onExit }: { onExit: () => void }) {
  const [checkins, setCheckins] = useState<CheckinSummary[]>([]);
  const [current, setCurrent] = useState<Checkin | null>(null);
  const [pane, setPane] = useState<Pane>('start');
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<null | 'starting' | 'replying' | 'reporting' | 'regenerating'>(null);
  const [promptFor, setPromptFor] = useState<{ messageId: string; label: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fetchData = useOKRStore((state) => state.fetchData);
  const periods = useOKRStore((state) => state.periods);
  const [error, setError] = useState<string | null>(null);
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [playbookDraft, setPlaybookDraft] = useState<string | null>(null);
  const [playbookWidth, setPlaybookWidth] = useState(loadPlaybookWidth);
  const [resizing, setResizing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);

  // Dragging the divider: the playbook panel spans from the pointer to the
  // right edge, leaving the chat at least CHAT_MIN_WIDTH.
  const onDividerMove = (e: PointerEvent) => {
    if (!resizing || !splitRef.current) return;
    const rect = splitRef.current.getBoundingClientRect();
    const max = Math.max(PLAYBOOK_MIN_WIDTH, rect.width - CHAT_MIN_WIDTH);
    setPlaybookWidth(Math.min(max, Math.max(PLAYBOOK_MIN_WIDTH, rect.right - e.clientX)));
  };
  const endResize = () => {
    if (!resizing) return;
    setResizing(false);
    try { localStorage.setItem(PLAYBOOK_WIDTH_KEY, String(Math.round(playbookWidth))); } catch { /* ignore */ }
  };

  const loadCheckins = async () => {
    try {
      const data = await api<{ checkins: CheckinSummary[] }>('/checkins');
      setCheckins(data.checkins);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load check-ins');
    }
  };

  useEffect(() => {
    loadCheckins();
    api<Playbook>('/playbook').then(setPlaybook).catch(() => {});
  }, []);

  useEffect(() => {
    if (pane === 'chat') bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [pane, current?.messages.length, busy]);

  const showCheckin = (c: Checkin) => {
    setCurrent(c);
    setCheckins(list => {
      const summary: CheckinSummary = {
        id: c.id, goal: c.goal, status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt,
        messageCount: c.messages.length, hasReport: !!c.report,
      };
      const rest = list.filter(x => x.id !== c.id);
      return [summary, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  };

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const start = () => run('starting', async () => {
    const data = await api<{ checkin: Checkin }>('/checkins', { method: 'POST', body: JSON.stringify({ goal }) });
    showCheckin(data.checkin);
    setPane('chat');
  });

  // Submit an answer: the typed draft, or a choice Kara offered.
  const send = (choice?: string) => {
    const text = (choice ?? draft).trim();
    if (!text || !current || busy) return;
    // Show the message right away; the server echoes the saved transcript back.
    setCurrent({ ...current, messages: [...current.messages, { role: 'user', text, at: new Date().toISOString() }] });
    if (choice === undefined) setDraft('');
    run('replying', async () => {
      try {
        const data = await api<{ checkin: Checkin }>(`/checkins/${current.id}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
        showCheckin(data.checkin);
      } catch (e) {
        setCurrent(current);
        if (choice === undefined) setDraft(text);
        throw e;
      }
    });
  };

  const answerProposal = (decision: ProposalDecision) => {
    if (!current) return;
    const id = current.id;
    run('replying', async () => {
      try {
        const data = await api<{ checkin: Checkin }>(`/checkins/${id}/proposal`, { method: 'POST', body: JSON.stringify(decision) });
        showCheckin(data.checkin);
      } catch (e) {
        // The outcome may be saved even if Kara then failed to reply; reload to show it.
        const data = await api<{ checkin: Checkin }>(`/checkins/${id}`).catch(() => null);
        if (data) showCheckin(data.checkin);
        throw e;
      } finally {
        // A new objective should show up in the rest of the app.
        if (decision.accept) fetchData();
      }
    });
  };

  const retryTurn = () => {
    if (!current) return;
    run('replying', async () => {
      const data = await api<{ checkin: Checkin }>(`/checkins/${current.id}/continue`, { method: 'POST' });
      showCheckin(data.checkin);
    });
  };

  const regenerate = () => {
    if (!current) return;
    run('regenerating', async () => {
      const data = await api<{ checkin: Checkin }>(`/checkins/${current.id}/regenerate`, { method: 'POST' });
      showCheckin(data.checkin);
    });
  };

  const generateReport = () => {
    if (!current) return;
    run('reporting', async () => {
      const data = await api<{ checkin: Checkin }>(`/checkins/${current.id}/report`, { method: 'POST' });
      showCheckin(data.checkin);
      setPane('report');
    });
  };

  const open = (id: string) => run('starting', async () => {
    const data = await api<{ checkin: Checkin }>(`/checkins/${id}`);
    setCurrent(data.checkin);
    setPane(data.checkin.report ? 'report' : 'chat');
  });

  const remove = async (id: string) => {
    if (!window.confirm('Delete this check-in and its report?')) return;
    try {
      await api(`/checkins/${id}`, { method: 'DELETE' });
      setCheckins(list => list.filter(c => c.id !== id));
      if (current?.id === id) { setCurrent(null); setPane('start'); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete');
    }
  };

  const savePlaybook = async () => {
    if (playbookDraft === null) return;
    try {
      const data = await api<Playbook>('/playbook', { method: 'PUT', body: JSON.stringify({ content: playbookDraft }) });
      setPlaybook(data);
      setPlaybookDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the playbook');
    }
  };

  const newCheckin = () => { setCurrent(null); setGoal(DEFAULT_GOAL); setPane('start'); setError(null); };

  const tab = (p: Pane, label: string) => (
    <button
      onClick={() => setPane(p)}
      className={`px-3 py-1.5 text-sm rounded-md ${pane === p ? 'bg-violet-100 text-violet-800 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="h-screen flex flex-col bg-white">
      <div className="flex items-center gap-4 px-4 py-2.5 border-b border-gray-200">
        <button
          onClick={onExit}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to OKR Lite
        </button>
        <div>
          <h1 className="text-base font-semibold text-gray-900 leading-tight">Checkin with Kara</h1>
          <p className="text-xs text-gray-500">Kara: Key Results Assistant</p>
        </div>
        {playbook?.canAdmin && (
          <button
            onClick={() => setSettingsOpen(true)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Kara settings
          </button>
        )}
      </div>
      <div className="flex-1 flex min-h-0">
        {/* History */}
        <aside className="w-64 flex-shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col">
          <div className="p-3 border-b border-gray-200">
            <button
              onClick={newCheckin}
              disabled={!!busy}
              className="w-full bg-violet-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-violet-700 disabled:opacity-60"
            >
              + New check-in
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {checkins.length === 0 ? (
              <p className="text-xs text-gray-400 p-3">No check-ins yet.</p>
            ) : checkins.map(c => (
              <div
                key={c.id}
                className={`group flex items-start gap-1 px-3 py-2 border-b border-gray-100 cursor-pointer ${current?.id === c.id ? 'bg-violet-50' : 'hover:bg-gray-100'}`}
                onClick={() => { if (!busy) open(c.id); }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-800 truncate">{c.goal}</p>
                  <p className="text-xs text-gray-500">{fmtDate(c.createdAt)} · {STATUS_LABEL[c.status]}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); remove(c.id); }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 text-xs px-1"
                  title="Delete check-in"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* Chat and playbook, side by side with a draggable divider */}
        <div ref={splitRef} className={`flex-1 flex min-w-0 ${resizing ? 'select-none cursor-col-resize' : ''}`}>
        <section className="flex-1 flex flex-col min-w-0">
          <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900">Kara</h2>
              <p className="text-xs text-gray-500 truncate">
                {current ? current.goal : 'Key Results Assistant'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {current && pane !== 'start' && (
                <>
                  {tab('chat', 'Questions')}
                  {tab('answers', `Answers (${current.answers.length})`)}
                  {current.report && tab('report', 'Report')}
                </>
              )}
            </div>
          </header>

          {error && (
            <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-red-50 text-sm text-red-700 flex justify-between gap-2">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">✕</button>
            </div>
          )}

          {pane === 'start' && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-xl mx-auto space-y-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Check in with Kara</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Kara looks at your current objectives and key results, asks you about them one question at a time,
                    records your answers, and writes a check-in report when you're done.
                  </p>
                </div>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">What should this check-in focus on?</span>
                  <textarea
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    rows={3}
                    className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </label>
                <button
                  onClick={start}
                  disabled={!!busy}
                  className="bg-violet-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-violet-700 disabled:opacity-60"
                >
                  {busy === 'starting' ? 'Kara is reading your key results…' : 'Start check-in'}
                </button>
              </div>
            </div>
          )}

          {pane === 'chat' && current && (() => {
            const last = current.messages[current.messages.length - 1];
            const awaitingAnswer = last?.role === 'kara' && current.status === 'active';
            const closed = current.status !== 'active';
            const canAdmin = !!playbook?.canAdmin;
            let questionNo = 0;
            return (
              <>
                <div className="flex-1 overflow-y-auto px-6 py-5">
                  <div className="max-w-3xl mx-auto space-y-4">
                    {current.messages.map((m, i) => {
                      if (m.role === 'user') {
                        return (
                          <div key={m.id ?? i} className="ml-6 pl-4 border-l-2 border-violet-200">
                            <p className="text-xs font-medium text-gray-500 mb-0.5">Your answer</p>
                            <MarkdownAnswerView text={m.text} />
                          </div>
                        );
                      }
                      const isLast = i === current.messages.length - 1;
                      const isClosing = isLast && closed;
                      const label = isClosing ? 'Kara' : `Question ${++questionNo}`;
                      const isCurrent = isLast && awaitingAnswer;
                      return (
                        <div
                          key={m.id ?? i}
                          className={`rounded-lg border p-4 ${isCurrent ? 'border-violet-300 bg-violet-50/60 shadow-sm' : 'border-gray-200 bg-white'}`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
                              {label}
                              {m.regenerated && <span className="ml-2 normal-case font-normal text-gray-500">(regenerated)</span>}
                            </p>
                            {canAdmin && (
                              <div className="flex items-center gap-3 text-xs">
                                {isLast && current.status !== 'completed' && (
                                  <button
                                    onClick={regenerate}
                                    disabled={!!busy}
                                    className="text-violet-700 hover:underline disabled:opacity-50"
                                    title="Replace this question with a new one written against the current playbook"
                                  >
                                    {busy === 'regenerating' ? 'Regenerating…' : 'Regenerate question'}
                                  </button>
                                )}
                                {m.id && (
                                  <button onClick={() => setPromptFor({ messageId: m.id!, label })} className="text-gray-500 hover:text-violet-700 hover:underline">
                                    View prompt
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <Markdown text={m.text} />
                          {m.proposal && (isCurrent && m.proposal.status === 'pending' && busy !== 'replying'
                            ? <ProposalCard key={m.id} proposal={m.proposal} periods={periods} disabled={!!busy} onDecide={answerProposal} />
                            : <ProposalOutcome proposal={m.proposal} />)}
                          {isCurrent && busy !== 'replying' && !!m.options?.length && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {m.options.map(o => (
                                <button
                                  key={o}
                                  onClick={() => send(o)}
                                  disabled={!!busy}
                                  className="px-3 py-1.5 rounded-full border border-violet-300 bg-white text-sm text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                                >
                                  {o}
                                </button>
                              ))}
                            </div>
                          )}
                          {isCurrent && busy !== 'replying' && (
                            <div className="mt-4">
                              <MarkdownAnswerEditor
                                value={draft}
                                onChange={setDraft}
                                onSubmit={() => send()}
                                disabled={!!busy}
                                autoFocus
                                placeholder="Type your answer… (markdown supported)"
                              />
                              <div className="mt-2 flex items-center justify-between">
                                <span className="text-xs text-gray-400">Ctrl/⌘ + Enter to submit</span>
                                <button
                                  onClick={() => send()}
                                  disabled={!!busy || !draft.trim()}
                                  className="bg-violet-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                                >
                                  Submit answer
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {busy === 'replying' && (
                      <div className="rounded-lg border border-dashed border-violet-200 p-4 text-sm text-gray-500 italic">
                        Kara is choosing the next question…
                      </div>
                    )}
                    {!busy && last?.role === 'user' && current.status === 'active' && (
                      <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 flex items-center justify-between gap-3">
                        <span>Kara didn't reply to your last answer.</span>
                        <button onClick={retryTurn} className="px-3 py-1.5 rounded-md bg-white border border-amber-300 hover:bg-amber-100">Try again</button>
                      </div>
                    )}
                    {closed && busy !== 'replying' && (
                      <div className="flex flex-col items-center gap-2 pt-2">
                        <button
                          onClick={generateReport}
                          disabled={!!busy}
                          className="bg-violet-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-violet-700 disabled:opacity-60"
                        >
                          {busy === 'reporting' ? 'Writing the report…' : current.report ? 'Regenerate check-in report' : 'Generate check-in report'}
                        </button>
                        {current.status === 'wrapping-up' && (
                          <div className="w-full mt-2">
                            <MarkdownAnswerEditor
                              value={draft}
                              onChange={setDraft}
                              disabled={!!busy}
                              height={120}
                              placeholder="Anything to add before the report? (optional)"
                            />
                            {draft.trim() && (
                              <div className="flex justify-end mt-1">
                                <button onClick={() => send()} disabled={!!busy} className="text-sm text-violet-700 hover:underline">Send to Kara</button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </div>
                </div>
                {current.status === 'active' && (
                  <div className="border-t border-gray-200 px-6 py-2">
                    <button
                      onClick={generateReport}
                      disabled={!!busy || current.messages.length < 2}
                      className="text-xs text-gray-500 hover:text-violet-700 disabled:opacity-50"
                    >
                      {busy === 'reporting' ? 'Writing the report…' : 'Finish now and generate the report'}
                    </button>
                  </div>
                )}
              </>
            );
          })()}

          {pane === 'answers' && current && (
            <div className="flex-1 overflow-y-auto p-6">
              {current.answers.length === 0 ? (
                <p className="text-sm text-gray-500">Kara hasn't recorded any answers yet.</p>
              ) : (
                <div className="space-y-3 max-w-3xl">
                  {current.answers.map((a, i) => (
                    <div key={i} className="border border-gray-200 rounded-md p-3">
                      <p className="text-xs font-medium text-violet-700">{a.topic}</p>
                      <p className="text-sm text-gray-600 mt-0.5">{a.question}</p>
                      <p className="text-sm text-gray-900 mt-1">{a.answer}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {pane === 'report' && current?.report && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-3xl">
                <p className="text-xs text-gray-500 mb-3">Generated {current.reportAt && fmtDate(current.reportAt)}</p>
                <Markdown text={current.report} />
                <button
                  onClick={() => navigator.clipboard?.writeText(current.report ?? '')}
                  className="mt-4 text-sm text-violet-700 hover:underline"
                >
                  Copy report as markdown
                </button>
              </div>
            </div>
          )}

        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setResizing(true); }}
          onPointerMove={onDividerMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          className={`w-1.5 flex-shrink-0 cursor-col-resize border-l border-gray-200 transition-colors ${resizing ? 'bg-violet-400' : 'bg-gray-100 hover:bg-violet-300'}`}
        />

        <aside style={{ width: playbookWidth }} className="flex-shrink-0 flex flex-col min-h-0 bg-gray-50">
          <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900">Kara's playbook</h2>
              <p className="text-xs text-gray-500 truncate">
                {playbook?.updatedAt ? `Last edited ${fmtDate(playbook.updatedAt)} by ${playbook.updatedBy}` : 'Default playbook'}
              </p>
            </div>
            {playbook?.canEdit && playbookDraft === null && (
              <button onClick={() => setPlaybookDraft(playbook.content)} className="text-sm text-violet-700 hover:underline">Edit</button>
            )}
          </header>
          <div className="flex-1 overflow-y-auto p-4">
            {!playbook ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : playbookDraft !== null ? (
              <div className="flex flex-col h-full gap-3">
                <textarea
                  value={playbookDraft}
                  onChange={(e) => setPlaybookDraft(e.target.value)}
                  className="flex-1 min-h-[40vh] w-full font-mono text-sm border border-gray-300 rounded-md p-3 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <div className="flex gap-2">
                  <button onClick={savePlaybook} className="bg-violet-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-violet-700">Save playbook</button>
                  <button onClick={() => setPlaybookDraft(null)} className="px-4 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
                </div>
                <p className="text-xs text-gray-500">Changes apply to check-ins started after saving.</p>
              </div>
            ) : (
              <Markdown text={playbook.content} />
            )}
          </div>
        </aside>
        </div>
      </div>
      {settingsOpen && <KaraSettings onClose={() => setSettingsOpen(false)} />}
      {promptFor && current && (
        <PromptViewer checkinId={current.id} messageId={promptFor.messageId} label={promptFor.label} onClose={() => setPromptFor(null)} />
      )}
    </div>
  );
}

const PROPOSAL_OUTCOME: Record<Exclude<Proposal['status'], 'pending'>, string> = {
  created: 'Created',
  declined: 'Declined',
  skipped: 'Answered instead',
};

function ProposalOutcome({ proposal }: { proposal: Proposal }) {
  if (proposal.status === 'pending') return null;
  return (
    <p className={`mt-2 text-xs ${proposal.status === 'created' ? 'text-green-700' : 'text-gray-500'}`}>
      {PROPOSAL_OUTCOME[proposal.status]}: objective "{proposal.title}"
      {proposal.status === 'created' && ` (${proposal.type}, ${proposal.period})`}
    </p>
  );
}

// Kara's offer to create an objective. Everything is editable before it's
// created; nothing happens until the person clicks Create.
function ProposalCard({ proposal, periods, disabled, onDecide }: {
  proposal: Proposal;
  periods: Period[];
  disabled: boolean;
  onDecide: (decision: ProposalDecision) => void;
}) {
  const open = periods.filter(p => !p.archived);
  const [title, setTitle] = useState(proposal.title);
  const [type, setType] = useState(OBJECTIVE_TYPES.includes(proposal.type as ObjectiveType) ? proposal.type : '');
  const [periodId, setPeriodId] = useState(
    () => open.find(p => p.name.toLowerCase() === proposal.period.toLowerCase())?.id ?? '',
  );
  const field = 'mt-1 w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500';
  return (
    <div className="mt-3 rounded-md border border-violet-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Create objective?</p>
      {proposal.reason && <p className="text-xs text-gray-500 mt-0.5">{proposal.reason}</p>}
      <label className="block mt-2">
        <span className="text-xs text-gray-600">Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
      </label>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <label className="block">
          <span className="text-xs text-gray-600">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} className={field}>
            <option value="">Choose…</option>
            {OBJECTIVE_TYPES.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-600">Period</span>
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className={field}>
            <option value="">Choose…</option>
            {open.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={() => onDecide({ accept: false })}
          disabled={disabled}
          className="px-3 py-1.5 rounded-md text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          Don't create
        </button>
        <button
          onClick={() => onDecide({ accept: true, title: title.trim(), type, periodId })}
          disabled={disabled || !title.trim() || !type || !periodId}
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
        >
          Create objective
        </button>
      </div>
    </div>
  );
}

interface KeyStatus {
  source: 'ui' | 'env' | 'none';
  hint: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

// Super admins: the Anthropic API key Kara uses. The key itself never comes
// back from the server; only where it's set and its last four characters.
function KaraSettings({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<KeyStatus>('/config').then(setStatus).catch((e) => setError(e instanceof Error ? e.message : 'Could not load settings'));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      setStatus(await api<KeyStatus>('/config', { method: 'PUT', body: JSON.stringify({ apiKey: key }) }));
      setKey('');
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the key');
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async () => {
    if (!window.confirm('Remove the API key saved here?')) return;
    setError(null);
    setSaved(false);
    try {
      setStatus(await api<KeyStatus>('/config', { method: 'DELETE' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the key');
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Kara settings">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-gray-800">Anthropic API key</p>
          <p className="text-sm text-gray-600 mt-1">
            {!status ? 'Loading…'
              : status.source === 'ui' ? <>Kara is using the key ending <span className="font-mono">{status.hint}</span>, saved here{status.updatedBy ? ` by ${status.updatedBy}` : ''}{status.updatedAt ? ` on ${fmtDate(status.updatedAt)}` : ''}.</>
              : status.source === 'env' ? <>Kara is using the key ending <span className="font-mono">{status.hint}</span> from the server's <span className="font-mono">.env</span>. A key saved here takes priority.</>
              : 'No key is set, so Kara cannot run check-ins yet.'}
          </p>
        </div>
        <label className="block">
          <span className="text-sm text-gray-700">{status?.source === 'none' ? 'API key' : 'Replace with a new key'}</span>
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => { setKey(e.target.value); setSaved(false); }}
            placeholder="sk-ant-…"
            className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <span className="text-xs text-gray-500">
            Create one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-violet-700 hover:underline">console.anthropic.com</a>. It's checked with Anthropic before it's saved.
          </span>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && <p className="text-sm text-green-700">Key verified and saved. Kara is ready.</p>}
        <div className="flex items-center justify-between">
          {status?.source === 'ui' ? (
            <button onClick={removeKey} className="text-sm text-red-600 hover:underline">Remove saved key</button>
          ) : <span />}
          <button
            onClick={save}
            disabled={saving || !key.trim()}
            className="bg-violet-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? 'Checking…' : 'Save key'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PromptBlock({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{title}</p>
      <pre className="text-xs bg-gray-50 border border-gray-200 rounded-md p-3 whitespace-pre-wrap break-words max-h-96 overflow-y-auto">{text}</pre>
    </div>
  );
}

function PromptViewer({ checkinId, messageId, label, onClose }: { checkinId: string; messageId: string; label: string; onClose: () => void }) {
  const [record, setRecord] = useState<PromptRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PromptRecord>(`/checkins/${checkinId}/messages/${messageId}/prompt`)
      .then(setRecord)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the prompt'));
  }, [checkinId, messageId]);

  const { system, messages, ...params } = record?.request ?? { system: '', messages: [] };
  return (
    <Modal isOpen onClose={onClose} title={`Prompt behind ${label}`} size="xl">
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !record ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">Sent {fmtDate(record.at)}. This is the complete request, exactly as sent to Claude.</p>
          <PromptBlock title="Request parameters" text={JSON.stringify(params, null, 2)} />
          <PromptBlock title="System prompt" text={system} />
          {messages.map((m, i) => (
            <PromptBlock key={i} title={`Message ${i + 1} · ${m.role}`} text={typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2)} />
          ))}
          <PromptBlock title={`Response${record.response.model ? ` · ${record.response.model}` : ''}${record.response.stop_reason ? ` · ${record.response.stop_reason}` : ''}`} text={record.response.text} />
          {record.response.usage && <PromptBlock title="Usage" text={JSON.stringify(record.response.usage, null, 2)} />}
        </div>
      )}
    </Modal>
  );
}
