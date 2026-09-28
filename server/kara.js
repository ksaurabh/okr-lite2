// ============ Kara: Key Results Assistant ============
// Kara runs a check-in conversation with a user about their objectives and key
// results. She is steered by "Kara's playbook" (a markdown document only the
// playbook owner may edit), a snapshot of the user's OKR context, and a goal the
// user picks when starting. Kara asks one question at a time; each answer
// produces the next question. Each check-in stores its chat history, the
// answers Kara recorded along the way, and the check-in report generated at the
// end. The exact request behind every question is kept in a per-check-in file
// so super admins can inspect it, and they can regenerate the current question.

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const KARA_MODEL = 'claude-opus-5';
const PLAYBOOK_OWNER = 'kumar@airmdr.com';
const PLAYBOOK_CAP = 50000;
const MESSAGE_CAP = 8000;
const CHECKIN_LIMIT = 200;
const CONTEXT_OBJECTIVE_LIMIT = 60;

const DEFAULT_PLAYBOOK = `# Kara's playbook

## Purpose
Help each person take an honest, quick look at their key results: where they
stand, what's in the way, and what happens next.

## How to run a check-in
1. Open warmly in one line, then name the key results you'll cover.
2. For each key result that matters to the goal:
   - Ask where it stands now, in their words (not just the % in the app).
   - Ask what changed since the last check-in.
   - If it's at risk or behind, ask what's blocking it and what help would unblock it.
   - Ask for the next concrete step and when it will happen.
3. Ask whether anything important isn't captured in their objectives.
4. Close by summarising the commitments you heard and confirming them.

## Style
- One question at a time. Keep messages short.
- Refer to their actual objectives and key results by name.
- If an answer is vague, ask one follow-up for specifics (a number, a date, a name).
- Be encouraging, never judgmental. Don't lecture.
- Aim to finish within about 10 questions.

## Report
- **Summary**: 2-3 sentences on overall health.
- **Key results**: for each one discussed: status, progress, what changed, next step and date.
- **Blockers & asks**: what's in the way and who could help.
- **Commitments**: the concrete next steps the person agreed to.
- **Flags for the manager**: anything that needs attention.
`;

const TURN_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    recorded: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          question: { type: 'string' },
          answer: { type: 'string' },
        },
        required: ['topic', 'question', 'answer'],
        additionalProperties: false,
      },
    },
    done: { type: 'boolean' },
  },
  required: ['message', 'recorded', 'done'],
  additionalProperties: false,
};

function turnSystemPrompt(playbook) {
  return `You are Kara, the Key Results Assistant in OKR Lite. You lead check-in conversations with a team member about their objectives and key results.

The program owner wrote the playbook below. It defines how a check-in should run; follow it.

<playbook>
${playbook}
</playbook>

The first user message holds the person's OKR data (a snapshot taken when the check-in started) and the goal of this check-in. Everything after that is the live conversation.

You lead the check-in as a series of questions. Each turn, you ask exactly one question; the person types an answer and submits it, and you choose the next question based on that answer. Keep the conversation moving toward the goal, and ground your questions in their actual objectives and key results. Your question is shown on a card above an answer box and may use light markdown (bold, bullets).

Respond with JSON:
- "message": your next question, optionally preceded by a brief acknowledgement of their last answer. When done is true, this is instead your closing message and asks nothing.
- "recorded": the answers from the person's latest message worth keeping for the report, each with the topic (usually the key result's name), the question it answers, and the answer in a sentence or two, faithful to what they said. Empty when there is nothing new, including on your opening message.
- "done": true only when the check-in is complete: you have covered what the goal and playbook call for (or the person asked to wrap up) and your message is the closing one.`;
}

function reportSystemPrompt(playbook) {
  return `You are Kara, the Key Results Assistant in OKR Lite. A check-in conversation has ended and you are writing its check-in report.

Follow the report guidance in the playbook below, if it has any.

<playbook>
${playbook}
</playbook>

Write the report in markdown, starting with a level-2 heading. Base it only on the OKR snapshot, the recorded answers, and the conversation: do not invent progress, dates, or commitments the person did not state. If the conversation ended early, say what was not covered.`;
}

