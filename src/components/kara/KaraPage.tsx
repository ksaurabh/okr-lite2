import { useEffect, useRef, useState } from 'react';
import { renderNoteMarkdown } from '../mindmaps/markdown';

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

interface Checkin {
  id: string;
  goal: string;
  status: CheckinStatus;
  createdAt: string;
  updatedAt: string;
  messages: { role: 'kara' | 'user'; text: string; at: string }[];
  answers: { topic: string; question: string; answer: string; at: string }[];
  report: string | null;
  reportAt: string | null;
}

interface Playbook {
  content: string;
  updatedAt: string | null;
  updatedBy: string | null;
  canEdit: boolean;
}

type Pane = 'start' | 'chat' | 'report' | 'answers' | 'playbook';

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
  const [busy, setBusy] = useState<null | 'starting' | 'replying' | 'reporting'>(null);
  const [error, setError] = useState<string | null>(null);
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [playbookDraft, setPlaybookDraft] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  useEffect(() => {
    if (pane === 'chat' && !busy) inputRef.current?.focus();
  }, [pane, busy]);

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

  const run = async (kind: 'starting' | 'replying' | 'reporting', fn: () => Promise<void>) => {
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

  const send = () => {
    const text = draft.trim();
    if (!text || !current || busy) return;
    // Show the message right away; the server echoes the saved transcript back.
    setCurrent({ ...current, messages: [...current.messages, { role: 'user', text, at: new Date().toISOString() }] });
    setDraft('');
    run('replying', async () => {
      try {
        const data = await api<{ checkin: Checkin }>(`/checkins/${current.id}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
        showCheckin(data.checkin);
      } catch (e) {
        setCurrent(current);
        setDraft(text);
        throw e;
      }
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
          <div className="p-3 border-t border-gray-200">
            <button onClick={() => setPane('playbook')} className="text-sm text-violet-700 hover:underline">
              Kara's playbook
            </button>
          </div>
        </aside>

        {/* Main */}
        <section className="flex-1 flex flex-col min-w-0">
          <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900">Kara</h2>
              <p className="text-xs text-gray-500 truncate">
                {pane === 'playbook' ? "Kara's playbook" : current ? current.goal : 'Key Results Assistant'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {current && pane !== 'playbook' && pane !== 'start' && (
                <>
                  {tab('chat', 'Chat')}
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

          {pane === 'chat' && current && (
            <>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {current.messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 ${m.role === 'user' ? 'bg-violet-600 text-white' : 'bg-gray-100'}`}>
                      {m.role === 'user'
                        ? <p className="text-sm whitespace-pre-wrap">{m.text}</p>
                        : <Markdown text={m.text} />}
                    </div>
                  </div>
                ))}
                {busy === 'replying' && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 rounded-lg px-3 py-2 text-sm text-gray-500 italic">Kara is thinking…</div>
                  </div>
                )}
                {current.status !== 'active' && busy !== 'replying' && (
                  <div className="flex justify-center pt-2">
                    <button
                      onClick={generateReport}
                      disabled={!!busy}
                      className="bg-violet-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-violet-700 disabled:opacity-60"
                    >
                      {busy === 'reporting' ? 'Writing the report…' : current.report ? 'Regenerate check-in report' : 'Generate check-in report'}
                    </button>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
              <div className="border-t border-gray-200 p-3">
                <div className="flex gap-2 items-end">
                  <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                    }}
                    rows={2}
                    disabled={!!busy || current.status === 'completed'}
                    placeholder={current.status === 'completed' ? 'This check-in is complete.' : 'Reply to Kara… (Enter to send, Shift+Enter for a new line)'}
                    className="flex-1 resize-none border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:bg-gray-50"
                  />
                  <button
                    onClick={send}
                    disabled={!!busy || !draft.trim() || current.status === 'completed'}
                    className="bg-violet-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
                {current.status === 'active' && (
                  <button
                    onClick={generateReport}
                    disabled={!!busy || current.messages.length < 2}
                    className="mt-2 text-xs text-gray-500 hover:text-violet-700 disabled:opacity-50"
                  >
                    {busy === 'reporting' ? 'Writing the report…' : 'Finish now and generate the report'}
                  </button>
                )}
              </div>
            </>
          )}

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

          {pane === 'playbook' && (
            <div className="flex-1 overflow-y-auto p-6">
              {!playbook ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : playbookDraft !== null ? (
                <div className="flex flex-col h-full gap-3">
                  <textarea
                    value={playbookDraft}
                    onChange={(e) => setPlaybookDraft(e.target.value)}
                    className="flex-1 min-h-[50vh] w-full font-mono text-sm border border-gray-300 rounded-md p-3 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                  <div className="flex gap-2">
                    <button onClick={savePlaybook} className="bg-violet-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-violet-700">Save playbook</button>
                    <button onClick={() => setPlaybookDraft(null)} className="px-4 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
                  </div>
                  <p className="text-xs text-gray-500">Changes apply to check-ins started after saving.</p>
                </div>
              ) : (
                <div className="max-w-3xl">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-gray-500">
                      {playbook.updatedAt ? `Last edited ${fmtDate(playbook.updatedAt)} by ${playbook.updatedBy}` : 'Default playbook'}
                    </p>
                    {playbook.canEdit && (
                      <button onClick={() => setPlaybookDraft(playbook.content)} className="text-sm text-violet-700 hover:underline">Edit</button>
                    )}
                  </div>
                  <Markdown text={playbook.content} />
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