const newId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

export function registerKaraRoutes(app, { requireAuth, getUsers, saveUsers, getOKRData, getOrganizationByDomain, isSuperAdmin, playbookFile, promptsDir, configFile }) {
  // --- Anthropic API key: set from the UI by a super admin (stored in
  // configFile, never sent back to the browser), else ANTHROPIC_API_KEY from
  // the environment.
  function getConfig() {
    try {
      return JSON.parse(readFileSync(configFile, 'utf-8'));
    } catch {
      return {};
    }
  }
  const activeKey = () => getConfig().apiKey || process.env.ANTHROPIC_API_KEY || '';

  let client = null;
  let clientKey = null;
  const getClient = () => {
    const key = activeKey();
    if (!key) throw Object.assign(new Error('Missing API key'), { missingKey: true });
    if (!client || clientKey !== key) {
      client = new Anthropic({ apiKey: key });
      clientKey = key;
    }
    return client;
  };

  // --- Playbook ---
  function getPlaybook() {
    if (!existsSync(playbookFile)) return { content: DEFAULT_PLAYBOOK, updatedAt: null, updatedBy: null };
    try {
      const data = JSON.parse(readFileSync(playbookFile, 'utf-8'));
      return {
        content: typeof data.content === 'string' ? data.content : DEFAULT_PLAYBOOK,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null,
      };
    } catch {
      return { content: DEFAULT_PLAYBOOK, updatedAt: null, updatedBy: null };
    }
  }

  // Editing is tied to the real signed-in account, so impersonating the owner
  // doesn't grant it, and the owner keeps it while impersonating someone else.
  const realEmail = (req) => (req.realUser?.email || req.user?.email || '').toLowerCase();
  const canEditPlaybook = (req) => realEmail(req) === PLAYBOOK_OWNER;
  // Super admins (and the playbook owner) can see the prompts behind each
  // question and regenerate the current one.
  const canAdmin = (req) => canEditPlaybook(req) || isSuperAdmin(realEmail(req));

  // --- Prompt log: the exact request and response behind each Kara message,
  // one file per check-in, keyed by message id. Kept out of users.json since
  // every request repeats the whole conversation.
  const promptFile = (checkinId) => join(promptsDir, `${checkinId.replace(/[^A-Za-z0-9_-]/g, '')}.json`);
  function readPrompts(checkinId) {
    try {
      return JSON.parse(readFileSync(promptFile(checkinId), 'utf-8'));
    } catch {
      return {};
    }
  }
  function savePrompt(checkinId, messageId, record) {
    mkdirSync(promptsDir, { recursive: true });
    const prompts = readPrompts(checkinId);
    prompts[messageId] = record;
    writeFileSync(promptFile(checkinId), JSON.stringify(prompts, null, 2));
  }

  // --- Check-in storage (on the user record, like agent sessions) ---
  function getCheckins(email) {
    return getUsers().find(u => u.email === email)?.karaCheckins || [];
  }

  // Re-reads users.json before writing, since a Claude call may have taken a
  // while and other requests may have saved in the meantime.
  function saveCheckin(email, checkin) {
    const users = getUsers();
    const idx = users.findIndex(u => u.email === email);
    if (idx === -1) return null;
    const list = users[idx].karaCheckins || [];
    const at = list.findIndex(c => c.id === checkin.id);
    if (at === -1) list.unshift(checkin);
    else list[at] = checkin;
    users[idx].karaCheckins = list.slice(0, CHECKIN_LIMIT);
    saveUsers(users);
    return checkin;
  }

  const summarize = (c) => ({
    id: c.id,
    goal: c.goal,
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messageCount: c.messages.length,
    hasReport: !!c.report,
  });

  // What the client sees: everything but the raw model output and the prompt
  // inputs (playbook and context snapshots).
  const publicCheckin = (c) => ({
    id: c.id,
    goal: c.goal,
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messages: c.messages.map(({ id, role, text, at, regenerated }) => ({ id, role, text, at, regenerated })),
    answers: c.answers,
    report: c.report,
    reportAt: c.reportAt,
  });

  // --- Context snapshot ---
  function buildContext(user) {
    const org = getOrganizationByDomain(user.domain);
    const users = getUsers();
    const me = users.find(u => u.email === user.email);
    const lines = [];
    lines.push(`Person: ${me?.name || user.name || user.email} (${user.email})`);
    if (me?.department) lines.push(`Department: ${me.department}`);
    lines.push(`Today: ${new Date().toISOString().slice(0, 10)}`);
    if (!org) return lines.join('\n');

    const data = getOKRData();
    const periods = data.periods.filter(p => p.orgId === org.id);
    const periodName = (id) => periods.find(p => p.id === id)?.name;
    const activePeriodIds = new Set(periods.filter(p => p.isActive && !p.archived).map(p => p.id));
    const byId = new Map(data.objectives.map(o => [o.id, o]));
    const myId = me?.id;

    const mine = data.objectives.filter(o =>
      o.orgId === org.id &&
      (o.createdBy === user.email || (myId && (o.ownerId === myId || o.assigneeId === myId))) &&
      o.workflowStatus !== 'archived' &&
      (activePeriodIds.size === 0 || activePeriodIds.has(o.periodId)),
    );
    // Key results first, then open work, then the rest.
    const rank = (o) => (o.isKeyResult ? 0 : 2) + (o.workflowStatus === 'done' ? 1 : 0);
    mine.sort((a, b) => rank(a) - rank(b));
    const shown = mine.slice(0, CONTEXT_OBJECTIVE_LIMIT);

    if (activePeriodIds.size) {
      lines.push(`Active periods: ${[...activePeriodIds].map(periodName).filter(Boolean).join(', ')}`);
    }
    lines.push('');
    lines.push(`Objectives and key results this person owns, is assigned, or created (${shown.length}${mine.length > shown.length ? ` of ${mine.length}` : ''}):`);
    if (!shown.length) lines.push('(none)');
    for (const o of shown) {
      const role = [
        myId && o.ownerId === myId && 'owner',
        myId && o.assigneeId === myId && 'assignee',
        o.createdBy === user.email && 'creator',
      ].filter(Boolean).join('/');
      const bits = [
        o.isKeyResult ? 'KEY RESULT' : (o.type || o.level),
        `progress ${o.progress ?? 0}%`,
        `status ${o.status}`,
        `workflow ${o.workflowStatus}`,
        periodName(o.periodId) && `period ${periodName(o.periodId)}`,
        o.valuePoints != null && `${o.valuePoints} VP`,
        role && `role ${role}`,
      ].filter(Boolean).join(', ');
      lines.push(`- "${o.title}" [${bits}]`);
      const parent = o.parentId && byId.get(o.parentId);
      if (parent) lines.push(`  Parent: "${parent.title}"`);
      if (o.description) lines.push(`  Description: ${o.description.slice(0, 400)}`);
      if (o.nextStep || o.nextStepDate) lines.push(`  Next step: ${o.nextStep || '(none)'}${o.nextStepDate ? ` (by ${o.nextStepDate.slice(0, 10)})` : ''}`);
      for (const u of (o.progressUpdates || []).slice(-3)) {
        lines.push(`  Update ${u.createdAt?.slice(0, 10)}: ${String(u.text).slice(0, 300)}`);
      }
      for (const kr of data.keyResults.filter(k => k.objectiveId === o.id)) {
        lines.push(`  Metric: ${kr.title}: ${kr.currentValue}/${kr.targetValue} ${kr.unit || ''}`.trimEnd());
      }
    }

    const last = getCheckins(user.email).find(c => c.status === 'completed' && c.report);
    if (last) {
      lines.push('');
      lines.push(`Report from the previous check-in (${last.reportAt?.slice(0, 10)}):`);
      lines.push(last.report.slice(0, 4000));
    }
    return lines.join('\n');
  }

  function apiMessages(checkin) {
    const messages = [{
      role: 'user',
      content: `<okr_context>\n${checkin.context}\n</okr_context>\n\n<goal>\n${checkin.goal}\n</goal>\n\nStart the check-in.`,
    }];
    for (const m of checkin.messages) {
      messages.push(m.role === 'kara'
        ? { role: 'assistant', content: m.raw || m.text }
        : { role: 'user', content: m.text });
    }
    return messages;
  }

  function textOf(response) {
    return response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  }

  function assertAnswered(response) {
    if (response.stop_reason === 'refusal') {
      throw Object.assign(new Error('Kara declined to respond to that. Try rephrasing.'), { status: 422 });
    }
  }

  async function karaTurn(checkin, { regenerated = false } = {}) {
    const request = {
      model: KARA_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: TURN_SCHEMA } },
      cache_control: { type: 'ephemeral' },
      system: turnSystemPrompt(checkin.playbook),
      messages: apiMessages(checkin),
    };
    const response = await getClient().beta.messages.create(request);
    assertAnswered(response);
    const raw = textOf(response);
    let turn;
    try {
      turn = JSON.parse(raw);
    } catch {
      turn = { message: raw, recorded: [], done: false };
    }
    const at = new Date().toISOString();
    const id = newId('km');
    savePrompt(checkin.id, id, {
      at,
      request,
      response: { model: response.model, stop_reason: response.stop_reason, usage: response.usage, text: raw },
    });
    checkin.messages.push({ id, role: 'kara', text: String(turn.message || ''), raw, at, ...(regenerated && { regenerated: true }) });
    for (const r of Array.isArray(turn.recorded) ? turn.recorded : []) {
      checkin.answers.push({ topic: r.topic, question: r.question, answer: r.answer, at, messageId: id });
    }
    if (turn.done) checkin.status = 'wrapping-up';
    checkin.updatedAt = at;
  }

  async function writeReport(checkin) {
    const transcript = checkin.messages
      .map(m => `${m.role === 'kara' ? 'Kara' : 'Person'}: ${m.text}`)
      .join('\n\n');
    const answers = checkin.answers.length
      ? checkin.answers.map(a => `- [${a.topic}] ${a.question} → ${a.answer}`).join('\n')
      : '(none recorded)';
    const response = await getClient().beta.messages.create({
      model: KARA_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: reportSystemPrompt(checkin.playbook),
      messages: [{
        role: 'user',
        content: `<okr_context>\n${checkin.context}\n</okr_context>\n\n<goal>\n${checkin.goal}\n</goal>\n\n<recorded_answers>\n${answers}\n</recorded_answers>\n\n<conversation>\n${transcript}\n</conversation>\n\nWrite the check-in report.`,
      }],
    });
    assertAnswered(response);
    const now = new Date().toISOString();
    checkin.report = textOf(response).trim();
    checkin.reportAt = now;
    checkin.status = 'completed';
    checkin.updatedAt = now;
  }

  function sendKaraError(res, err) {
    if (err?.missingKey) {
      return res.status(503).json({ error: "Kara isn't set up yet: a super admin needs to add an Anthropic API key in Kara's settings." });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('[kara] Anthropic API key rejected:', err.message);
      return res.status(503).json({ error: "Kara's Anthropic API key was rejected. A super admin needs to update it in Kara's settings." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Kara is busy right now. Try again in a moment.' });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`[kara] Claude API error ${err.status}:`, err.message);
      return res.status(502).json({ error: 'Kara could not reach Claude. Try again.' });
    }
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('[kara] error:', err);
    return res.status(500).json({ error: 'Something went wrong with Kara.' });
  }

  // --- Routes ---
  const keyStatus = () => {
    const config = getConfig();
    const key = activeKey();
    return {
      source: config.apiKey ? 'ui' : process.env.ANTHROPIC_API_KEY ? 'env' : 'none',
      hint: key ? `…${key.slice(-4)}` : null,
      updatedAt: config.apiKey ? config.updatedAt || null : null,
      updatedBy: config.apiKey ? config.updatedBy || null : null,
    };
  };

  app.get('/api/kara/config', requireAuth, (req, res) => {
    if (!canAdmin(req)) return res.status(403).json({ error: 'Only super admins can view Kara settings.' });
    res.json(keyStatus());
  });

  // Save a new key, after checking with Anthropic that it works.
  app.put('/api/kara/config', requireAuth, async (req, res) => {
    if (!canAdmin(req)) return res.status(403).json({ error: 'Only super admins can change Kara settings.' });
    const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    if (!apiKey) return res.status(400).json({ error: 'Paste an API key.' });
    try {
      await new Anthropic({ apiKey }).models.retrieve(KARA_MODEL);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) return res.status(400).json({ error: 'Anthropic rejected that key. Check it and try again.' });
      if (err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError) {
        return res.status(400).json({ error: `That key works but can't use ${KARA_MODEL}.` });
      }
      console.error('[kara] could not verify API key:', err?.message);
      return res.status(502).json({ error: "Couldn't reach Anthropic to check the key. Try again." });
    }
    writeFileSync(configFile, JSON.stringify({
      apiKey,
      updatedAt: new Date().toISOString(),
      updatedBy: realEmail(req),
    }, null, 2), { mode: 0o600 });
    res.json(keyStatus());
  });

  // Remove the UI-set key (falls back to ANTHROPIC_API_KEY, if the server has one).
  app.delete('/api/kara/config', requireAuth, (req, res) => {
    if (!canAdmin(req)) return res.status(403).json({ error: 'Only super admins can change Kara settings.' });
    try { unlinkSync(configFile); } catch { /* nothing saved */ }
    res.json(keyStatus());
  });

  app.get('/api/kara/playbook', requireAuth, (req, res) => {
    res.json({ ...getPlaybook(), canEdit: canEditPlaybook(req), canAdmin: canAdmin(req) });
  });

  app.put('/api/kara/playbook', requireAuth, (req, res) => {
    if (!canEditPlaybook(req)) return res.status(403).json({ error: 'Only the playbook owner can edit it.' });
    const { content } = req.body || {};
    if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: 'Playbook cannot be empty.' });
    const playbook = {
      content: content.slice(0, PLAYBOOK_CAP),
      updatedAt: new Date().toISOString(),
      updatedBy: (req.realUser?.email || req.user.email).toLowerCase(),
    };
    writeFileSync(playbookFile, JSON.stringify(playbook, null, 2));
    res.json({ ...playbook, canEdit: true, canAdmin: canAdmin(req) });
  });

  app.get('/api/kara/checkins', requireAuth, (req, res) => {
    res.json({ checkins: getCheckins(req.user.email).map(summarize) });
  });

  app.get('/api/kara/checkins/:id', requireAuth, (req, res) => {
    const checkin = getCheckins(req.user.email).find(c => c.id === req.params.id);
    if (!checkin) return res.status(404).json({ error: 'Check-in not found' });
    res.json({ checkin: publicCheckin(checkin) });
  });

  // Start a check-in: snapshot the playbook and context, and get Kara's opener.
  app.post('/api/kara/checkins', requireAuth, async (req, res) => {
    const goal = typeof req.body?.goal === 'string' && req.body.goal.trim()
      ? req.body.goal.trim().slice(0, 2000)
      : 'Weekly check-in on my objectives and key results';
    const now = new Date().toISOString();
    const checkin = {
      id: newId('kc'),
      goal,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      playbook: getPlaybook().content,
      context: buildContext(req.user),
      messages: [],
      answers: [],
      report: null,
      reportAt: null,
    };
    try {
      await karaTurn(checkin);
    } catch (err) {
      return sendKaraError(res, err);
    }
    saveCheckin(req.user.email, checkin);
    res.json({ checkin: publicCheckin(checkin) });
  });

  app.post('/api/kara/checkins/:id/messages', requireAuth, async (req, res) => {
    const checkin = getCheckins(req.user.email).find(c => c.id === req.params.id);
    if (!checkin) return res.status(404).json({ error: 'Check-in not found' });
    if (checkin.status === 'completed') return res.status(409).json({ error: 'This check-in is already complete.' });
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, MESSAGE_CAP) : '';
    if (!text) return res.status(400).json({ error: 'Message is empty.' });
    // A reply after Kara's closing message reopens the conversation.
    checkin.status = 'active';
    checkin.messages.push({ id: newId('km'), role: 'user', text, at: new Date().toISOString() });
    try {
      await karaTurn(checkin);
    } catch (err) {
      return sendKaraError(res, err);
    }
    saveCheckin(req.user.email, checkin);
    res.json({ checkin: publicCheckin(checkin) });
  });

  // Super admin: replace Kara's current (unanswered) question with a fresh one,
  // written against the playbook as it is now, so playbook edits can be tried
  // on a live check-in. Answers recorded by the replaced turn go with it.
  app.post('/api/kara/checkins/:id/regenerate', requireAuth, async (req, res) => {
    if (!canAdmin(req)) return res.status(403).json({ error: 'Only super admins can regenerate questions.' });
    const checkin = getCheckins(req.user.email).find(c => c.id === req.params.id);
    if (!checkin) return res.status(404).json({ error: 'Check-in not found' });
    if (checkin.status === 'completed') return res.status(409).json({ error: 'This check-in is already complete.' });
    const last = checkin.messages[checkin.messages.length - 1];
    if (!last || last.role !== 'kara') return res.status(409).json({ error: "There's no unanswered question to regenerate." });
    checkin.messages.pop();
    checkin.answers = checkin.answers.filter(a => !a.messageId || a.messageId !== last.id);
    checkin.playbook = getPlaybook().content;
    checkin.status = 'active';
    try {
      await karaTurn(checkin, { regenerated: true });
    } catch (err) {
      return sendKaraError(res, err);
    }
    saveCheckin(req.user.email, checkin);
    res.json({ checkin: publicCheckin(checkin) });
  });

  // Super admin: the exact request sent to Claude for one of Kara's messages,
  // and what came back.
  app.get('/api/kara/checkins/:id/messages/:messageId/prompt', requireAuth, (req, res) => {
    if (!canAdmin(req)) return res.status(403).json({ error: 'Only super admins can view prompts.' });
    const checkin = getCheckins(req.user.email).find(c => c.id === req.params.id);
    if (!checkin) return res.status(404).json({ error: 'Check-in not found' });
    const record = readPrompts(checkin.id)[req.params.messageId];
    if (!record) return res.status(404).json({ error: 'No prompt was recorded for this message.' });
    res.json(record);
  });

  // Finish: generate (or regenerate) the check-in report.
  app.post('/api/kara/checkins/:id/report', requireAuth, async (req, res) => {
    const checkin = getCheckins(req.user.email).find(c => c.id === req.params.id);
    if (!checkin) return res.status(404).json({ error: 'Check-in not found' });
    try {
      await writeReport(checkin);
    } catch (err) {
      return sendKaraError(res, err);
    }
    saveCheckin(req.user.email, checkin);
    res.json({ checkin: publicCheckin(checkin) });
  });

  app.delete('/api/kara/checkins/:id', requireAuth, (req, res) => {
    const users = getUsers();
    const idx = users.findIndex(u => u.email === req.user.email);
    const list = idx === -1 ? [] : users[idx].karaCheckins || [];
    const at = list.findIndex(c => c.id === req.params.id);
    if (at === -1) return res.status(404).json({ error: 'Check-in not found' });
    list.splice(at, 1);
    users[idx].karaCheckins = list;
    saveUsers(users);
    try { unlinkSync(promptFile(req.params.id)); } catch { /* none recorded */ }
    res.json({ ok: true });
  });
}
