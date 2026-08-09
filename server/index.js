import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.set('trust proxy', 1); // Trust nginx reverse proxy for secure cookies
const PORT = process.env.PORT || 3001;
const DOMAINS_FILE = join(__dirname, 'allowed-domains.json');
const ORGANIZATIONS_FILE = join(__dirname, 'organizations.json');
const SUPER_ADMINS_FILE = join(__dirname, 'super-admins.json');
const USERS_FILE = join(__dirname, 'users.json');
const OKR_DATA_FILE = join(__dirname, 'okr-data.json');
const MINDMAPS_FILE = join(__dirname, 'mindmaps.json');

// Initialize files if they don't exist
if (!existsSync(DOMAINS_FILE)) {
  writeFileSync(DOMAINS_FILE, JSON.stringify({ domains: [] }, null, 2));
}
if (!existsSync(ORGANIZATIONS_FILE)) {
  writeFileSync(ORGANIZATIONS_FILE, JSON.stringify({ organizations: [] }, null, 2));
}
if (!existsSync(SUPER_ADMINS_FILE)) {
  writeFileSync(SUPER_ADMINS_FILE, JSON.stringify({ superAdminEmails: [] }, null, 2));
}
if (!existsSync(USERS_FILE)) {
  writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
}
if (!existsSync(OKR_DATA_FILE)) {
  writeFileSync(OKR_DATA_FILE, JSON.stringify({
    objectives: [],
    keyResults: [],
    teams: [],
    periods: [],
    tags: [],
  }, null, 2));
}
if (!existsSync(MINDMAPS_FILE)) {
  writeFileSync(MINDMAPS_FILE, JSON.stringify({ mindmaps: [] }, null, 2));
}

// Helper functions for domains
function getAllowedDomains() {
  try {
    const data = readFileSync(DOMAINS_FILE, 'utf-8');
    return JSON.parse(data).domains || [];
  } catch {
    return [];
  }
}

function saveAllowedDomains(domains) {
  writeFileSync(DOMAINS_FILE, JSON.stringify({ domains }, null, 2));
}

// Domains that are always allowed (hardcoded)
const ALWAYS_ALLOWED_DOMAINS = ['airmdr.com'];

// Helper functions for organizations
function getOrganizations() {
  try {
    const data = readFileSync(ORGANIZATIONS_FILE, 'utf-8');
    return JSON.parse(data).organizations || [];
  } catch {
    return [];
  }
}

function saveOrganizations(organizations) {
  writeFileSync(ORGANIZATIONS_FILE, JSON.stringify({ organizations }, null, 2));
}

function getOrganizationByDomain(domain) {
  const organizations = getOrganizations();
  return organizations.find(org => org.domain === domain?.toLowerCase());
}

function getSuperAdmins() {
  try {
    const data = readFileSync(SUPER_ADMINS_FILE, 'utf-8');
    return JSON.parse(data).superAdminEmails || [];
  } catch {
    return [];
  }
}

function isSuperAdmin(email) {
  const superAdmins = getSuperAdmins();
  return superAdmins.includes(email?.toLowerCase());
}

function isOrgAdmin(email) {
  const organizations = getOrganizations();
  const normalizedEmail = email?.toLowerCase();
  for (const org of organizations) {
    const admin = org.admins?.find(a => a.email === normalizedEmail && a.status === 'accepted');
    if (admin) return true;
  }
  return false;
}

function generateInviteToken() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}`;
}

// Helper functions for users
function getUsers() {
  try {
    const data = readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(data).users || [];
  } catch {
    return [];
  }
}

function saveUsers(users) {
  writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
}

function upsertUser(userData) {
  const users = getUsers();
  const existingIndex = users.findIndex(u => u.email === userData.email);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    // Update existing user. Preserve a name that was explicitly edited
    // in-app (nameOverride) so subsequent Google logins don't reset it.
    const existing = users[existingIndex];
    users[existingIndex] = {
      ...existing,
      name: existing.nameOverride ? existing.name : userData.name,
      picture: userData.picture,
      lastLoginAt: now,
    };
  } else {
    // Create new user
    users.push({
      id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      email: userData.email,
      name: userData.name,
      picture: userData.picture,
      domain: userData.domain,
      organizationId: userData.organizationId,
      role: 'user', // Default role
      createdAt: now,
      lastLoginAt: now,
    });
  }

  saveUsers(users);
  return users.find(u => u.email === userData.email);
}

function getUsersByOrganization(orgId) {
  const users = getUsers();
  return users.filter(u => u.organizationId === orgId);
}

// The manager email from a Directory user's relations (projection=full).
function directoryManagerEmail(d) {
  const rel = (d.relations || []).find(r => (r.type || '').toLowerCase() === 'manager');
  return rel?.value ? String(rel.value).toLowerCase() : undefined;
}

// The department from a Directory user's organizations (primary, else first).
function directoryDepartment(d) {
  const orgs = Array.isArray(d.organizations) ? d.organizations : [];
  const org = orgs.find(o => o.primary) || orgs[0];
  return org?.department ? String(org.department) : undefined;
}

// ---- Emails excluded from the reporting structure (per-org list) ----
// An excluded email is kept as a user record but removed from the reporting tree:
// it isn't resolved as anyone's manager and its own manager link is cleared.
function getExcludedEmails(orgId) {
  const data = getOKRData();
  const list = data.excludedEmails && data.excludedEmails[orgId];
  return (Array.isArray(list) ? list : []).map(e => String(e).trim().toLowerCase()).filter(Boolean);
}
function saveExcludedEmails(orgId, list) {
  const data = getOKRData();
  data.excludedEmails = data.excludedEmails || {};
  const clean = [];
  for (const e of Array.isArray(list) ? list : []) {
    const v = String(e).trim().toLowerCase();
    if (v && !clean.includes(v)) clean.push(v);
  }
  data.excludedEmails[orgId] = clean;
  saveOKRData(data);
  return clean;
}

// Resolve each org user's managerId from their managerEmail (in place). Returns
// the number of users linked to a manager that exists in the system. Emails
// excluded from the reporting structure are left out of the tree: they can't be
// resolved as a manager, and their own managerId is cleared.
function resolveManagerIds(users, organizationId) {
  const excluded = new Set(getExcludedEmails(organizationId));
  const idByEmail = new Map(users
    .filter(u => u.organizationId === organizationId && !excluded.has(u.email?.toLowerCase()))
    .map(u => [u.email?.toLowerCase(), u.id]));
  let linked = 0;
  for (const u of users) {
    if (u.organizationId !== organizationId) continue;
    if (excluded.has(u.email?.toLowerCase())) { u.managerId = undefined; continue; }
    if (u.managerEmail) {
      const mid = idByEmail.get(u.managerEmail);
      u.managerId = mid || undefined; // clear if the manager isn't a known user
      if (mid) linked++;
    }
  }
  return linked;
}

// Create/update user records from Google Workspace Directory entries in a single
// read/write pass. Unlike upsertUser this does NOT set lastLoginAt (these users
// haven't signed in) and stamps directorySyncedAt. Captures each user's manager
// (from directory relations), department, and active status (Google's `suspended`
// flag inverted) and resolves managerId. Existing users always have their active
// status refreshed, so accounts suspended in Workspace get marked inactive here.
// New records are only created for active accounts (we don't import ex-employees
// who never used the system). Returns { added, updated, linked, deactivated }.
function syncWorkspaceUsers(organizationId, domain, directoryUsers) {
  const users = getUsers();
  const byEmail = new Map(users.map(u => [u.email?.toLowerCase(), u]));
  const now = new Date().toISOString();
  let added = 0, updated = 0, deactivated = 0;
  for (const d of directoryUsers) {
    const email = (d.primaryEmail || '').toLowerCase();
    if (!email) continue;
    const name = d.name?.fullName || d.name?.givenName || email;
    const picture = d.thumbnailPhotoUrl || undefined;
    const managerEmail = directoryManagerEmail(d);
    const department = directoryDepartment(d);
    const active = !d.suspended;
    const existing = byEmail.get(email);
    if (existing) {
      if (!existing.nameOverride && name) existing.name = name;
      if (picture) existing.picture = picture;
      if (!existing.organizationId) existing.organizationId = organizationId;
      if (managerEmail !== undefined) existing.managerEmail = managerEmail;
      if (department !== undefined) existing.department = department;
      // Count the transition from active -> inactive (undefined counts as active).
      if (existing.active !== false && !active) deactivated++;
      existing.active = active;
      existing.directorySyncedAt = now;
      updated++;
    } else if (active) {
      const u = {
        id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        email,
        name,
        picture,
        domain,
        organizationId,
        role: 'user',
        createdAt: now,
        directorySyncedAt: now,
        managerEmail,
        department,
        active: true,
      };
      users.push(u);
      byEmail.set(email, u);
      added++;
    }
  }
  const linked = resolveManagerIds(users, organizationId);
  saveUsers(users);
  return { added, updated, linked, deactivated };
}

function updateUserRole(email, role) {
  const users = getUsers();
  const userIndex = users.findIndex(u => u.email === email);

  if (userIndex === -1) {
    return null;
  }

  users[userIndex].role = role;
  saveUsers(users);
  return users[userIndex];
}

function updateUserName(email, name) {
  const users = getUsers();
  const userIndex = users.findIndex(u => u.email === email);

  if (userIndex === -1) {
    return null;
  }

  users[userIndex].name = name;
  users[userIndex].nameOverride = true;
  saveUsers(users);
  return users[userIndex];
}

function getUserPreferences(email) {
  const users = getUsers();
  const user = users.find(u => u.email === email);
  return user?.preferences || {};
}

function updateUserPreferences(email, preferences) {
  const users = getUsers();
  const userIndex = users.findIndex(u => u.email === email);

  if (userIndex === -1) {
    return null;
  }

  users[userIndex].preferences = {
    ...(users[userIndex].preferences || {}),
    ...preferences,
  };
  saveUsers(users);
  return users[userIndex].preferences;
}

// Helper functions for saved views
function getUserViews(email) {
  const users = getUsers();
  const user = users.find(u => u.email === email);
  return user?.views || [];
}

function saveUserViews(email, views) {
  const users = getUsers();
  const userIndex = users.findIndex(u => u.email === email);

  if (userIndex === -1) {
    return null;
  }

  users[userIndex].views = views;
  saveUsers(users);
  return users[userIndex].views;
}

function generateViewId() {
  return `view-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

// Helper functions for user lists
function getUserLists(email) {
  const users = getUsers();
  const user = users.find(u => u.email === email);
  return user?.lists || [];
}

function saveUserLists(email, lists) {
  const users = getUsers();
  const userIndex = users.findIndex(u => u.email === email);

  if (userIndex === -1) {
    return null;
  }

  users[userIndex].lists = lists;
  saveUsers(users);
  return users[userIndex].lists;
}

function generateListId() {
  return `list-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

// Helper functions for per-user Agent chat sessions
function getUserAgentSessions(email) {
  const users = getUsers();
  const user = users.find(u => u.email === email);
  return user?.agentSessions || [];
}

function saveUserAgentSessions(email, sessions) {
  const users = getUsers();
  const userIndex = users.findIndex(u => u.email === email);
  if (userIndex === -1) return null;
  users[userIndex].agentSessions = sessions;
  saveUsers(users);
  return users[userIndex].agentSessions;
}

// Cap on retained plan-history entries per list, to keep the user record lean.
const LIST_HISTORY_LIMIT = 1000;

// Resolve the acting user (the effective user, i.e. the impersonated one when
// a super admin is impersonating) for plan-history attribution.
function listHistoryActor(req) {
  const email = req.user?.email || '';
  const stored = email ? getUsers().find(u => u.email === email) : null;
  return { email, name: stored?.name || req.user?.name || email };
}

function objectiveTitleById(objectiveId) {
  try {
    const obj = getOKRData().objectives.find(o => o.id === objectiveId);
    return obj?.title;
  } catch {
    return undefined;
  }
}

// 0-based position of an objective within a list, by display (order) sort.
function listSortedPosition(items, objectiveId) {
  return [...items].sort((a, b) => a.order - b.order).findIndex(i => i.objectiveId === objectiveId);
}

function pushListHistory(list, entry) {
  if (!Array.isArray(list.history)) list.history = [];
  list.history.push({
    id: `lh-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (list.history.length > LIST_HISTORY_LIMIT) {
    list.history = list.history.slice(list.history.length - LIST_HISTORY_LIMIT);
  }
}

// Helper functions for user work logs
function getUserWorkLogs(email) {
  const users = getUsers();
  const user = users.find(u => u.email === email);
  return user?.workLogs || [];
}

function saveUserWorkLogs(email, workLogs) {
  const users = getUsers();
  const userIndex = users.findIndex(u => u.email === email);

  if (userIndex === -1) {
    return null;
  }

  users[userIndex].workLogs = workLogs;
  saveUsers(users);
  return users[userIndex].workLogs;
}

function generateWorkLogId() {
  return `wl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

// Helper functions for user todos
function getUserTodos(email) {
  const users = getUsers();
  const user = users.find(u => u.email === email);
  return user?.todos || [];
}

function saveUserTodos(email, todos) {
  const users = getUsers();
  const userIndex = users.findIndex(u => u.email === email);

  if (userIndex === -1) {
    return null;
  }

  users[userIndex].todos = todos;
  saveUsers(users);
  return users[userIndex].todos;
}

function generateTodoId() {
  return `todo-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

// Helper functions for OKR data
function getOKRData() {
  try {
    const data = readFileSync(OKR_DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { objectives: [], keyResults: [], teams: [], periods: [], tags: [] };
  }
}

function saveOKRData(data) {
  writeFileSync(OKR_DATA_FILE, JSON.stringify(data, null, 2));
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ---- Mindmaps ----
// A "mindmap" is a sticky-note canvas. Visibility is by creatorEmail/shared and
// scoped to the creator's org (domain) so maps never leak across organizations.
// Stars are per-viewer and stored on the user record, never on the mindmap —
// starring must not mutate the map or require write access to it.
const MINDMAP_DEFAULT_COLOR = '#fde68a';
const MINDMAP_NOTE_MIN_W = 80;
const MINDMAP_NOTE_MIN_H = 60;
const MINDMAP_TEXT_CAP = 20000;

function getMindmaps() {
  try {
    return JSON.parse(readFileSync(MINDMAPS_FILE, 'utf-8')).mindmaps || [];
  } catch {
    return [];
  }
}

function saveMindmaps(mindmaps) {
  writeFileSync(MINDMAPS_FILE, JSON.stringify({ mindmaps }, null, 2));
}

function generateMindmapId() {
  return `mm_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 9)}`;
}

function generateNoteId() {
  return `n_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 9)}`;
}

// The client sends the whole notes array on every save, so this is the only
// line of defense: coerce coordinates/size to finite numbers, clamp the minimum
// size, validate the color, and cap text length.
function toFiniteNumber(value, fallback) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeNote(note) {
  const n = note && typeof note === 'object' ? note : {};
  const id = typeof n.id === 'string' && n.id ? n.id.slice(0, 64) : generateNoteId();
  const color = typeof n.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(n.color.trim())
    ? n.color.trim()
    : MINDMAP_DEFAULT_COLOR;
  const text = typeof n.text === 'string' ? n.text.slice(0, MINDMAP_TEXT_CAP) : '';
  // Optional link to another mindmap; keep only a well-formed mindmap id.
  const linkedMindmapId = typeof n.linkedMindmapId === 'string' && /^mm_[A-Za-z0-9_-]+$/.test(n.linkedMindmapId)
    ? n.linkedMindmapId
    : undefined;
  const tags = sanitizeTags(n.tags);
  return {
    id,
    x: toFiniteNumber(n.x, 0),
    y: toFiniteNumber(n.y, 0),
    w: Math.max(MINDMAP_NOTE_MIN_W, toFiniteNumber(n.w, 220)),
    h: Math.max(MINDMAP_NOTE_MIN_H, toFiniteNumber(n.h, 160)),
    color,
    text,
    ...(linkedMindmapId ? { linkedMindmapId } : {}),
    ...(tags.length ? { tags } : {}),
  };
}

function sanitizeNotes(notes) {
  return Array.isArray(notes) ? notes.map(sanitizeNote) : [];
}

// Tags are free-form, normalized to lowercase, de-duped, and capped.
function normalizeTag(t) {
  return typeof t === 'string' ? t.trim().toLowerCase().slice(0, 50) : '';
}
function sanitizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const t of tags) {
    const n = normalizeTag(t);
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= 30) break;
  }
  return out;
}

// A view is a per-mindmap named tag-filter, granted to zero or more groups.
function generateMindmapViewId() {
  return `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
function sanitizeView(v) {
  const o = v && typeof v === 'object' ? v : {};
  const id = typeof o.id === 'string' && /^v_[A-Za-z0-9_-]+$/.test(o.id) ? o.id : generateMindmapViewId();
  const name = ((typeof o.name === 'string' ? o.name.trim() : '') || 'Untitled view').slice(0, 100);
  const mode = o.mode === 'include' ? 'include' : 'exclude';
  const tags = sanitizeTags(o.tags);
  const groupIds = Array.isArray(o.groupIds)
    ? Array.from(new Set(o.groupIds.filter(g => typeof g === 'string' && /^g_[A-Za-z0-9_-]+$/.test(g)))).slice(0, 200)
    : [];
  return { id, name, mode, tags, groupIds };
}
function sanitizeViews(views) {
  return Array.isArray(views) ? views.slice(0, 100).map(sanitizeView) : [];
}

// A frame is a named rectangle grouping a set of notes (by id). Its geometry is
// derived client-side from the member notes' bounding box.
function generateFrameId() {
  return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
function sanitizeFrame(f) {
  const o = f && typeof f === 'object' ? f : {};
  const id = typeof o.id === 'string' && /^f_[A-Za-z0-9_-]+$/.test(o.id) ? o.id : generateFrameId();
  const name = ((typeof o.name === 'string' ? o.name.trim() : '') || 'Frame').slice(0, 100);
  const noteIds = Array.isArray(o.noteIds)
    ? Array.from(new Set(o.noteIds.filter(x => typeof x === 'string').map(x => x.slice(0, 64)))).slice(0, 1000)
    : [];
  return { id, name, noteIds };
}
function sanitizeFrames(frames) {
  return Array.isArray(frames) ? frames.slice(0, 200).map(sanitizeFrame) : [];
}
// Drop members that no longer exist, and frames left with no members.
function pruneFrames(frames, notes) {
  const ids = new Set((Array.isArray(notes) ? notes : []).map(n => n.id));
  return (Array.isArray(frames) ? frames : [])
    .map(f => ({ ...f, noteIds: f.noteIds.filter(id => ids.has(id)) }))
    .filter(f => f.noteIds.length > 0);
}

// Does a view admit a note? include = note has any of the view's tags;
// exclude = note has none of them.
function viewAdmitsNote(view, noteTags) {
  const set = new Set(Array.isArray(noteTags) ? noteTags : []);
  const any = view.tags.some(t => set.has(t));
  return view.mode === 'include' ? any : !any;
}
// Notes a non-creator may see: if no views are granted to them, the whole
// board (their access wasn't restricted); otherwise the union across granted
// views.
function notesVisibleToViewer(mm, grantedViews) {
  const notes = Array.isArray(mm.notes) ? mm.notes : [];
  if (!grantedViews.length) return notes;
  return notes.filter(n => grantedViews.some(v => viewAdmitsNote(v, n.tags)));
}

// ---- User groups (org-scoped, stored on the organization record) ----
function generateGroupId() {
  return `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
function getGroupsForDomain(domain) {
  const org = getOrganizationByDomain(domain);
  return Array.isArray(org?.groups) ? org.groups : [];
}
function saveGroupsForDomain(domain, groups) {
  const orgs = getOrganizations();
  const idx = orgs.findIndex(o => o.domain === domain?.toLowerCase());
  if (idx === -1) return null;
  orgs[idx].groups = groups;
  saveOrganizations(orgs);
  return orgs[idx].groups;
}
function getUserGroupIds(email, domain) {
  const e = email?.toLowerCase();
  return getGroupsForDomain(domain)
    .filter(g => Array.isArray(g.memberEmails) && g.memberEmails.includes(e))
    .map(g => g.id);
}
// Views on this mindmap granted to a group the viewer belongs to.
function grantedViewsFor(mm, email, domain) {
  const gids = getUserGroupIds(email, domain);
  return (Array.isArray(mm.views) ? mm.views : [])
    .filter(v => Array.isArray(v.groupIds) && v.groupIds.some(g => gids.includes(g)));
}

// Visible = same org AND (creator is me OR shared org-wide OR shared with me).
function isMindmapVisible(mm, email, domain) {
  if (mm.domain && domain && mm.domain !== domain) return false;
  return mm.creatorEmail === email
    || mm.shared === true
    || (Array.isArray(mm.sharedWith) && mm.sharedWith.includes(email));
}

// Returns null when the map should appear not to exist (caller answers 404,
// never 403 — don't leak ids).
function findVisibleMindmap(mindmaps, id, email, domain) {
  const mm = mindmaps.find(m => m.id === id);
  if (!mm || !isMindmapVisible(mm, email, domain)) return null;
  return mm;
}

function getStarredMindmapIds(email) {
  const user = getUsers().find(u => u.email === email);
  return Array.isArray(user?.starredMindmaps) ? user.starredMindmaps : [];
}

function setMindmapStar(email, mindmapId, star) {
  const users = getUsers();
  const idx = users.findIndex(u => u.email === email);
  if (idx === -1) return null;
  const current = new Set(Array.isArray(users[idx].starredMindmaps) ? users[idx].starredMindmaps : []);
  if (star) current.add(mindmapId); else current.delete(mindmapId);
  users[idx].starredMindmaps = Array.from(current);
  saveUsers(users);
  return users[idx].starredMindmaps;
}

// Denormalized display name for the creator, resolved from the user record.
function displayNameForEmail(email, fallback) {
  const user = getUsers().find(u => u.email === email);
  return user?.name || fallback || email;
}

function isDomainAllowed(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  if (ALWAYS_ALLOWED_DOMAINS.includes(domain)) {
    return true;
  }
  const allowedDomains = getAllowedDomains();
  return allowedDomains.includes(domain);
}

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'okr-lite-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// Effective-user middleware: a super admin may impersonate another user.
// When active, swap req.user to the impersonated user so all downstream data
// scoping (which keys off req.user.email / req.user.domain) behaves exactly as
// if that user had logged in. The real authenticated user is preserved on
// req.realUser for authorization of the impersonation controls themselves.
app.use((req, _res, next) => {
  req.realUser = req.user || null;
  const targetEmail = req.session?.impersonatedEmail;
  if (req.user && targetEmail && isSuperAdmin(req.user.email)) {
    const target = getUsers().find(
      u => u.email?.toLowerCase() === targetEmail.toLowerCase()
    );
    if (target) {
      req.user = {
        id: target.id,
        email: target.email,
        name: target.name,
        picture: target.picture,
        domain: target.domain,
      };
      req.isImpersonating = true;
    } else {
      // Target no longer exists — drop the stale impersonation.
      delete req.session.impersonatedEmail;
    }
  }
  next();
});

// Passport configuration
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/auth/google/callback',
}, (accessToken, refreshToken, params, profile, done) => {
  const email = profile.emails?.[0]?.value;
  const scope = params?.scope || '';
  // Log what Google actually granted — the fastest way to tell whether the
  // spreadsheets scope made it into the token.
  console.log(`[google-auth] ${email} granted scopes: ${scope || '(none reported)'}`);
  const user = {
    id: profile.id,
    email,
    name: profile.displayName,
    picture: profile.photos?.[0]?.value,
    domain: email?.split('@')[1]?.toLowerCase(),
    // Google API credentials for reading spreadsheets on the user's behalf
    // (e.g. the Release Calendar). Persisted in the session via serializeUser.
    // Never expose these to the client — see /auth/user which strips them.
    google: {
      accessToken,
      refreshToken: refreshToken || null,
      expiresAt: Date.now() + ((params?.expires_in || 3600) * 1000),
      scope,
    },
  };
  return done(null, user);
}));

// Auth routes
app.get('/auth/google', passport.authenticate('google', {
  scope: [
    'profile',
    'email',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    // Admin-only: read the Workspace directory for the user sync AND write back
    // manager/department edits. Non-admins are granted the scope but Google's
    // Directory API still refuses their token.
    'https://www.googleapis.com/auth/admin.directory.user',
  ],
  // Request offline access so we receive a refresh token on first consent.
  // prompt=consent forces the consent screen so a newly-added scope is actually
  // granted rather than silently skipped for users who already authorized.
  accessType: 'offline',
  prompt: 'consent',
}));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/failure' }),
  (req, res) => {
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    res.redirect(`${clientUrl}/auth/callback`);
  }
);

app.get('/auth/failure', (req, res) => {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  res.redirect(`${clientUrl}/login?error=auth_failed`);
});

app.get('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

app.get('/auth/user', (req, res) => {
  if (!req.user) {
    return res.json({ authenticated: false });
  }

  const isAllowed = isDomainAllowed(req.user.email);
  const org = getOrganizationByDomain(req.user.domain);
  const isSuperAdminUser = isSuperAdmin(req.user.email);
  const isOrgAdminUser = org
    ? org.admins?.some(a => a.email === req.user.email?.toLowerCase() && a.status === 'accepted')
    : false;

  // Track user login. Skip while impersonating — req.user is the target, and
  // we must not stamp lastLoginAt or overwrite their record on the admin's behalf.
  let storedUser = null;
  if (req.isImpersonating) {
    storedUser = getUsers().find(u => u.email === req.user.email) || null;
  } else if (isAllowed && org) {
    storedUser = upsertUser({
      email: req.user.email,
      name: req.user.name,
      picture: req.user.picture,
      domain: req.user.domain,
      organizationId: org.id,
    });
  }

  // Strip server-only Google API credentials before returning the user.
  const { google: _google, ...safeUser } = req.user;

  res.json({
    authenticated: true,
    allowed: isAllowed,
    user: {
      ...safeUser,
      name: storedUser?.name || req.user.name,
      organizationId: org?.id || null,
    },
    isSuperAdmin: isSuperAdminUser,
    isOrgAdmin: isOrgAdminUser,
    organization: org || null,
    // When impersonating, expose the target so the UI can show a banner and a
    // way back. The real super admin is always allowed to stop impersonating.
    impersonating: req.isImpersonating
      ? { email: req.user.email, name: storedUser?.name || req.user.name }
      : null,
  });
});

// Start impersonating another user (super admin only). The real authenticated
// user — not the effective one — must be a super admin.
app.post('/api/super-admin/impersonate', (req, res) => {
  const actor = req.realUser;
  if (!actor) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (!isSuperAdmin(actor.email)) {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }
  if (email.toLowerCase() === actor.email?.toLowerCase()) {
    return res.status(400).json({ error: 'Cannot impersonate yourself' });
  }
  const target = getUsers().find(
    u => u.email?.toLowerCase() === email.toLowerCase()
  );
  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }
  req.session.impersonatedEmail = target.email;
  res.json({ success: true, impersonating: { email: target.email, name: target.name } });
});

// Stop impersonating. Allowed for the real super admin who started it.
app.post('/api/super-admin/stop-impersonating', (req, res) => {
  const actor = req.realUser;
  if (!actor) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.session) {
    delete req.session.impersonatedEmail;
  }
  res.json({ success: true });
});

// Middleware to check authentication and authorization
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (!isDomainAllowed(req.user.email)) {
    return res.status(403).json({ error: 'Domain not allowed' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (!isSuperAdmin(req.user.email)) {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
}

// Domain management routes (protected)
app.get('/api/domains', requireAuth, (req, res) => {
  const domains = getAllowedDomains();
  res.json({ domains });
});

app.post('/api/domains', requireAuth, (req, res) => {
  const { domain } = req.body;
  if (!domain || typeof domain !== 'string') {
    return res.status(400).json({ error: 'Invalid domain' });
  }

  const normalizedDomain = domain.toLowerCase().trim();
  const domains = getAllowedDomains();

  if (domains.includes(normalizedDomain)) {
    return res.status(400).json({ error: 'Domain already exists' });
  }

  domains.push(normalizedDomain);
  saveAllowedDomains(domains);
  res.json({ domains });
});

app.delete('/api/domains/:domain', requireAuth, (req, res) => {
  const { domain } = req.params;
  const domains = getAllowedDomains().filter(d => d !== domain);
  saveAllowedDomains(domains);
  res.json({ domains });
});

// Organization management routes (super admin only)
app.get('/api/organizations', requireSuperAdmin, (req, res) => {
  const organizations = getOrganizations();
  res.json({ organizations });
});

app.post('/api/organizations', requireSuperAdmin, (req, res) => {
  const { name, domain } = req.body;

  if (!name || !domain) {
    return res.status(400).json({ error: 'Name and domain are required' });
  }

  const normalizedDomain = domain.toLowerCase().trim();
  const organizations = getOrganizations();

  // Check if domain already exists
  if (organizations.some(org => org.domain === normalizedDomain)) {
    return res.status(400).json({ error: 'Domain already mapped to an organization' });
  }

  const now = new Date().toISOString();
  const newOrg = {
    id: `org-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    name: name.trim(),
    domain: normalizedDomain,
    admins: [],
    createdAt: now,
    updatedAt: now,
  };

  organizations.push(newOrg);
  saveOrganizations(organizations);

  // Also add domain to allowed domains list
  const allowedDomains = getAllowedDomains();
  if (!allowedDomains.includes(normalizedDomain) && !ALWAYS_ALLOWED_DOMAINS.includes(normalizedDomain)) {
    allowedDomains.push(normalizedDomain);
    saveAllowedDomains(allowedDomains);
  }

  res.json({ organization: newOrg });
});

app.put('/api/organizations/:id', requireSuperAdmin, (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  const organizations = getOrganizations();
  const orgIndex = organizations.findIndex(org => org.id === id);

  if (orgIndex === -1) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  organizations[orgIndex] = {
    ...organizations[orgIndex],
    name: name?.trim() || organizations[orgIndex].name,
    updatedAt: new Date().toISOString(),
  };

  saveOrganizations(organizations);
  res.json({ organization: organizations[orgIndex] });
});

app.delete('/api/organizations/:id', requireSuperAdmin, (req, res) => {
  const { id } = req.params;
  const organizations = getOrganizations();
  const org = organizations.find(o => o.id === id);

  if (!org) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  // Remove domain from allowed domains (unless it's always allowed)
  if (!ALWAYS_ALLOWED_DOMAINS.includes(org.domain)) {
    const allowedDomains = getAllowedDomains().filter(d => d !== org.domain);
    saveAllowedDomains(allowedDomains);
  }

  // Remove organization
  const updatedOrgs = organizations.filter(o => o.id !== id);
  saveOrganizations(updatedOrgs);

  res.json({ success: true });
});

// Organization admin management
app.post('/api/organizations/:id/admins', requireSuperAdmin, (req, res) => {
  const { id } = req.params;
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const organizations = getOrganizations();
  const orgIndex = organizations.findIndex(org => org.id === id);

  if (orgIndex === -1) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Check if admin already exists
  if (organizations[orgIndex].admins.some(a => a.email === normalizedEmail)) {
    return res.status(400).json({ error: 'Admin already exists for this organization' });
  }

  const newAdmin = {
    email: normalizedEmail,
    inviteToken: generateInviteToken(),
    inviteCreatedAt: new Date().toISOString(),
    status: 'pending',
  };

  organizations[orgIndex].admins.push(newAdmin);
  organizations[orgIndex].updatedAt = new Date().toISOString();
  saveOrganizations(organizations);

  res.json({
    admin: newAdmin,
    organization: organizations[orgIndex],
  });
});

app.delete('/api/organizations/:id/admins/:email', requireSuperAdmin, (req, res) => {
  const { id, email } = req.params;

  const organizations = getOrganizations();
  const orgIndex = organizations.findIndex(org => org.id === id);

  if (orgIndex === -1) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  organizations[orgIndex].admins = organizations[orgIndex].admins.filter(
    a => a.email !== decodeURIComponent(email).toLowerCase()
  );
  organizations[orgIndex].updatedAt = new Date().toISOString();
  saveOrganizations(organizations);

  res.json({ organization: organizations[orgIndex] });
});

app.get('/api/organizations/:id/invite-link/:email', requireSuperAdmin, (req, res) => {
  const { id, email } = req.params;

  const organizations = getOrganizations();
  const org = organizations.find(o => o.id === id);

  if (!org) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  const admin = org.admins.find(a => a.email === decodeURIComponent(email).toLowerCase());
  if (!admin) {
    return res.status(404).json({ error: 'Admin not found' });
  }

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const inviteLink = `${clientUrl}/invite/accept?token=${admin.inviteToken}&org=${id}`;

  res.json({ inviteLink, token: admin.inviteToken });
});

// Public route to accept admin invite
app.post('/api/invite/accept', (req, res) => {
  const { token, orgId } = req.body;

  if (!token || !orgId) {
    return res.status(400).json({ error: 'Token and organization ID are required' });
  }

  const organizations = getOrganizations();
  const orgIndex = organizations.findIndex(org => org.id === orgId);

  if (orgIndex === -1) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  const adminIndex = organizations[orgIndex].admins.findIndex(
    a => a.inviteToken === token
  );

  if (adminIndex === -1) {
    return res.status(404).json({ error: 'Invalid invite token' });
  }

  if (organizations[orgIndex].admins[adminIndex].status === 'accepted') {
    return res.json({
      success: true,
      alreadyAccepted: true,
      organization: organizations[orgIndex],
      message: 'Invite was already accepted',
    });
  }

  organizations[orgIndex].admins[adminIndex].status = 'accepted';
  organizations[orgIndex].admins[adminIndex].acceptedAt = new Date().toISOString();
  organizations[orgIndex].updatedAt = new Date().toISOString();
  saveOrganizations(organizations);

  res.json({
    success: true,
    organization: organizations[orgIndex],
    message: 'You are now an admin for this organization',
  });
});

// User management routes
function requireOrgAdminOrSuperAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (isSuperAdmin(req.user.email) || isOrgAdmin(req.user.email)) {
    return next();
  }
  return res.status(403).json({ error: 'Admin access required' });
}

app.get('/api/users', requireAuth, (req, res) => {
  const organizations = getOrganizations();

  // Super admins see all users
  if (isSuperAdmin(req.user.email)) {
    const allUsers = getUsers();
    // Enrich users with organization info
    const usersWithOrg = allUsers.map(user => {
      const org = organizations.find(o => o.id === user.organizationId);
      return {
        ...user,
        organizationName: org?.name || 'Unknown',
      };
    });
    return res.json({ users: usersWithOrg, allOrgs: true });
  }

  // Regular users see only their org's users
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.json({ users: [], allOrgs: false });
  }
  const users = getUsersByOrganization(org.id);
  const usersWithOrg = users.map(user => ({
    ...user,
    organizationName: org.name,
  }));
  res.json({ users: usersWithOrg, allOrgs: false });
});

app.put('/api/users/:email/role', requireOrgAdminOrSuperAdmin, (req, res) => {
  const { email } = req.params;
  const { role } = req.body;

  if (!role || !['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be "admin" or "user"' });
  }

  const decodedEmail = decodeURIComponent(email).toLowerCase();

  // Verify user belongs to same org (unless super admin)
  if (!isSuperAdmin(req.user.email)) {
    const org = getOrganizationByDomain(req.user.domain);
    const users = getUsersByOrganization(org?.id);
    if (!users.some(u => u.email === decodedEmail)) {
      return res.status(403).json({ error: 'Cannot modify users from other organizations' });
    }
  }

  const updatedUser = updateUserRole(decodedEmail, role);
  if (!updatedUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user: updatedUser });
});

app.get('/api/admin/last-backup-restore', requireOrgAdminOrSuperAdmin, (_req, res) => {
  const data = getOKRData();
  res.json({ lastBackupRestoredAt: data.lastBackupRestoredAt || null });
});

app.post('/api/admin/last-backup-restore', requireOrgAdminOrSuperAdmin, (_req, res) => {
  const data = getOKRData();
  data.lastBackupRestoredAt = new Date().toISOString();
  saveOKRData(data);
  res.json({ lastBackupRestoredAt: data.lastBackupRestoredAt });
});

// ---- Jira integration (per-organization) ----
function getJiraConfig(orgId) {
  const data = getOKRData();
  data.jiraConfigs = data.jiraConfigs || {};
  return data.jiraConfigs[orgId] || null;
}
function saveJiraConfig(orgId, cfg) {
  const data = getOKRData();
  data.jiraConfigs = data.jiraConfigs || {};
  data.jiraConfigs[orgId] = { ...(data.jiraConfigs[orgId] || {}), ...cfg };
  saveOKRData(data);
  return data.jiraConfigs[orgId];
}
function jiraAuthHeader(cfg) {
  const token = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64');
  return `Basic ${token}`;
}
async function jiraFetch(cfg, path, init = {}) {
  const url = `${(cfg.baseUrl || '').replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Authorization': jiraAuthHeader(cfg),
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      // Prefer English error messages (Jira otherwise localizes to the token
      // account's profile language).
      'Accept-Language': 'en-US,en;q=0.9',
      ...(init.headers || {}),
    },
  });
  return res;
}

// List every Jira project the configured account can see (paginated), with
// fallbacks for older/self-hosted instances. Returns { projects, tried } where
// `tried` records each endpoint + HTTP status for diagnostics.
async function listAllJiraProjects(cfg) {
  const out = [];
  const tried = [];
  let startAt = 0;
  for (let i = 0; i < 40; i++) {
    const path = `/rest/api/3/project/search?maxResults=50&startAt=${startAt}`;
    const r = await jiraFetch(cfg, path);
    if (!r.ok) { tried.push(`${path} → ${r.status}`); break; }
    const d = await r.json().catch(() => null);
    if (!d) { tried.push(`${path} → bad-json`); break; }
    const vals = d.values || [];
    if (startAt === 0) tried.push(`${path} → 200 (${d.total ?? vals.length} total)`);
    out.push(...vals);
    if (d.isLast || vals.length === 0) break;
    startAt += vals.length;
  }
  if (out.length === 0) {
    for (const path of ['/rest/api/3/project', '/rest/api/2/project']) {
      const r = await jiraFetch(cfg, path);
      tried.push(`${path} → ${r.status}`);
      if (r.ok) { const d = await r.json().catch(() => []); if (Array.isArray(d) && d.length) { out.push(...d); break; } }
    }
  }
  return { projects: out, tried };
}

// ---- Jira field resolution ----
// Jira's field list is site-wide, so a site can hold several custom fields with
// the same name ("Story Points" three times over, say), each attached to a
// different project's screens. Matching on name alone picks whichever one the
// API lists first, which may not be the one a given project's issues actually
// store values in — and reading an unattached field silently yields 0. So an
// admin-set per-project mapping (Settings → Jira → Field mapping) wins, and the
// name match is only the fallback for projects with no mapping.
const FIELD_LIST_CACHE = new Map(); // baseUrl -> field[]
async function listJiraFields(cfg, { refresh = false } = {}) {
  const key = cfg.baseUrl || '';
  if (!refresh && FIELD_LIST_CACHE.has(key)) return FIELD_LIST_CACHE.get(key);
  const r = await jiraFetch(cfg, '/rest/api/3/field');
  const data = r.ok ? await r.json().catch(() => []) : [];
  const fields = Array.isArray(data) ? data : [];
  FIELD_LIST_CACHE.set(key, fields);
  return fields;
}

// Every field that could answer to `name`, best guess first: exact name match,
// then a known alias, then anything containing the name. `match` explains which.
function rankFieldCandidates(fields, name, aliases = []) {
  const want = String(name).trim().toLowerCase();
  if (!want) return [];
  const nameOf = (f) => String(f.name || '').trim().toLowerCase();
  const out = [];
  const taken = new Set();
  const take = (f, match) => { if (!taken.has(f.id)) { taken.add(f.id); out.push({ ...f, match }); } };
  for (const f of fields) if (nameOf(f) === want) take(f, 'exact');
  for (const a of aliases) for (const f of fields) if (nameOf(f) === String(a).trim().toLowerCase()) take(f, 'alias');
  for (const f of fields) if (nameOf(f).includes(want)) take(f, 'partial');
  return out;
}

const STORY_POINTS_FIELD = 'Story Points';
const STORY_POINTS_ALIASES = ['Story point estimate'];

// The admin's explicit choice of field id for `name` in `projectKey`, if any.
function mappedFieldId(cfg, projectKey, name) {
  const forProject = (cfg.fieldMapByProject || {})[String(projectKey || '').toUpperCase()] || {};
  const id = forProject[name];
  return typeof id === 'string' && id ? id : null;
}

async function resolveProjectFieldId(cfg, projectKey, name, aliases = []) {
  const mapped = mappedFieldId(cfg, projectKey, name);
  if (mapped) return mapped;
  const [best] = rankFieldCandidates(await listJiraFields(cfg), name, aliases);
  return best ? best.id : null;
}

const resolveStoryPointsFieldId = (cfg, projectKey) =>
  resolveProjectFieldId(cfg, projectKey, STORY_POINTS_FIELD, STORY_POINTS_ALIASES);

// Resolve a Jira project by key OR name (the spreadsheet/user may give either).
// Returns { project, projects, tried } — `projects` is the full visible list and
// `tried` the diagnostics, for a helpful error when nothing matched.
async function resolveJiraProject(cfg, keyOrName) {
  const { projects, tried } = await listAllJiraProjects(cfg);
  const want = String(keyOrName).trim().toLowerCase();
  const project =
    projects.find(p => String(p.key).toLowerCase() === want) ||
    projects.find(p => String(p.name).toLowerCase() === want) ||
    projects.find(p => String(p.name).toLowerCase().includes(want)) ||
    null;
  return { project, projects, tried };
}

app.get('/api/admin/jira-config', requireOrgAdminOrSuperAdmin, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.json({ config: null });
  const cfg = getJiraConfig(org.id);
  if (!cfg) return res.json({ config: null });
  // Strip the token from the response
  const { apiToken: _drop, ...safe } = cfg;
  void _drop;
  res.json({ config: { ...safe, hasToken: !!cfg.apiToken } });
});

// Export the full Jira config (including the API token) as JSON for backup/transfer.
app.get('/api/admin/jira-config/export', requireOrgAdminOrSuperAdmin, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const cfg = getJiraConfig(org.id);
  if (!cfg) return res.status(404).json({ error: 'No Jira configuration to export' });
  res.json(cfg);
});

app.put('/api/admin/jira-config', requireOrgAdminOrSuperAdmin, async (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const { baseUrl, email, apiToken, projectKey, epicIssueTypeId, periodFieldKey, periodValueMap, fieldMapByProject } = req.body || {};
  const existing = getJiraConfig(org.id) || {};
  const next = { ...existing };
  if (typeof baseUrl === 'string') next.baseUrl = baseUrl.trim();
  if (typeof email === 'string') next.email = email.trim();
  if (typeof apiToken === 'string' && apiToken.trim()) next.apiToken = apiToken.trim();
  if (typeof projectKey === 'string') next.projectKey = projectKey.trim();
  if (typeof epicIssueTypeId === 'string') next.epicIssueTypeId = epicIssueTypeId.trim();
  if (typeof periodFieldKey === 'string') next.periodFieldKey = periodFieldKey.trim() || undefined;
  if (periodValueMap && typeof periodValueMap === 'object') next.periodValueMap = periodValueMap;
  if (fieldMapByProject && typeof fieldMapByProject === 'object') next.fieldMapByProject = fieldMapByProject;
  saveJiraConfig(org.id, next);
  const { apiToken: _drop, ...safe } = next;
  void _drop;
  res.json({ config: { ...safe, hasToken: !!next.apiToken } });
});

app.delete('/api/admin/jira-config', requireOrgAdminOrSuperAdmin, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const data = getOKRData();
  data.jiraConfigs = data.jiraConfigs || {};
  delete data.jiraConfigs[org.id];
  saveOKRData(data);
  res.json({ ok: true });
});

app.get('/api/admin/jira/projects', requireOrgAdminOrSuperAdmin, async (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const cfg = getJiraConfig(org.id);
  if (!cfg || !cfg.baseUrl || !cfg.email || !cfg.apiToken) {
    return res.status(400).json({ error: 'Jira not configured' });
  }
  try {
    const r = await jiraFetch(cfg, '/rest/api/3/project/search?maxResults=200');
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(r.status).json({ error: `Jira: ${r.status} ${text.slice(0, 200)}` });
    }
    const data = await r.json();
    const projects = (data.values || []).map(p => ({ id: p.id, key: p.key, name: p.name }));
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Explain how a field name resolves for one real issue: every field on the site
// whose name could answer to it, which one the code reads today (and why), and
// what each would actually return for that issue. This is how an admin tells two
// same-named "Story Points" fields apart before mapping one.
app.get('/api/admin/jira/field-debug', requireOrgAdminOrSuperAdmin, async (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const cfg = getJiraConfig(org.id);
  if (!cfg || !cfg.baseUrl || !cfg.email || !cfg.apiToken) {
    return res.status(400).json({ error: 'Jira not configured' });
  }
  const issueKey = (req.query.issue || '').toString().trim();
  const name = (req.query.name || STORY_POINTS_FIELD).toString().trim();
  if (!issueKey) return res.status(400).json({ error: 'An issue key is required (e.g. DEV-12207).' });
  if (!name) return res.status(400).json({ error: 'A field name is required (e.g. Story Points).' });

  try {
    const ir = await jiraFetch(cfg, `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=*all`);
    if (!ir.ok) {
      const t = await ir.text().catch(() => '');
      const msg = ir.status === 404
        ? `Jira has no issue ${issueKey} visible to ${cfg.email}.`
        : `Jira: ${ir.status} ${t.slice(0, 200)}`;
      return res.status(ir.status === 404 ? 404 : 502).json({ error: msg });
    }
    const issue = await ir.json();
    const projectKey = issue.fields?.project?.key || issueKey.split('-')[0];

    // Aliases only make sense for the field we special-case in code.
    const aliases = name.toLowerCase() === STORY_POINTS_FIELD.toLowerCase() ? STORY_POINTS_ALIASES : [];
    const ranked = rankFieldCandidates(await listJiraFields(cfg, { refresh: true }), name, aliases);
    const mapped = mappedFieldId(cfg, projectKey, name);
    const pickedId = mapped || (ranked[0] ? ranked[0].id : null);

    const candidates = ranked.map(f => {
      const present = Object.prototype.hasOwnProperty.call(issue.fields || {}, f.id);
      const value = present ? issue.fields[f.id] : undefined;
      return {
        id: f.id,
        name: f.name,
        match: f.match,
        type: f.schema?.type || (f.custom ? 'custom' : ''),
        custom: f.schema?.custom ? String(f.schema.custom).split(':').pop() : '',
        // "Not on this issue" (the field isn't on the project's screens) is a very
        // different failure from "on the issue but empty" — both read as 0 today.
        onIssue: present,
        hasValue: present && value !== null && value !== undefined,
        value: value === undefined ? null : value,
        valueText: !present ? '(not on this issue)'
          : value === null ? '(empty)'
          : typeof value === 'object' ? JSON.stringify(value).slice(0, 120)
          : String(value),
        isPicked: f.id === pickedId,
        isMapped: f.id === mapped,
      };
    });
    // A mapped field id that no longer matches the name still needs to be shown.
    if (mapped && !candidates.some(c => c.id === mapped)) {
      const present = Object.prototype.hasOwnProperty.call(issue.fields || {}, mapped);
      candidates.unshift({
        id: mapped, name: '(mapped field — name no longer matches)', match: 'mapped', type: '', custom: '',
        onIssue: present,
        hasValue: present && issue.fields[mapped] != null,
        value: present ? issue.fields[mapped] : null,
        valueText: !present ? '(not on this issue)' : String(issue.fields[mapped] ?? '(empty)'),
        isPicked: true, isMapped: true,
      });
    }

    res.json({
      issue: {
        key: issue.key,
        summary: issue.fields?.summary || '',
        type: issue.fields?.issuetype?.name || '',
        projectKey,
        url: `${cfg.baseUrl.replace(/\/$/, '')}/browse/${issue.key}`,
      },
      name,
      pickedFieldId: pickedId,
      pickedFrom: mapped ? 'mapping' : (pickedId ? 'name-match' : 'none'),
      mappedFieldId: mapped,
      candidates,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Pin a field name to a field id for one project. Sending an empty fieldId drops
// the mapping and falls back to matching by name.
app.put('/api/admin/jira/field-map', requireOrgAdminOrSuperAdmin, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const cfg = getJiraConfig(org.id);
  if (!cfg) return res.status(400).json({ error: 'Jira not configured' });
  const project = (req.body?.project || '').toString().trim().toUpperCase();
  const name = (req.body?.name || '').toString().trim();
  const fieldId = (req.body?.fieldId || '').toString().trim();
  if (!project || !name) return res.status(400).json({ error: 'project and name are required' });

  const map = { ...(cfg.fieldMapByProject || {}) };
  const forProject = { ...(map[project] || {}) };
  if (fieldId) forProject[name] = fieldId;
  else delete forProject[name];
  if (Object.keys(forProject).length) map[project] = forProject;
  else delete map[project];

  saveJiraConfig(org.id, { fieldMapByProject: map });
  res.json({ fieldMapByProject: map });
});

app.post('/api/admin/jira/create-period-field', requireOrgAdminOrSuperAdmin, async (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const cfg = getJiraConfig(org.id);
  if (!cfg || !cfg.baseUrl || !cfg.email || !cfg.apiToken || !cfg.projectKey) {
    return res.status(400).json({ error: 'Jira not fully configured' });
  }
  const { name } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });

  const okr = getOKRData();
  const periods = (okr.periods || []).filter(p => p.orgId === org.id && !p.archived);
  if (periods.length === 0) return res.status(400).json({ error: 'No active periods to use as options' });

  try {
    // 1. Create the custom field
    const fieldRes = await jiraFetch(cfg, '/rest/api/3/field', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        type: 'com.atlassian.jira.plugin.system.customfieldtypes:select',
        searcherKey: 'com.atlassian.jira.plugin.system.customfieldtypes:selectsearcher',
      }),
    });
    if (!fieldRes.ok) {
      const text = await fieldRes.text().catch(() => '');
      return res.status(fieldRes.status).json({ error: `Create field: ${fieldRes.status} ${text.slice(0, 500)}` });
    }
    const fieldData = await fieldRes.json();
    const fieldId = fieldData.id;

    // 2. Resolve / create the field context
    let contextId;
    try {
      const ctxRes = await jiraFetch(cfg, `/rest/api/3/field/${fieldId}/context`);
      if (ctxRes.ok) {
        const ctxData = await ctxRes.json();
        contextId = ctxData.values?.[0]?.id;
      }
    } catch { /* ignore */ }
    if (!contextId) {
      const newCtxRes = await jiraFetch(cfg, `/rest/api/3/field/${fieldId}/context`, {
        method: 'POST',
        body: JSON.stringify({ name: 'OKR app context', description: 'Auto-created by the OKR app for periods' }),
      });
      if (newCtxRes.ok) {
        const d = await newCtxRes.json();
        contextId = d.id;
      }
    }

    // 3. Add an option for each active period
    const periodValueMap = {};
    if (contextId) {
      const optRes = await jiraFetch(cfg, `/rest/api/3/field/${fieldId}/context/${contextId}/option`, {
        method: 'POST',
        body: JSON.stringify({ options: periods.map(p => ({ value: p.name })) }),
      });
      if (optRes.ok) {
        const optData = await optRes.json();
        const created = optData.options || [];
        for (const p of periods) {
          const opt = created.find(o => o.value === p.name);
          if (opt) periodValueMap[p.id] = { id: opt.id, value: opt.value };
        }
      }
    }

    // 4. Best-effort: add the field to the Epic screens for this project
    let attachedScreens = 0;
    const warnings = [];
    try {
      // Resolve project id (numeric) from key
      let projectId = null;
      const projRes = await jiraFetch(cfg, `/rest/api/3/project/${encodeURIComponent(cfg.projectKey)}`);
      if (projRes.ok) {
        const pj = await projRes.json();
        projectId = pj.id;
      }
      // Walk: project → issue type screen scheme → screen scheme(s) for Epic → screens
      let screenIds = new Set();
      if (projectId) {
        const itssRes = await jiraFetch(cfg, `/rest/api/3/issuetypescreenscheme/project?projectId=${projectId}`);
        if (itssRes.ok) {
          const itssData = await itssRes.json();
          const itssId = itssData.values?.[0]?.issueTypeScreenScheme?.id;
          if (itssId) {
            const mappingRes = await jiraFetch(cfg, `/rest/api/3/issuetypescreenscheme/mapping?issueTypeScreenSchemeId=${itssId}`);
            if (mappingRes.ok) {
              const mappingData = await mappingRes.json();
              // Resolve Epic issue type id
              const epicIssueTypeId = cfg.epicIssueTypeId;
              const screenSchemeIds = new Set();
              for (const m of mappingData.values || []) {
                if (m.issueTypeId === 'default' || (epicIssueTypeId && m.issueTypeId === epicIssueTypeId)) {
                  screenSchemeIds.add(m.screenSchemeId);
                }
              }
              for (const ssId of screenSchemeIds) {
                const ssRes = await jiraFetch(cfg, `/rest/api/3/screenscheme?id=${ssId}`);
                if (!ssRes.ok) continue;
                const ssData = await ssRes.json();
                for (const ss of ssData.values || []) {
                  const screens = ss.screens || {};
                  for (const k of Object.keys(screens)) {
                    if (screens[k]) screenIds.add(screens[k]);
                  }
                }
              }
            }
          }
        }
      }
      // Fallback: any screen with "Epic" in its name
      if (screenIds.size === 0) {
        const screensRes = await jiraFetch(cfg, '/rest/api/3/screens?maxResults=200');
        if (screensRes.ok) {
          const screensData = await screensRes.json();
          for (const s of screensData.values || []) {
            if (/epic/i.test(s.name)) screenIds.add(s.id);
          }
        }
        if (screenIds.size === 0) warnings.push('Could not find Epic screens to attach the field — add the field to your Epic create/edit screens manually in Jira.');
      }
      for (const screenId of screenIds) {
        const tabsRes = await jiraFetch(cfg, `/rest/api/3/screens/${screenId}/tabs`);
        if (!tabsRes.ok) continue;
        const tabs = await tabsRes.json();
        const firstTab = Array.isArray(tabs) ? tabs[0] : null;
        if (!firstTab) continue;
        const addRes = await jiraFetch(cfg, `/rest/api/3/screens/${screenId}/tabs/${firstTab.id}/fields`, {
          method: 'POST',
          body: JSON.stringify({ fieldId }),
        });
        if (addRes.ok) attachedScreens++;
      }
    } catch (err) {
      warnings.push(`Screen attachment failed: ${String(err).slice(0, 200)}`);
    }

    saveJiraConfig(org.id, { periodFieldKey: fieldId, periodValueMap });

    res.json({ fieldId, fieldName: fieldData.name, attachedScreens, periodValueMap, warnings });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/jira/epic-fields', requireAuth, async (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const cfg = getJiraConfig(org.id);
  if (!cfg || !cfg.baseUrl || !cfg.email || !cfg.apiToken || !cfg.projectKey) {
    return res.status(400).json({ error: 'Jira not fully configured' });
  }
  try {
    // Resolve Epic issue type id (cache on config)
    let epicId = cfg.epicIssueTypeId;
    if (!epicId) {
      const ir = await jiraFetch(cfg, `/rest/api/3/issuetype/project?projectId=${encodeURIComponent('')}`);
      void ir; // not used directly; fall through to createmeta
    }
    const params = new URLSearchParams({
      projectKeys: cfg.projectKey,
      expand: 'projects.issuetypes.fields',
    });
    const r = await jiraFetch(cfg, `/rest/api/3/issue/createmeta?${params.toString()}`);
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(r.status).json({ error: `Jira: ${r.status} ${text.slice(0, 500)}` });
    }
    const meta = await r.json();
    const project = (meta.projects || []).find(p => p.key === cfg.projectKey) || (meta.projects || [])[0];
    if (!project) return res.json({ project: null, issueType: null, fields: [] });
    const epic = (project.issuetypes || []).find(t => /epic/i.test(t.name));
    if (!epic) return res.json({ project: { id: project.id, key: project.key, name: project.name }, issueType: null, fields: [] });
    // Cache the epic issue type id for create-epic to use
    if (!cfg.epicIssueTypeId || cfg.epicIssueTypeId !== epic.id) {
      saveJiraConfig(org.id, { epicIssueTypeId: epic.id });
    }
    const rawFields = epic.fields || {};
    const fields = Object.keys(rawFields).map(key => {
      const f = rawFields[key];
      return {
        key,
        name: f.name,
        required: !!f.required,
        schema: f.schema ? { type: f.schema.type, items: f.schema.items, custom: f.schema.custom } : null,
        allowedValues: Array.isArray(f.allowedValues)
          ? f.allowedValues.slice(0, 200).map(v => ({ id: v.id, value: v.value, name: v.name, key: v.key }))
          : undefined,
        hasDefaultValue: !!f.hasDefaultValue,
      };
    });
    res.json({
      project: { id: project.id, key: project.key, name: project.name },
      issueType: { id: epic.id, name: epic.name },
      fields,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Find existing Jira issues whose title (summary) exactly matches a given
// title, so the UI can warn before creating a duplicate.
app.get('/api/jira/find-epics', requireAuth, async (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.json({ matches: [] });
  const cfg = getJiraConfig(org.id);
  if (!cfg || !cfg.baseUrl || !cfg.email || !cfg.apiToken || !cfg.projectKey) {
    return res.json({ matches: [] });
  }
  const title = (req.query.title || '').toString().trim();
  if (!title) return res.json({ matches: [] });

  // Escape for a JQL string literal, then phrase-match the summary.
  const esc = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const jql = `project = "${cfg.projectKey.replace(/"/g, '')}" AND summary ~ "\\"${esc}\\"" ORDER BY created DESC`;

  const toMatches = (data) => (data.issues || []).map(it => ({
    key: it.key,
    summary: it.fields?.summary || '',
    url: `${cfg.baseUrl.replace(/\/$/, '')}/browse/${it.key}`,
  }));

  try {
    let issues = [];
    // Prefer the current Cloud enhanced-search endpoint; fall back to the classic one.
    let r = await jiraFetch(cfg, '/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({ jql, fields: ['summary'], maxResults: 50 }),
    });
    if (r.ok) {
      issues = toMatches(await r.json());
    } else {
      r = await jiraFetch(cfg, `/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=summary&maxResults=50`);
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        return res.status(r.status).json({ error: `Jira: ${r.status} ${text.slice(0, 300)}` });
      }
      issues = toMatches(await r.json());
    }
    // Keep only exact (case-insensitive, trimmed) title matches.
    const norm = (s) => s.trim().toLowerCase();
    const matches = issues.filter(i => norm(i.summary) === norm(title));
    res.json({ matches });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/jira/create-epic', requireAuth, async (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const cfg = getJiraConfig(org.id);
  if (!cfg || !cfg.baseUrl || !cfg.email || !cfg.apiToken || !cfg.projectKey) {
    return res.status(400).json({ error: 'Jira not fully configured' });
  }
  const { summary, description, objectiveId } = req.body || {};
  if (!summary || typeof summary !== 'string') return res.status(400).json({ error: 'summary required' });

  let epicIssueTypeId = cfg.epicIssueTypeId;
  // Lazily resolve the Epic issue type id for this project (cached on config)
  if (!epicIssueTypeId) {
    try {
      const r = await jiraFetch(cfg, `/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(cfg.projectKey)}&expand=projects.issuetypes`);
      if (r.ok) {
        const meta = await r.json();
        const project = (meta.projects || [])[0];
        const epic = (project?.issuetypes || []).find(t => /epic/i.test(t.name));
        if (epic) {
          epicIssueTypeId = epic.id;
          saveJiraConfig(org.id, { epicIssueTypeId });
        }
      }
    } catch { /* ignore — falls back to name */ }
  }

  const fields = {
    project: { key: cfg.projectKey },
    summary,
    issuetype: epicIssueTypeId ? { id: epicIssueTypeId } : { name: 'Epic' },
  };
  if (description) {
    fields.description = {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: String(description) }] }],
    };
  }
  // Apply period mapping if configured and the objective has a period
  if (cfg.periodFieldKey && objectiveId) {
    const okr = getOKRData();
    const obj = okr.objectives.find(o => o.id === objectiveId && o.orgId === org.id);
    const period = obj && obj.periodId ? (okr.periods || []).find(p => p.id === obj.periodId) : null;
    if (period) {
      const mapped = cfg.periodValueMap && cfg.periodValueMap[period.id];
      if (mapped && typeof mapped === 'object') {
        // Object form: { id }, { value }, { id, value }, etc.
        fields[cfg.periodFieldKey] = mapped;
      } else if (typeof mapped === 'string' && mapped) {
        fields[cfg.periodFieldKey] = { value: mapped };
      } else {
        // No explicit mapping; fall back to sending the period name as the value
        fields[cfg.periodFieldKey] = period.name;
      }
    }
  }
  try {
    const r = await jiraFetch(cfg, '/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(r.status).json({ error: `Jira: ${r.status} ${text.slice(0, 500)}` });
    }
    const data = await r.json();
    const url = `${cfg.baseUrl.replace(/\/$/, '')}/browse/${data.key}`;
    // Tag the objective if provided
    if (objectiveId) {
      const okr = getOKRData();
      const idx = okr.objectives.findIndex(o => o.id === objectiveId && o.orgId === org.id);
      if (idx !== -1) {
        okr.objectives[idx] = {
          ...okr.objectives[idx],
          jiraEpicKey: data.key,
          jiraEpicUrl: url,
          updatedAt: new Date().toISOString(),
        };
        saveOKRData(okr);
      }
    }
    res.json({ key: data.key, url });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Admin: get every user's lists/plans across the org (for backup)
app.get('/api/admin/all-plans', requireOrgAdminOrSuperAdmin, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.json({ plans: [] });
  const users = getUsersByOrganization(org.id);
  const out = [];
  for (const u of users) {
    if (!u.email) continue;
    const userLists = u.lists || [];
    for (const l of userLists) {
      out.push({ ...l, ownerEmail: u.email });
    }
  }
  res.json({ plans: out });
});

// Admin: replace every user's lists in bulk (for backup restore)
app.put('/api/admin/all-plans', requireOrgAdminOrSuperAdmin, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const incoming = Array.isArray(req.body?.plans) ? req.body.plans : [];
  // Group plans by ownerEmail
  const byEmail = new Map();
  for (const p of incoming) {
    const email = (p.ownerEmail || '').toLowerCase();
    if (!email) continue;
    const { ownerEmail: _drop, ...plan } = p;
    void _drop;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(plan);
  }
  const users = getUsers();
  const orgUserEmails = new Set(getUsersByOrganization(org.id).map(u => (u.email || '').toLowerCase()));
  let touched = 0;
  for (let i = 0; i < users.length; i++) {
    const email = (users[i].email || '').toLowerCase();
    if (!orgUserEmails.has(email)) continue;
    users[i].lists = byEmail.get(email) || [];
    touched++;
  }
  saveUsers(users);
  res.json({ touched });
});

app.delete('/api/users/:email', requireOrgAdminOrSuperAdmin, (req, res) => {
  const decodedEmail = decodeURIComponent(req.params.email).toLowerCase();

  if (decodedEmail === req.user.email.toLowerCase()) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  if (!isSuperAdmin(req.user.email)) {
    const org = getOrganizationByDomain(req.user.domain);
    const users = getUsersByOrganization(org?.id);
    if (!users.some(u => u.email === decodedEmail)) {
      return res.status(403).json({ error: 'Cannot delete users from other organizations' });
    }
  }

  const users = getUsers();
  const before = users.length;
  const remaining = users.filter(u => u.email !== decodedEmail);
  if (remaining.length === before) {
    return res.status(404).json({ error: 'User not found' });
  }
  saveUsers(remaining);
  res.json({ ok: true });
});

app.put('/api/users/:email/name', requireAuth, (req, res) => {
  const { email } = req.params;
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const decodedEmail = decodeURIComponent(email).toLowerCase();
  const callerEmail = req.user.email?.toLowerCase();
  const isSelf = callerEmail === decodedEmail;
  const org = getOrganizationByDomain(req.user.domain);
  const isOrgAdminUser = org
    ? org.admins?.some(a => a.email === callerEmail && a.status === 'accepted')
    : false;
  const isSuperAdminUser = isSuperAdmin(req.user.email);

  if (!isSelf && !isOrgAdminUser && !isSuperAdminUser) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Verify user belongs to same org (unless super admin)
  if (!isSuperAdminUser) {
    const users = getUsersByOrganization(org?.id);
    if (!users.some(u => u.email === decodedEmail)) {
      return res.status(403).json({ error: 'Cannot modify users from other organizations' });
    }
  }

  const updatedUser = updateUserName(decodedEmail, name.trim());
  if (!updatedUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user: updatedUser });
});

// User preferences endpoints
app.get('/api/users/me/preferences', requireAuth, (req, res) => {
  const preferences = getUserPreferences(req.user.email);
  res.json({ preferences });
});

app.put('/api/users/me/preferences', requireAuth, (req, res) => {
  const { preferences } = req.body;

  if (!preferences || typeof preferences !== 'object') {
    return res.status(400).json({ error: 'Preferences object is required' });
  }

  const updatedPreferences = updateUserPreferences(req.user.email, preferences);
  if (!updatedPreferences) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ preferences: updatedPreferences });
});

// Saved views endpoints
app.get('/api/users/me/views', requireAuth, (req, res) => {
  const views = getUserViews(req.user.email);
  res.json({ views });
});

app.post('/api/users/me/views', requireAuth, (req, res) => {
  const { name, filters, visibleColumns, columnWidths, isDefault } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'View name is required' });
  }

  const views = getUserViews(req.user.email);
  const now = new Date().toISOString();

  // If this view is set as default, clear default from other views
  if (isDefault) {
    views.forEach(v => v.isDefault = false);
  }

  const newView = {
    id: generateViewId(),
    name: name.trim(),
    isDefault: isDefault || false,
    starred: true,
    createdAt: now,
    updatedAt: now,
    filters: filters || {},
    visibleColumns: visibleColumns || [],
    columnWidths: columnWidths || {},
  };

  views.push(newView);
  const savedViews = saveUserViews(req.user.email, views);

  if (!savedViews) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ view: newView, views: savedViews });
});

app.put('/api/users/me/views/:viewId', requireAuth, (req, res) => {
  const { viewId } = req.params;
  const { name, filters, visibleColumns, columnWidths } = req.body;

  const views = getUserViews(req.user.email);
  const viewIndex = views.findIndex(v => v.id === viewId);

  if (viewIndex === -1) {
    return res.status(404).json({ error: 'View not found' });
  }

  const now = new Date().toISOString();
  views[viewIndex] = {
    ...views[viewIndex],
    ...(name && { name: name.trim() }),
    ...(filters && { filters }),
    ...(visibleColumns && { visibleColumns }),
    ...(columnWidths && { columnWidths }),
    updatedAt: now,
  };

  const savedViews = saveUserViews(req.user.email, views);
  res.json({ view: views[viewIndex], views: savedViews });
});

app.delete('/api/users/me/views/:viewId', requireAuth, (req, res) => {
  const { viewId } = req.params;

  const views = getUserViews(req.user.email);
  const viewIndex = views.findIndex(v => v.id === viewId);

  if (viewIndex === -1) {
    return res.status(404).json({ error: 'View not found' });
  }

  views.splice(viewIndex, 1);
  const savedViews = saveUserViews(req.user.email, views);
  res.json({ views: savedViews });
});

app.put('/api/users/me/views/:viewId/default', requireAuth, (req, res) => {
  const { viewId } = req.params;

  const views = getUserViews(req.user.email);
  const viewIndex = views.findIndex(v => v.id === viewId);

  if (viewIndex === -1) {
    return res.status(404).json({ error: 'View not found' });
  }

  // Clear default from all views, then set the selected one
  views.forEach(v => v.isDefault = false);
  views[viewIndex].isDefault = true;
  views[viewIndex].updatedAt = new Date().toISOString();

  const savedViews = saveUserViews(req.user.email, views);
  res.json({ view: views[viewIndex], views: savedViews });
});

app.put('/api/users/me/views/:viewId/starred', requireAuth, (req, res) => {
  const { viewId } = req.params;

  const views = getUserViews(req.user.email);
  const viewIndex = views.findIndex(v => v.id === viewId);

  if (viewIndex === -1) {
    return res.status(404).json({ error: 'View not found' });
  }

  views[viewIndex].starred = !views[viewIndex].starred;
  views[viewIndex].updatedAt = new Date().toISOString();

  const savedViews = saveUserViews(req.user.email, views);
  res.json({ view: views[viewIndex], views: savedViews });
});

// ---- Mindmaps (sticky-note canvas) ----

// List: own + shared within the org, each annotated with mine/starred, newest first.
app.get('/api/mindmaps', requireAuth, (req, res) => {
  const email = req.user.email;
  const domain = req.user.domain;
  const starred = new Set(getStarredMindmapIds(email));
  const visible = getMindmaps().filter(m => isMindmapVisible(m, email, domain));
  const mindmaps = visible
    .map(m => {
      const mine = m.creatorEmail === email;
      return {
        id: m.id,
        title: m.title,
        creatorEmail: m.creatorEmail,
        creatorName: m.creatorName,
        shared: !!m.shared,
        // Only the creator sees who else it's shared with.
        ...(mine ? { sharedWith: Array.isArray(m.sharedWith) ? m.sharedWith : [] } : {}),
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        // Non-creators only count the notes their granted views admit.
        noteCount: mine
          ? (Array.isArray(m.notes) ? m.notes.length : 0)
          : notesVisibleToViewer(m, grantedViewsFor(m, email, domain)).length,
        mine,
        starred: starred.has(m.id),
      };
    })
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  res.json({ mindmaps });
});

// Create an empty mindmap and return it (client redirects straight to its canvas).
app.post('/api/mindmaps', requireAuth, (req, res) => {
  const email = req.user.email;
  const rawTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const title = (rawTitle || 'Untitled mindmap').slice(0, 200);
  const now = new Date().toISOString();
  const mindmap = {
    id: generateMindmapId(),
    title,
    creatorEmail: email,
    creatorName: displayNameForEmail(email, req.user.name),
    domain: req.user.domain || null,
    shared: false,
    sharedWith: [],
    views: [],
    frames: [],
    createdAt: now,
    updatedAt: now,
    notes: [],
  };
  const mindmaps = getMindmaps();
  mindmaps.push(mindmap);
  saveMindmaps(mindmaps);
  res.json({ mindmap, mine: true, canEdit: true, starred: false });
});

// Read one visible mindmap. Not visible / nonexistent => 404 (never 403).
app.get('/api/mindmaps/:id', requireAuth, (req, res) => {
  const email = req.user.email;
  const mm = findVisibleMindmap(getMindmaps(), req.params.id, email, req.user.domain);
  if (!mm) return res.status(404).json({ error: 'Mindmap not found' });
  const mine = mm.creatorEmail === email;
  const out = { ...mm };
  if (!mine) {
    // Enforce view-based access: non-creators see only the notes their granted
    // views admit (or the whole board if no view is granted to them). Don't
    // leak the view/group config or the explicit share list. Frames are pruned
    // to the notes the viewer can actually see.
    out.notes = notesVisibleToViewer(mm, grantedViewsFor(mm, email, req.user.domain));
    out.frames = pruneFrames(mm.frames, out.notes);
    delete out.sharedWith;
    delete out.views;
  }
  res.json({
    mindmap: out,
    mine,
    canEdit: mine,
    starred: getStarredMindmapIds(email).includes(mm.id),
  });
});

// Update title/shared/sharedWith/notes. Creator only; anyone else gets 404.
app.put('/api/mindmaps/:id', requireAuth, (req, res) => {
  const email = req.user.email;
  const mindmaps = getMindmaps();
  const mm = findVisibleMindmap(mindmaps, req.params.id, email, req.user.domain);
  if (!mm) return res.status(404).json({ error: 'Mindmap not found' });
  if (mm.creatorEmail !== email) return res.status(404).json({ error: 'Mindmap not found' });

  const { title, shared, sharedWith, notes, views, frames } = req.body || {};
  if (typeof title === 'string') mm.title = (title.trim() || 'Untitled mindmap').slice(0, 200);
  if (typeof shared === 'boolean') mm.shared = shared;
  if (Array.isArray(sharedWith)) {
    // Normalize to a de-duped list of lowercased emails (never the creator).
    mm.sharedWith = Array.from(new Set(
      sharedWith
        .filter(e => typeof e === 'string')
        .map(e => e.trim().toLowerCase())
        .filter(e => e && e !== email.toLowerCase()),
    )).slice(0, 500);
  }
  if (Array.isArray(views)) mm.views = sanitizeViews(views);
  if (frames !== undefined) mm.frames = sanitizeFrames(frames);
  if (notes !== undefined) mm.notes = sanitizeNotes(notes);
  // Keep frame membership consistent with the current notes.
  mm.frames = pruneFrames(mm.frames, mm.notes);
  mm.updatedAt = new Date().toISOString();
  saveMindmaps(mindmaps);

  res.json({
    mindmap: mm,
    mine: true,
    canEdit: true,
    starred: getStarredMindmapIds(email).includes(mm.id),
  });
});

// Delete. Creator only; anyone else gets 404.
app.delete('/api/mindmaps/:id', requireAuth, (req, res) => {
  const email = req.user.email;
  const mindmaps = getMindmaps();
  const mm = findVisibleMindmap(mindmaps, req.params.id, email, req.user.domain);
  if (!mm) return res.status(404).json({ error: 'Mindmap not found' });
  if (mm.creatorEmail !== email) return res.status(404).json({ error: 'Mindmap not found' });
  saveMindmaps(mindmaps.filter(m => m.id !== mm.id));
  res.json({ success: true });
});

// Star/unstar. Any viewer; stored per-user, never touches the mindmap record.
app.post('/api/mindmaps/:id/star', requireAuth, (req, res) => {
  const email = req.user.email;
  const mm = findVisibleMindmap(getMindmaps(), req.params.id, email, req.user.domain);
  if (!mm) return res.status(404).json({ error: 'Mindmap not found' });
  const star = !!req.body?.star;
  const starredList = setMindmapStar(email, mm.id, star);
  if (starredList === null) return res.status(404).json({ error: 'User not found' });
  res.json({ starred: star });
});

// ---- User groups (org-scoped; managed by org admins on Settings) ----

function isGroupAdmin(email) {
  return isSuperAdmin(email) || isOrgAdmin(email);
}
function normalizeMemberEmails(list) {
  if (!Array.isArray(list)) return [];
  return Array.from(new Set(
    list.filter(e => typeof e === 'string').map(e => e.trim().toLowerCase()).filter(Boolean),
  )).slice(0, 2000);
}

// List groups. Admins get full membership; others get id/name/memberCount only
// (enough to assign views without leaking who is in each group).
app.get('/api/groups', requireAuth, (req, res) => {
  const groups = getGroupsForDomain(req.user.domain);
  if (isGroupAdmin(req.user.email)) {
    return res.json({ groups, canManage: true });
  }
  res.json({
    groups: groups.map(g => ({ id: g.id, name: g.name, memberCount: Array.isArray(g.memberEmails) ? g.memberEmails.length : 0 })),
    canManage: false,
  });
});

app.post('/api/groups', requireAuth, (req, res) => {
  if (!isGroupAdmin(req.user.email)) return res.status(403).json({ error: 'Admin only' });
  const name = (typeof req.body?.name === 'string' ? req.body.name.trim() : '').slice(0, 100);
  if (!name) return res.status(400).json({ error: 'Group name is required' });
  const groups = getGroupsForDomain(req.user.domain);
  const group = { id: generateGroupId(), name, memberEmails: normalizeMemberEmails(req.body?.memberEmails) };
  const saved = saveGroupsForDomain(req.user.domain, [...groups, group]);
  if (saved === null) return res.status(400).json({ error: 'No organization for this domain' });
  res.json({ group });
});

app.put('/api/groups/:id', requireAuth, (req, res) => {
  if (!isGroupAdmin(req.user.email)) return res.status(403).json({ error: 'Admin only' });
  const groups = getGroupsForDomain(req.user.domain);
  const idx = groups.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Group not found' });
  if (typeof req.body?.name === 'string') groups[idx].name = req.body.name.trim().slice(0, 100) || groups[idx].name;
  if (req.body?.memberEmails !== undefined) groups[idx].memberEmails = normalizeMemberEmails(req.body.memberEmails);
  saveGroupsForDomain(req.user.domain, groups);
  res.json({ group: groups[idx] });
});

app.delete('/api/groups/:id', requireAuth, (req, res) => {
  if (!isGroupAdmin(req.user.email)) return res.status(403).json({ error: 'Admin only' });
  const groups = getGroupsForDomain(req.user.domain);
  if (!groups.some(g => g.id === req.params.id)) return res.status(404).json({ error: 'Group not found' });
  saveGroupsForDomain(req.user.domain, groups.filter(g => g.id !== req.params.id));
  res.json({ success: true });
});

// ---- Plan stages (per-organization, configurable in Settings) ----
const DEFAULT_PLAN_STAGES = ['New', 'In Review', 'In Execution', 'In Retrospective', 'Closed', 'Archived'];
function getPlanStages(orgId) {
  const data = getOKRData();
  const stages = data.planStages && data.planStages[orgId];
  return Array.isArray(stages) && stages.length > 0 ? stages : [...DEFAULT_PLAN_STAGES];
}
function savePlanStages(orgId, stages) {
  const data = getOKRData();
  data.planStages = data.planStages || {};
  data.planStages[orgId] = stages;
  saveOKRData(data);
  return data.planStages[orgId];
}

app.get('/api/plan-stages', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  res.json({ stages: org ? getPlanStages(org.id) : [...DEFAULT_PLAN_STAGES] });
});

// ---- Weekly engineering check (per-organization, configurable in Settings) ----
// Attainment for the engineering org: each member's story points resolved in the
// window against an expected-per-person target, flagging anyone below a
// percentage of it. Membership comes from the org chart — the root department
// and everything under it — so the check follows the org chart, not a hand-kept
// list. Members can be individually opted out (on leave, non-delivery role).
// Two targets: story points expected per person per week (a floor — falling below
// a percentage of it is flagged), and the maximum size a single ticket should be
// (a ceiling — any ticket over it is counted, since oversized tickets mean work
// that wasn't broken down). Each has an org-wide default that any member can
// override, so the values here are only the fallback.
const WEEKLY_CHECK_DEFAULTS = { rootDepartment: 'Software Engineering', expectedSp: 32, maxTicketSize: 16, thresholdPct: 80 };

const posNum = (v, fallback) => (Number.isFinite(v) && v >= 0 ? v : fallback);

// The ticket-size setting was briefly an average (`expectedAvgTicketSize`) before
// it became a ceiling. Values saved under the old key are read as the ceiling, so
// no one's configured number is silently dropped.
const ticketSizeOf = (o) => (Number.isFinite(o?.maxTicketSize) ? o.maxTicketSize : o?.expectedAvgTicketSize);

function getWeeklyCheck(orgId) {
  const data = getOKRData();
  const cfg = (data.weeklyCheck && data.weeklyCheck[orgId]) || {};
  return {
    rootDepartment: typeof cfg.rootDepartment === 'string' && cfg.rootDepartment ? cfg.rootDepartment : WEEKLY_CHECK_DEFAULTS.rootDepartment,
    expectedSp: posNum(cfg.expectedSp, WEEKLY_CHECK_DEFAULTS.expectedSp),
    maxTicketSize: posNum(ticketSizeOf(cfg), WEEKLY_CHECK_DEFAULTS.maxTicketSize),
    thresholdPct: posNum(cfg.thresholdPct, WEEKLY_CHECK_DEFAULTS.thresholdPct),
    members: (cfg.members && typeof cfg.members === 'object') ? cfg.members : {},
  };
}
function saveWeeklyCheck(orgId, patch) {
  const data = getOKRData();
  data.weeklyCheck = data.weeklyCheck || {};
  data.weeklyCheck[orgId] = { ...getWeeklyCheck(orgId), ...patch };
  saveOKRData(data);
  return getWeeklyCheck(orgId);
}

// The root department plus every department beneath it, by name.
function departmentSubtree(orgId, rootName) {
  const all = getDepartments(orgId);
  const root = all.find(d => d.name.toLowerCase() === String(rootName || '').toLowerCase());
  if (!root) return [];
  const names = [root.name];
  for (let i = 0; i < names.length; i++) {
    for (const d of all) {
      if (d.parentName && d.parentName.toLowerCase() === names[i].toLowerCase() && !names.includes(d.name)) names.push(d.name);
    }
  }
  return names;
}

const displayNameOf = (u) => String(u.nameOverride || u.name || '').trim();
const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Jira Cloud hides user emails, so a person can only be linked to a Jira account
// by display name — and the names are often short forms ("Shivang" for "Shivang
// Nagaria", "Kushal Goswami" for "Kushal Kumar Goswami"). Match on the first and
// last name token, treating a single-token Jira name as a first-name-only match.
// Anything ambiguous (two members named Shubham) stays unmatched on purpose, for
// an admin to resolve with an explicit mapping in Settings.
function jiraNameMatches(jiraName, memberName) {
  const j = normName(jiraName), m = normName(memberName);
  if (!j || !m) return false;
  if (j === m) return true;
  const jt = j.split(' '), mt = m.split(' ');
  if (jt[0] !== mt[0]) return false;
  if (jt.length === 1 || mt.length === 1) return true;
  return jt[jt.length - 1] === mt[mt.length - 1];
}

// Everyone in the engineering org chart, with their weekly-check settings and the
// Jira account they resolve to. `jiraAccountId` is an admin override; without one
// we fall back to name matching against the assignees seen in the window.
function weeklyCheckMembers(orgId, cfg = getWeeklyCheck(orgId)) {
  const depts = departmentSubtree(orgId, cfg.rootDepartment).map(normName);
  const org = getOrganizations().find(o => o.id === orgId);
  return getUsers()
    .filter(u => u.organizationId === orgId || (org && u.domain === org.domain))
    .filter(u => depts.includes(normName(u.department)))
    .map(u => {
      const saved = cfg.members[u.id] || {};
      // A null override means "use the org default" — kept distinct from 0, which is
      // a deliberate target of zero.
      const override = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
      const expectedSp = override(saved.expectedSp);
      const maxTicketSize = override(ticketSizeOf(saved));
      return {
        userId: u.id,
        name: displayNameOf(u),
        email: u.email,
        department: u.department || '',
        // Opt-in by default: a new hire lands in the check without a settings visit.
        included: saved.included !== false,
        jiraAccountId: saved.jiraAccountId || null,
        jiraName: saved.jiraName || null,
        expectedSp,                                            // null = inherit
        maxTicketSize,                                         // null = inherit
        effectiveExpectedSp: expectedSp ?? cfg.expectedSp,
        effectiveMaxTicketSize: maxTicketSize ?? cfg.maxTicketSize,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Attainment per member for the tickets resolved in the window. `tickets` carry
// assignee display names and account ids; expected scales with the window length
// so a 14-day report expects twice a 7-day one.
function weeklyAttainment(orgId, tickets, days) {
  const cfg = getWeeklyCheck(orgId);
  const members = weeklyCheckMembers(orgId, cfg);

  const claimed = new Set(); // assignee keys attributed to a member
  const rows = members.filter(m => m.included).map(m => {
    const mine = tickets.filter(t => {
      const key = t.assigneeId || t.assignee;
      if (!key) return false;
      const hit = m.jiraAccountId
        ? t.assigneeId === m.jiraAccountId
        : jiraNameMatches(t.assignee, m.jiraName || m.name);
      if (hit) claimed.add(key);
      return hit;
    });
    const sp = mine.reduce((n, t) => n + (t.storyPoints || 0), 0);
    // Story points scale with the window; the ticket-size ceiling doesn't — it's a
    // property of a single ticket, not of how long we looked.
    const expectedSp = m.effectiveExpectedSp * (days / 7);
    const maxSize = m.effectiveMaxTicketSize;
    // Epics are already out of `tickets` — they're containers, not work items, and
    // would trip the ceiling by design.
    const oversized = maxSize > 0 ? mine.filter(t => (t.storyPoints || 0) > maxSize) : [];
    return {
      userId: m.userId,
      name: m.name,
      department: m.department,
      jiraName: mine[0]?.assignee || m.jiraName || null,
      count: mine.length,
      sp: Number(sp.toFixed(2)),
      expectedSp: Number(expectedSp.toFixed(2)),
      customExpectedSp: m.expectedSp != null,
      pct: expectedSp > 0 ? Math.round((sp / expectedSp) * 100) : null,
      below: expectedSp > 0 && (sp / expectedSp) * 100 < cfg.thresholdPct,
      // Ticket-size violations ride along here but are reported separately — the
      // attainment table is about story points delivered, nothing else.
      maxTicketSize: maxSize,
      customMaxTicketSize: m.maxTicketSize != null,
      oversized: oversized
        .sort((a, b) => (b.storyPoints || 0) - (a.storyPoints || 0))
        .map(t => ({ key: t.key, summary: t.summary, sp: t.storyPoints || 0, url: t.url, type: t.type })),
    };
  }).sort((a, b) => b.sp - a.sp || a.name.localeCompare(b.name));

  // Resolved work by someone the check doesn't cover — someone outside the
  // engineering org chart (SOC, say), an excluded member, or an engineer whose
  // Jira name didn't match. Surfaced because it's the only evidence of a failed
  // name match: a member showing 0 points is indistinguishable from one who
  // simply shipped nothing, but their unmatched points show up here.
  const unattributed = [];
  const seen = new Map();
  for (const t of tickets) {
    const key = t.assigneeId || t.assignee;
    if (!key || claimed.has(key)) continue;
    const e = seen.get(key) || { assignee: t.assignee || 'Unassigned', count: 0, sp: 0 };
    e.count += 1; e.sp += t.storyPoints || 0;
    seen.set(key, e);
  }
  for (const e of seen.values()) unattributed.push({ ...e, sp: Number(e.sp.toFixed(2)) });
  unattributed.sort((a, b) => b.sp - a.sp);

  // Ticket-size violations are their own report: who closed tickets bigger than
  // the ceiling, how many, and which ones. Epics are already excluded upstream.
  const oversizedByMember = rows
    .filter(r => r.oversized.length > 0)
    .map(r => ({
      userId: r.userId,
      name: r.name,
      department: r.department,
      maxTicketSize: r.maxTicketSize,
      customMaxTicketSize: r.customMaxTicketSize,
      count: r.oversized.length,
      tickets: r.oversized,
    }))
    .sort((a, b) => b.count - a.count || b.tickets[0].sp - a.tickets[0].sp || a.name.localeCompare(b.name));

  return {
    expectedSp: cfg.expectedSp,                                     // org default, per 7 days
    expectedForWindow: Number((cfg.expectedSp * (days / 7)).toFixed(2)),
    maxTicketSize: cfg.maxTicketSize,                               // org default
    thresholdPct: cfg.thresholdPct,
    rootDepartment: cfg.rootDepartment,
    days,
    // Story points only — ticket size is reported separately.
    rows: rows.map(({ maxTicketSize: _mts, customMaxTicketSize: _cmts, oversized: _o, ...sp }) => sp),
    below: rows.filter(r => r.below).map(r => r.name),
    oversized: {
      maxTicketSize: cfg.maxTicketSize,
      ticketCount: oversizedByMember.reduce((n, m) => n + m.count, 0),
      engineerCount: oversizedByMember.length,
      members: oversizedByMember,
    },
    excluded: members.filter(m => !m.included).map(m => m.name),
    unattributed,
  };
}

const weeklyCheckConfig = (cfg) => ({
  rootDepartment: cfg.rootDepartment,
  expectedSp: cfg.expectedSp,
  maxTicketSize: cfg.maxTicketSize,
  thresholdPct: cfg.thresholdPct,
});

app.get('/api/admin/weekly-check', requireOrgAdminOrSuperAdmin, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const cfg = getWeeklyCheck(org.id);
  res.json({
    config: weeklyCheckConfig(cfg),
    members: weeklyCheckMembers(org.id, cfg),
    departments: departmentSubtree(org.id, cfg.rootDepartment),
  });
});

app.put('/api/admin/weekly-check', requireOrgAdminOrSuperAdmin, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const { expectedSp, maxTicketSize, thresholdPct, rootDepartment } = req.body || {};
  const patch = {};
  for (const [key, raw] of [['expectedSp', expectedSp], ['maxTicketSize', maxTicketSize], ['thresholdPct', thresholdPct]]) {
    if (raw == null) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `${key} must be a number ≥ 0` });
    patch[key] = n;
  }
  if (typeof rootDepartment === 'string' && rootDepartment.trim()) patch.rootDepartment = rootDepartment.trim();
  const cfg = saveWeeklyCheck(org.id, patch);
  res.json({ config: weeklyCheckConfig(cfg), members: weeklyCheckMembers(org.id, cfg) });
});

// Per-member settings: opt out of the weekly check, and/or pin the Jira account
// when the name match can't find them.
app.put('/api/admin/weekly-check/member', requireOrgAdminOrSuperAdmin, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const { userId, included, jiraAccountId, jiraName, expectedSp, maxTicketSize } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  const cfg = getWeeklyCheck(org.id);
  if (!weeklyCheckMembers(org.id, cfg).some(m => m.userId === userId)) {
    return res.status(404).json({ error: 'That user is not in the engineering org chart.' });
  }
  const members = { ...cfg.members };
  const entry = { ...(members[userId] || {}) };
  if (typeof included === 'boolean') entry.included = included;
  if (jiraAccountId !== undefined) entry.jiraAccountId = jiraAccountId ? String(jiraAccountId) : null;
  if (jiraName !== undefined) entry.jiraName = jiraName ? String(jiraName) : null;
  // null clears the override and the member falls back to the org default.
  for (const [key, raw] of [['expectedSp', expectedSp], ['maxTicketSize', maxTicketSize]]) {
    if (raw === undefined) continue;
    // Writing the ticket size retires the legacy key, so clearing the override
    // isn't quietly undone by a stale `expectedAvgTicketSize` still sitting there.
    if (key === 'maxTicketSize') delete entry.expectedAvgTicketSize;
    if (raw === null || raw === '') { entry[key] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `${key} must be a number ≥ 0, or null to use the team default` });
    entry[key] = n;
  }
  members[userId] = entry;
  const saved = saveWeeklyCheck(org.id, { members });
  res.json({ members: weeklyCheckMembers(org.id, saved) });
});

// Jira accounts to choose from when pinning a member's Jira identity.
app.get('/api/admin/jira/users', requireOrgAdminOrSuperAdmin, async (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const cfg = getJiraConfig(org.id);
  if (!cfg || !cfg.baseUrl || !cfg.email || !cfg.apiToken) return res.status(400).json({ error: 'Jira not configured' });
  const query = (req.query.query || '').toString().trim();
  try {
    const r = await jiraFetch(cfg, `/rest/api/3/user/search?query=${encodeURIComponent(query)}&maxResults=50`);
    if (!r.ok) { const t = await r.text().catch(() => ''); return res.status(r.status).json({ error: `Jira: ${r.status} ${t.slice(0, 200)}` }); }
    const users = (await r.json().catch(() => []))
      .filter(u => u.accountType === 'atlassian' && u.active)
      .map(u => ({ accountId: u.accountId, displayName: u.displayName }));
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---- Departments (org-level defined list, used for autocomplete) ----
// A defined department is { name, parentName } where parentName is the name of its
// parent department (or null for a top-level department). Older data stored a plain
// string per department; those normalize to a top-level department.
function normalizeDepartment(d) {
  if (typeof d === 'string') { const name = d.trim(); return name ? { name, parentName: null } : null; }
  if (d && typeof d === 'object' && d.name != null) {
    const name = String(d.name).trim();
    if (!name) return null;
    const parentName = d.parentName != null && String(d.parentName).trim() ? String(d.parentName).trim() : null;
    return { name, parentName };
  }
  return null;
}
function getDepartments(orgId) {
  const data = getOKRData();
  const list = data.departments && data.departments[orgId];
  return (Array.isArray(list) ? list : []).map(normalizeDepartment).filter(Boolean);
}
function saveDepartments(orgId, list) {
  const data = getOKRData();
  data.departments = data.departments || {};
  data.departments[orgId] = list;
  saveOKRData(data);
  return getDepartments(orgId);
}
// Normalize a raw department list into a clean hierarchy: dedupe by name
// (case-insensitive; first wins), resolve each parent to a canonical existing
// name (dropping missing/self parents), and break cycles.
function sanitizeDepartments(rawList) {
  const clean = [];
  const byLower = new Map();
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    const d = normalizeDepartment(raw);
    if (!d || byLower.has(d.name.toLowerCase())) continue;
    const entry = { name: d.name, parentName: d.parentName };
    byLower.set(entry.name.toLowerCase(), entry);
    clean.push(entry);
  }
  for (const entry of clean) {
    const parent = entry.parentName ? byLower.get(entry.parentName.toLowerCase()) : null;
    entry.parentName = parent && parent.name.toLowerCase() !== entry.name.toLowerCase() ? parent.name : null;
  }
  for (const entry of clean) {
    const seen = new Set([entry.name.toLowerCase()]);
    let cur = entry.parentName;
    while (cur) {
      const lower = cur.toLowerCase();
      if (seen.has(lower)) { entry.parentName = null; break; }
      seen.add(lower);
      cur = byLower.get(lower)?.parentName || null;
    }
  }
  return clean;
}

// The selectable department list: the defined list merged with any already in
// use on users (so directory-synced departments are always selectable).
app.get('/api/departments', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.json({ departments: [], defined: [] });
  const defined = getDepartments(org.id);
  const inUse = [...new Set(getUsersByOrganization(org.id).map(u => u.department).filter(Boolean))];
  const departments = [...new Set([...defined.map(d => d.name), ...inUse])].sort((a, b) => a.localeCompare(b));
  res.json({ departments, defined });
});

app.put('/api/admin/departments', requireOrgAdminOrSuperAdmin, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const { departments } = req.body || {};
  if (!Array.isArray(departments)) return res.status(400).json({ error: 'departments must be an array' });
  saveDepartments(org.id, sanitizeDepartments(departments));
  res.json({ departments: getDepartments(org.id) });
});

// Emails excluded from the reporting structure.
app.get('/api/excluded-emails', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.json({ excludedEmails: [] });
  res.json({ excludedEmails: getExcludedEmails(org.id) });
});

app.put('/api/admin/excluded-emails', requireOrgAdminOrSuperAdmin, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const { excludedEmails } = req.body || {};
  if (!Array.isArray(excludedEmails)) return res.status(400).json({ error: 'excludedEmails must be an array' });
  const saved = saveExcludedEmails(org.id, excludedEmails);
  // Re-resolve so excluded users (and anyone reporting to them) drop out of the
  // reporting tree immediately.
  const users = getUsers();
  resolveManagerIds(users, org.id);
  saveUsers(users);
  res.json({ excludedEmails: saved });
});

// Export "Users & reporting" as JSON: each user's manager/department, the defined
// department hierarchy, and the emails excluded from the reporting structure.
app.get('/api/admin/users-reporting/export', requireOrgAdminOrSuperAdmin, (req, res) => {
  try {
    const org = getOrganizationByDomain(req.user.domain);
    if (!org) return res.status(403).json({ error: 'No organization found' });
    const users = getUsersByOrganization(org.id).slice().sort((a, b) => (a.email || '').localeCompare(b.email || ''));
    const byId = new Map(users.map(u => [u.id, u]));
    const payload = {
      type: 'okr-users-reporting',
      version: 1,
      exportedAt: new Date().toISOString(),
      domain: org.domain,
      departments: getDepartments(org.id),
      excludedEmails: getExcludedEmails(org.id),
      users: users.map(u => ({
        email: u.email || '',
        name: u.name || '',
        managerEmail: u.managerEmail || (u.managerId ? byId.get(u.managerId)?.email : '') || '',
        department: u.department || '',
      })),
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="users-reporting-${org.domain}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('[users-reporting/export] error:', e);
    res.status(500).json({ error: `Export failed: ${String(e?.message || e)}` });
  }
});

// Import "Users & reporting" from an exported JSON. Applies the department
// hierarchy and excluded-emails list, then sets each matched user's manager /
// department by email. Updates local records only (does not write back to Google).
app.post('/api/admin/users-reporting/import', requireOrgAdminOrSuperAdmin, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const payload = req.body?.data ?? req.body;
  if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'Provide the exported JSON in { data }.' });
  if (!Array.isArray(payload.users) && !Array.isArray(payload.departments) && !Array.isArray(payload.excludedEmails)) {
    return res.status(400).json({ error: 'This does not look like a Users & reporting export.' });
  }

  let departmentsCount = 0;
  if (Array.isArray(payload.departments)) {
    departmentsCount = saveDepartments(org.id, sanitizeDepartments(payload.departments)).length;
  }
  let excludedCount = 0;
  if (Array.isArray(payload.excludedEmails)) {
    excludedCount = saveExcludedEmails(org.id, payload.excludedEmails).length;
  }

  let updated = 0;
  const unmatched = new Set(), unknownManagers = new Set();
  const users = getUsers();
  const byEmail = new Map(users.map(u => [u.email?.toLowerCase(), u]));
  if (Array.isArray(payload.users)) {
    for (const row of payload.users) {
      const email = String(row?.email || '').trim().toLowerCase();
      if (!email) continue;
      const u = byEmail.get(email);
      if (!u || u.organizationId !== org.id) { unmatched.add(email); continue; }
      if ('managerEmail' in row) {
        const mgr = String(row.managerEmail || '').trim().toLowerCase();
        u.managerEmail = mgr || undefined;
        if (mgr && !byEmail.get(mgr)) unknownManagers.add(mgr);
      }
      if ('department' in row) u.department = String(row.department || '').trim() || undefined;
      updated++;
    }
  }
  // Re-resolve manager links (also reflects the new department/exclusion state).
  const linked = resolveManagerIds(users, org.id);
  saveUsers(users);
  res.json({
    ok: true, updated, linked,
    departments: departmentsCount,
    excludedEmails: excludedCount,
    unmatched: [...unmatched].slice(0, 50),
    unknownManagers: [...unknownManagers].slice(0, 50),
  });
});

// Export the org's defined departments as CSV (columns: name, parent).

// Export the org's defined departments as CSV (columns: name, parent).
app.get('/api/admin/departments/export', requireOrgAdminOrSuperAdmin, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const defined = getDepartments(org.id).slice().sort((a, b) => a.name.localeCompare(b.name));
  const rows = [['name', 'parent'], ...defined.map(d => [d.name, d.parentName || ''])];
  const csv = rows.map(r => r.map(csvEsc).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="departments-${org.domain}.csv"`);
  res.send(csv);
});

// Import departments from CSV (columns: name, parent). Replaces the defined list.
app.post('/api/admin/departments/import', requireOrgAdminOrSuperAdmin, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const { csv } = req.body || {};
  if (typeof csv !== 'string' || !csv.trim()) return res.status(400).json({ error: 'Provide CSV content in { csv }.' });

  const rows = parseCsv(csv).filter(r => r.some(c => (c || '').trim() !== ''));
  if (rows.length < 2) return res.status(400).json({ error: 'CSV has no data rows.' });
  const header = rows[0].map(h => h.trim().toLowerCase());
  const nameIdx = header.indexOf('name');
  const parentIdx = header.findIndex(h => h === 'parent' || h === 'parent_name' || h === 'parentname');
  if (nameIdx < 0) return res.status(400).json({ error: 'CSV must have a "name" column header (and optionally "parent").' });

  const raw = rows.slice(1).map(r => ({
    name: (r[nameIdx] || '').trim(),
    parentName: parentIdx >= 0 ? (r[parentIdx] || '').trim() : '',
  })).filter(d => d.name);
  const clean = sanitizeDepartments(raw);
  saveDepartments(org.id, clean);
  res.json({ ok: true, count: clean.length, departments: getDepartments(org.id) });
});

// ============ Review Progress: Release Calendar (Google Sheet) ============

// The "Release Calendar" spreadsheet, read on the signed-in user's behalf via
// the Google Sheets API. Override with RELEASE_CALENDAR_SHEET_ID in .env.
const RELEASE_CALENDAR_SHEET_ID =
  process.env.RELEASE_CALENDAR_SHEET_ID || '1yhX_n--TeRVlrQkCgvvzWDr30BWYkY733vEessSIPw0';

// Exchange a refresh token for a fresh access token. Returns null on failure.
async function refreshGoogleAccessToken(refreshToken) {
  try {
    const body = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.access_token) return null;
    return { accessToken: d.access_token, expiresIn: d.expires_in || 3600 };
  } catch {
    return null;
  }
}

// Resolve a usable Google access token for the current request, refreshing if
// needed. The token lives on the real (non-impersonated) authenticated user.
// Returns null when the user must sign in again to (re)grant access.
async function getGoogleAccessToken(req) {
  const g = req.realUser?.google || req.user?.google;
  if (!g || !g.accessToken) return null;
  const stillValid = !g.expiresAt || g.expiresAt > Date.now() + 60_000;
  if (stillValid) return g.accessToken;
  if (g.refreshToken) {
    const refreshed = await refreshGoogleAccessToken(g.refreshToken);
    if (refreshed) {
      g.accessToken = refreshed.accessToken;
      g.expiresAt = Date.now() + refreshed.expiresIn * 1000;
      // Persist the rotated token back into the session.
      req.session?.save?.(() => {});
      return g.accessToken;
    }
    return null; // refresh failed — force re-auth
  }
  return null; // expired and no refresh token — force re-auth
}

const REAUTH = {
  error: 'google_reauth_required',
  message: 'Reconnect your Google account to grant access to the Release Calendar.',
};

// Pull a short, human-readable message out of a Google API JSON/text error body.
function googleErrorDetail(body) {
  try { const j = JSON.parse(body); return j?.error?.message || j?.error_description || j?.error || ''; }
  catch { return String(body || '').slice(0, 300); }
}

app.get('/api/release-calendar', requireAuth, async (req, res) => {
  const g = req.realUser?.google || req.user?.google;
  const token = await getGoogleAccessToken(req);
  if (!token) return res.status(403).json({ ...REAUTH, reason: 'no_token' });

  // If the granted scope never included spreadsheets, reconnecting to the same
  // consent is the fix — say so explicitly instead of looping silently.
  if (g?.scope && !g.scope.includes('spreadsheets')) {
    return res.status(403).json({
      ...REAUTH,
      reason: 'missing_scope',
      message: 'Your Google sign-in did not include spreadsheet access. Click Reconnect and be sure to approve the "See all your Google Sheets spreadsheets" permission.',
    });
  }

  const sheetId = RELEASE_CALENDAR_SHEET_ID;
  const authHeader = { Authorization: `Bearer ${token}` };
  const readError = async (r, where) => {
    const body = await r.text().catch(() => '');
    const detail = googleErrorDetail(body);
    console.error(`[release-calendar] ${where} failed: HTTP ${r.status} — ${detail}`);
    return detail;
  };
  try {
    // Find the first tab's title so we can read the whole sheet by name.
    const metaR = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=properties.title,sheets.properties(title,index)`,
      { headers: authHeader }
    );
    if (!metaR.ok) {
      const detail = await readError(metaR, 'metadata');
      // 404 from Sheets means "not found OR you don't have access" — Google hides
      // which. For a valid token that's almost always a sharing problem.
      if (metaR.status === 404) {
        return res.status(404).json({ error: 'sheet_not_found', message: 'The Release Calendar was not found, or your Google account does not have access to it. Ask the sheet owner to share it with you (view access).', detail });
      }
      if (metaR.status === 401 || metaR.status === 403) {
        return res.status(403).json({ ...REAUTH, reason: 'sheets_denied', detail });
      }
      return res.status(502).json({ error: 'sheet_fetch_failed', status: metaR.status, detail });
    }
    const meta = await metaR.json();
    const props = (meta.sheets || []).map(s => s.properties).sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0));
    const tab = props[0]?.title || 'Sheet1';

    const valR = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
      { headers: authHeader }
    );
    if (!valR.ok) {
      const detail = await readError(valR, 'values');
      if (valR.status === 401 || valR.status === 403) return res.status(403).json({ ...REAUTH, reason: 'sheets_denied', detail });
      return res.status(502).json({ error: 'sheet_fetch_failed', status: valR.status, detail });
    }
    const val = await valR.json();
    const values = Array.isArray(val.values) ? val.values : [];
    const headers = values[0] || [];
    const rows = values.slice(1).filter(r => r.some(c => String(c ?? '').trim() !== ''));
    res.json({ sheetTitle: meta.properties?.title || '', tab, headers, rows });
  } catch (e) {
    console.error('[release-calendar] unexpected error:', e);
    res.status(502).json({ error: 'sheet_fetch_failed', message: String(e?.message || e) });
  }
});

// Sync the org's user list with the Google Workspace directory, using the
// signed-in admin's token. Admin-only (the Directory API also refuses a
// non-admin token, so this is defence in depth).
app.post('/api/admin/sync-workspace-users', requireOrgAdminOrSuperAdmin, async (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found for your account.' });

  const g = req.realUser?.google || req.user?.google;
  const token = await getGoogleAccessToken(req);
  const reauth = (message) => res.status(403).json({ error: 'google_reauth_required', message });
  if (!token) return reauth('Reconnect your Google account (sign out and back in) to grant Workspace directory access.');
  if (g?.scope && !g.scope.includes('admin.directory')) {
    return reauth('Your Google sign-in did not include Workspace directory access. Sign out and back in to grant it.');
  }

  const authHeader = { Authorization: `Bearer ${token}` };
  try {
    const directoryUsers = [];
    let pageToken = '';
    for (let i = 0; i < 100; i++) { // page cap (~50k users)
      const params = new URLSearchParams({ customer: 'my_customer', maxResults: '500', orderBy: 'email', viewType: 'admin_view', projection: 'full' });
      if (pageToken) params.set('pageToken', pageToken);
      const r = await fetch(`https://admin.googleapis.com/admin/directory/v1/users?${params.toString()}`, { headers: authHeader });
      if (r.status === 401) return reauth('Reconnect your Google account to grant Workspace directory access.');
      if (r.status === 403) {
        const detail = googleErrorDetail(await r.text().catch(() => ''));
        return res.status(403).json({ error: 'not_workspace_admin', message: 'Google refused the directory listing. Syncing users requires a Google Workspace admin account.', detail });
      }
      if (!r.ok) {
        const detail = googleErrorDetail(await r.text().catch(() => ''));
        return res.status(502).json({ error: 'directory_fetch_failed', status: r.status, detail });
      }
      const d = await r.json();
      directoryUsers.push(...(d.users || []));
      pageToken = d.nextPageToken || '';
      if (!pageToken) break;
    }

    // Sync accounts in this org's domain — including suspended ones, so their
    // active status is imported and users who left get marked inactive — minus
    // any emails an admin has excluded from the reporting structure.
    const domain = org.domain;
    const excluded = new Set(getExcludedEmails(org.id));
    const inDomain = directoryUsers.filter(u => (u.primaryEmail || '').split('@')[1]?.toLowerCase() === domain);
    const included = inDomain.filter(u => !excluded.has((u.primaryEmail || '').toLowerCase()));
    const suspended = included.filter(u => u.suspended).length;
    const { added, updated, linked, deactivated } = syncWorkspaceUsers(org.id, domain, included);
    console.log(`[workspace-sync] ${req.user.email}: ${directoryUsers.length} in directory, synced ${included.length} (${added} added, ${updated} updated, ${linked} linked to a manager, ${deactivated} deactivated, ${suspended} suspended)`);

    res.json({
      ok: true,
      totalDirectory: directoryUsers.length,
      synced: included.length,
      added,
      updated,
      linked,
      deactivated,
      suspended,
      skippedOtherDomain: directoryUsers.length - inDomain.length,
      skippedExcluded: inDomain.length - included.length,
      domain,
    });
  } catch (e) {
    console.error('[workspace-sync] error:', e);
    res.status(502).json({ error: 'directory_fetch_failed', message: String(e?.message || e) });
  }
});

// ---- Reporting structure (manager relationships) export/import ----

// Minimal RFC-4180-ish CSV parser (handles quoted fields, commas, newlines).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* ignore */ }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const csvEsc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// Update a user's manager and/or department, writing the change back to the
// Google Workspace directory (and mirroring it locally). Admin-only.
app.patch('/api/admin/workspace-user', requireOrgAdminOrSuperAdmin, async (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const email = (req.body?.email || '').trim().toLowerCase();
  const { managerEmail, department } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  if (managerEmail === undefined && department === undefined) return res.status(400).json({ error: 'Nothing to update' });

  const g = req.realUser?.google || req.user?.google;
  const token = await getGoogleAccessToken(req);
  const reauth = (m) => res.status(403).json({ error: 'google_reauth_required', message: m });
  if (!token) return reauth('Reconnect your Google account (sign out and back in) to grant Workspace directory access.');
  if (g?.scope && !g.scope.includes('admin.directory')) {
    return reauth('Your Google sign-in did not include Workspace directory write access. Sign out and back in to grant it.');
  }
  const bearer = { Authorization: `Bearer ${token}` };
  const userUrl = `https://admin.googleapis.com/admin/directory/v1/users/${encodeURIComponent(email)}`;
  try {
    // Read current relations/organizations so a PATCH doesn't clobber other entries.
    const gr = await fetch(`${userUrl}?projection=full`, { headers: bearer });
    if (gr.status === 401) return reauth('Reconnect your Google account to grant Workspace directory access.');
    if (gr.status === 403) return res.status(403).json({ error: 'not_workspace_admin', message: 'Editing users requires a Google Workspace admin account with write access.', detail: googleErrorDetail(await gr.text().catch(() => '')) });
    if (gr.status === 404) return res.status(404).json({ error: 'user_not_found', message: `${email} was not found in the Workspace directory.` });
    if (!gr.ok) return res.status(502).json({ error: 'directory_fetch_failed', detail: googleErrorDetail(await gr.text().catch(() => '')) });
    const cur = await gr.json();

    const patch = {};
    let normalizedManager;
    if (managerEmail !== undefined) {
      normalizedManager = (managerEmail || '').trim().toLowerCase();
      const rels = (cur.relations || []).filter(r => (r.type || '').toLowerCase() !== 'manager');
      if (normalizedManager) rels.push({ type: 'manager', value: normalizedManager });
      patch.relations = rels;
    }
    if (department !== undefined) {
      const orgs = Array.isArray(cur.organizations) && cur.organizations.length ? cur.organizations.map(o => ({ ...o })) : [{ primary: true }];
      let idx = orgs.findIndex(o => o.primary);
      if (idx < 0) idx = 0;
      if (department) orgs[idx].department = department; else delete orgs[idx].department;
      patch.organizations = orgs;
    }

    const pr = await fetch(userUrl, { method: 'PATCH', headers: { ...bearer, 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (pr.status === 403) return res.status(403).json({ error: 'not_workspace_admin', message: 'Google refused the update. Requires a Workspace admin with write access.', detail: googleErrorDetail(await pr.text().catch(() => '')) });
    if (!pr.ok) return res.status(502).json({ error: 'directory_update_failed', status: pr.status, detail: googleErrorDetail(await pr.text().catch(() => '')) });

    // Mirror locally.
    const users = getUsers();
    const u = users.find(x => x.email?.toLowerCase() === email && x.organizationId === org.id);
    if (u) {
      if (managerEmail !== undefined) u.managerEmail = normalizedManager || undefined;
      if (department !== undefined) u.department = department || undefined;
      resolveManagerIds(users, org.id);
      saveUsers(users);
    }
    console.log(`[workspace-edit] ${req.user.email} updated ${email}: ${JSON.stringify({ managerEmail, department })}`);
    res.json({ ok: true, email, managerEmail: normalizedManager, department, managerId: u?.managerId });
  } catch (e) {
    console.error('[workspace-edit] error:', e);
    res.status(502).json({ error: 'directory_update_failed', message: String(e?.message || e) });
  }
});

// Jira tickets for a set of releases (by Fix Version name). Used by Review
// Progress to list the tickets in the releases that are currently in progress.
// The Jira project whose issues carry the release fixVersions (e.g. M27). This
// is the "DEV" project by default and can differ from the org's configured
// projectKey (which is used for epic creation). Override with env if needed.
const JIRA_RELEASE_PROJECT_KEY = process.env.JIRA_RELEASE_PROJECT_KEY || 'DEV';

app.get('/api/jira/release-tickets', requireAuth, async (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.json({ configured: false });
  const cfg = getJiraConfig(org.id);
  // Only the credentials are required here; the release project is DEV, not the
  // config's projectKey.
  if (!cfg || !cfg.baseUrl || !cfg.email || !cfg.apiToken) {
    return res.json({ configured: false });
  }
  // Project to use: an explicit ?project= (from the picker, persisted), else a
  // saved choice, else the DEV default.
  const explicitProject = (req.query.project || '').toString().trim();
  const projectQuery = explicitProject || cfg.releaseProjectKey || JIRA_RELEASE_PROJECT_KEY;
  const wanted = (req.query.versions || '').toString().split(',').map(s => s.trim()).filter(Boolean);
  if (wanted.length === 0) return res.json({ configured: true, groups: [], unknown: [] });
  const browse = cfg.baseUrl.replace(/\/$/, '');
  try {
    // Verify the credentials first. Jira Cloud returns empty lists / 404s to an
    // unauthenticated caller instead of a clear 401, so a bad token otherwise
    // looks like "no projects found". /myself is the reliable auth check.
    const meR = await jiraFetch(cfg, '/rest/api/3/myself');
    if (meR.status === 401 || meR.status === 403) {
      // 403 (not 401) so the app's global "401 = signed out" interceptor doesn't fire.
      return res.status(403).json({
        error: 'jira_auth_failed',
        message: `Jira rejected the credentials (${meR.status}). The API token for ${cfg.email} is likely invalid or expired — generate a new one and update it under Admin → Jira.`,
      });
    }

    // Resolve the project by key OR name (the sheet/user may give either).
    const { project, projects, tried } = await resolveJiraProject(cfg, projectQuery);
    if (!project) {
      const visible = projects
        .map(p => ({ key: String(p.key), name: String(p.name) }))
        .sort((a, b) => a.key.localeCompare(b.key));
      console.error(`[jira] project "${projectQuery}" not found. ${visible.length} visible. Tried: ${tried.join(' | ')}`);
      return res.status(404).json({
        error: `No Jira project matching "${projectQuery}" is visible to the configured account.`,
        projectNotFound: true,
        projects: visible,
        detail: tried.join(' | '),
      });
    }
    const projectKey = project.key;
    // Remember an explicitly chosen project so we don't ask again.
    if (explicitProject && cfg.releaseProjectKey !== projectKey) {
      saveJiraConfig(org.id, { releaseProjectKey: projectKey });
    }

    // Resolve version names -> ids in the project so an unknown name doesn't make
    // the whole JQL query fail (fixVersion = "missing" is a 400 in Jira).
    const vr = await jiraFetch(cfg, `/rest/api/3/project/${encodeURIComponent(project.id)}/versions`);
    if (!vr.ok) { const t = await vr.text().catch(() => ''); return res.status(vr.status).json({ error: `Jira versions: ${vr.status} ${t.slice(0, 300)}`, project: projectKey }); }
    const allVersions = await vr.json();
    const byName = new Map((Array.isArray(allVersions) ? allVersions : []).map(v => [String(v.name).trim().toLowerCase(), v]));
    const known = wanted.map(name => ({ name, v: byName.get(name.toLowerCase()) })).filter(x => x.v);
    const unknown = wanted.filter(name => !byName.get(name.toLowerCase()));
    if (known.length === 0) return res.json({ configured: true, groups: [], unknown, browse, project: projectKey });

    const spField = await resolveStoryPointsFieldId(cfg, projectKey);
    const jql = `project = "${projectKey}" AND fixVersion in (${known.map(x => x.v.id).join(',')}) ORDER BY status ASC, key ASC`;
    console.log(`[jira] project=${projectKey} storyPointsField=${spField || 'none'} JQL: ${jql}`);
    const fields = ['summary', 'status', 'assignee', 'issuetype', 'fixVersions', 'priority', 'resolutiondate', ...(spField ? [spField] : [])];
    let data;
    let r = await jiraFetch(cfg, '/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql, fields, maxResults: 200 }) });
    if (r.ok) {
      data = await r.json();
    } else {
      r = await jiraFetch(cfg, `/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=${fields.join(',')}&maxResults=200`);
      if (!r.ok) { const t = await r.text().catch(() => ''); return res.status(r.status).json({ error: `Jira search: ${r.status} ${t.slice(0, 300)}`, jql }); }
      data = await r.json();
    }
    const toTicket = (it) => ({
      key: it.key,
      summary: it.fields?.summary || '',
      status: it.fields?.status?.name || '',
      statusCategory: it.fields?.status?.statusCategory?.key || '',
      assignee: it.fields?.assignee?.displayName || 'Unassigned',
      type: it.fields?.issuetype?.name || '',
      url: `${browse}/browse/${it.key}`,
      fixVersions: (it.fields?.fixVersions || []).map(v => v.name),
      storyPoints: spField && it.fields?.[spField] != null ? (Number(it.fields[spField]) || 0) : 0,
      resolved: it.fields?.resolutiondate || null,
    });
    const tickets = (data.issues || []).map(toTicket);
    // Group by requested version (an issue may carry more than one fix version).
    const groups = known.map(({ name, v }) => ({
      version: name,
      tickets: tickets.filter(t => t.fixVersions.includes(v.name)),
    }));
    res.json({ configured: true, groups, unknown, browse, project: projectKey, jql, storyPointsField: spField || null });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Tickets resolved in the last N days (default 7) in the release/engineering
// project. Powers the "Weekly" autonomous action, which reports resolved count +
// summed story points by assignee. Same ticket shape as /release-tickets.
app.get('/api/jira/resolved-recently', requireAuth, async (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.json({ configured: false });
  const cfg = getJiraConfig(org.id);
  if (!cfg || !cfg.baseUrl || !cfg.email || !cfg.apiToken) {
    return res.json({ configured: false });
  }
  const days = Math.max(1, Math.min(90, parseInt((req.query.days || '7').toString(), 10) || 7));
  const explicitProject = (req.query.project || '').toString().trim();
  const projectQuery = explicitProject || cfg.releaseProjectKey || JIRA_RELEASE_PROJECT_KEY;
  const browse = cfg.baseUrl.replace(/\/$/, '');
  try {
    const meR = await jiraFetch(cfg, '/rest/api/3/myself');
    if (meR.status === 401 || meR.status === 403) {
      return res.status(403).json({
        error: 'jira_auth_failed',
        message: `Jira rejected the credentials (${meR.status}). The API token for ${cfg.email} is likely invalid or expired — generate a new one and update it under Admin → Jira.`,
      });
    }
    const { project, projects, tried } = await resolveJiraProject(cfg, projectQuery);
    if (!project) {
      const visible = projects
        .map(p => ({ key: String(p.key), name: String(p.name) }))
        .sort((a, b) => a.key.localeCompare(b.key));
      return res.status(404).json({
        error: `No Jira project matching "${projectQuery}" is visible to the configured account.`,
        projectNotFound: true,
        projects: visible,
        detail: tried.join(' | '),
      });
    }
    const projectKey = project.key;
    if (explicitProject && cfg.releaseProjectKey !== projectKey) {
      saveJiraConfig(org.id, { releaseProjectKey: projectKey });
    }

    const spField = await resolveStoryPointsFieldId(cfg, projectKey);
    const jql = `project = "${projectKey}" AND resolutiondate >= -${days}d ORDER BY resolutiondate DESC`;
    console.log(`[jira] resolved-recently project=${projectKey} days=${days} storyPointsField=${spField || 'none'} JQL: ${jql}`);
    const fields = ['summary', 'status', 'assignee', 'issuetype', 'fixVersions', 'priority', 'resolutiondate', 'parent', ...(spField ? [spField] : [])];
    let data;
    let r = await jiraFetch(cfg, '/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql, fields, maxResults: 200 }) });
    if (r.ok) {
      data = await r.json();
    } else {
      r = await jiraFetch(cfg, `/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=${fields.join(',')}&maxResults=200`);
      if (!r.ok) { const t = await r.text().catch(() => ''); return res.status(r.status).json({ error: `Jira search: ${r.status} ${t.slice(0, 300)}`, jql }); }
      data = await r.json();
    }
    const tickets = (data.issues || []).map((it) => ({
      key: it.key,
      summary: it.fields?.summary || '',
      status: it.fields?.status?.name || '',
      statusCategory: it.fields?.status?.statusCategory?.key || '',
      assignee: it.fields?.assignee?.displayName || 'Unassigned',
      assigneeId: it.fields?.assignee?.accountId || null,
      type: it.fields?.issuetype?.name || '',
      url: `${browse}/browse/${it.key}`,
      fixVersions: (it.fields?.fixVersions || []).map(v => v.name),
      storyPoints: spField && it.fields?.[spField] != null ? (Number(it.fields[spField]) || 0) : 0,
      resolved: it.fields?.resolutiondate || null,
      parentKey: it.fields?.parent?.key || null,
      parentSummary: it.fields?.parent?.fields?.summary || null,
    }));

    // The parent field in search results doesn't carry fix versions — fetch them
    // for the distinct parent issues in one extra search (best-effort).
    const parentKeys = [...new Set(tickets.map(t => t.parentKey).filter(Boolean))];
    const parentFix = new Map();
    if (parentKeys.length) {
      const pjql = `issuekey in (${parentKeys.map(k => `"${k}"`).join(',')})`;
      try {
        let pr = await jiraFetch(cfg, '/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: pjql, fields: ['fixVersions'], maxResults: parentKeys.length }) });
        let pdata = pr.ok ? await pr.json() : null;
        if (!pdata) {
          pr = await jiraFetch(cfg, `/rest/api/3/search?jql=${encodeURIComponent(pjql)}&fields=fixVersions&maxResults=${parentKeys.length}`);
          pdata = pr.ok ? await pr.json() : null;
        }
        for (const pit of (pdata?.issues || [])) parentFix.set(pit.key, (pit.fields?.fixVersions || []).map(v => v.name));
      } catch { /* best-effort */ }
    }
    for (const t of tickets) t.parentFixVersions = t.parentKey ? (parentFix.get(t.parentKey) || []) : [];

    // Attainment is measured on delivery work only — epics are containers and
    // carry no points, matching the by-assignee tables in the report.
    const workItems = tickets.filter(t => !/^epic$/i.test(t.type || ''));
    res.json({
      configured: true, tickets, days, browse, project: projectKey, jql,
      storyPointsField: spField || null,
      attainment: weeklyAttainment(org.id, workItems, days),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.put('/api/admin/plan-stages', requireOrgAdminOrSuperAdmin, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const { stages } = req.body || {};
  if (!Array.isArray(stages)) return res.status(400).json({ error: 'stages must be an array' });
  const clean = [];
  for (const s of stages) {
    const v = String(s).trim();
    if (v && !clean.includes(v)) clean.push(v);
  }
  if (clean.length === 0) return res.status(400).json({ error: 'At least one stage is required' });
  savePlanStages(org.id, clean);
  res.json({ stages: getPlanStages(org.id) });
});

// ============ Lists API Routes ============

// Get all lists for the current user
app.get('/api/users/me/lists', requireAuth, (req, res) => {
  const lists = getUserLists(req.user.email);
  res.json({ lists });
});

// Get shared plans (lists with ownerId+periodId+shared=true) from other users
// in the same organization
app.get('/api/org/shared-plans', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.json({ lists: [] });
  const users = getUsersByOrganization(org.id);
  const callerEmail = req.user.email?.toLowerCase();
  const out = [];
  for (const u of users) {
    if (!u.email || u.email.toLowerCase() === callerEmail) continue;
    const userLists = u.lists || [];
    for (const l of userLists) {
      if (l.shared === true && l.ownerId && l.periodId) {
        out.push({ ...l, createdByEmail: u.email });
      }
    }
  }
  res.json({ lists: out });
});

// Bulk replace all lists (for import)
app.put('/api/users/me/lists', requireAuth, (req, res) => {
  const { lists } = req.body;

  if (!Array.isArray(lists)) {
    return res.status(400).json({ error: 'Lists must be an array' });
  }

  const savedLists = saveUserLists(req.user.email, lists);
  res.json({ lists: savedLists });
});

// Create a new list
app.post('/api/users/me/lists', requireAuth, (req, res) => {
  const { name, color, parentId, ownerId, periodId, level, shared } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'List name is required' });
  }

  const existing = getUserLists(req.user.email);
  if (existing.some(l => l.name === name.trim())) {
    return res.status(409).json({ error: `A list named "${name.trim()}" already exists. Pick a different name.` });
  }

  const now = new Date().toISOString();
  const createOrg = getOrganizationByDomain(req.user.domain);
  const newList = {
    id: generateListId(),
    name: name.trim(),
    color: color || '#6b7280',
    items: [],
    status: getPlanStages(createOrg?.id)[0],
    createdAt: now,
    updatedAt: now,
    ...(parentId ? { parentId } : {}),
    ...(ownerId ? { ownerId } : {}),
    ...(periodId ? { periodId } : {}),
    ...(level ? { level } : {}),
    ...(shared === true ? { shared: true } : {}),
  };

  const lists = getUserLists(req.user.email);
  lists.push(newList);
  const savedLists = saveUserLists(req.user.email, lists);

  res.json({ list: newList, lists: savedLists });
});

// Update a list (rename or change color)
app.put('/api/users/me/lists/:listId', requireAuth, (req, res) => {
  const { listId } = req.params;
  const { name, color, parentId } = req.body;

  const lists = getUserLists(req.user.email);
  const listIndex = lists.findIndex(l => l.id === listId);

  if (listIndex === -1) {
    return res.status(404).json({ error: 'List not found' });
  }

  if (name && name.trim()) {
    lists[listIndex].name = name.trim();
  }
  if (color) {
    lists[listIndex].color = color;
  }
  if ('parentId' in req.body) {
    if (parentId) lists[listIndex].parentId = parentId;
    else delete lists[listIndex].parentId;
  }
  if ('ownerId' in req.body) {
    if (req.body.ownerId) lists[listIndex].ownerId = req.body.ownerId;
    else delete lists[listIndex].ownerId;
  }
  if ('periodId' in req.body) {
    if (req.body.periodId) lists[listIndex].periodId = req.body.periodId;
    else delete lists[listIndex].periodId;
  }
  if ('level' in req.body) {
    if (req.body.level) lists[listIndex].level = req.body.level;
    else delete lists[listIndex].level;
  }
  if ('shared' in req.body) {
    if (req.body.shared === true) lists[listIndex].shared = true;
    else delete lists[listIndex].shared;
  }
  if ('status' in req.body) {
    if (req.body.status) lists[listIndex].status = req.body.status;
    else delete lists[listIndex].status;
  }
  lists[listIndex].updatedAt = new Date().toISOString();

  const savedLists = saveUserLists(req.user.email, lists);
  res.json({ list: lists[listIndex], lists: savedLists });
});

// Delete a list
app.delete('/api/users/me/lists/:listId', requireAuth, (req, res) => {
  const { listId } = req.params;

  const lists = getUserLists(req.user.email);
  const listIndex = lists.findIndex(l => l.id === listId);

  if (listIndex === -1) {
    return res.status(404).json({ error: 'List not found' });
  }

  lists.splice(listIndex, 1);
  const savedLists = saveUserLists(req.user.email, lists);

  res.json({ lists: savedLists });
});

// Add an item to a list
app.post('/api/users/me/lists/:listId/items', requireAuth, (req, res) => {
  const { listId } = req.params;
  const { objectiveId } = req.body;

  if (!objectiveId) {
    return res.status(400).json({ error: 'objectiveId is required' });
  }

  const lists = getUserLists(req.user.email);
  const listIndex = lists.findIndex(l => l.id === listId);

  if (listIndex === -1) {
    return res.status(404).json({ error: 'List not found' });
  }

  // Check if item already exists in list
  if (lists[listIndex].items.some(item => item.objectiveId === objectiveId)) {
    return res.status(409).json({ error: 'Item already exists in list' });
  }

  // Add item with order at the end
  const maxOrder = lists[listIndex].items.length > 0
    ? Math.max(...lists[listIndex].items.map(i => i.order))
    : -1;

  lists[listIndex].items.push({
    objectiveId,
    order: maxOrder + 1,
  });
  lists[listIndex].updatedAt = new Date().toISOString();

  const addActor = listHistoryActor(req);
  pushListHistory(lists[listIndex], {
    userEmail: addActor.email,
    userName: addActor.name,
    action: 'item_added',
    objectiveId,
    objectiveTitle: objectiveTitleById(objectiveId),
    position: lists[listIndex].items.length - 1,
  });

  const savedLists = saveUserLists(req.user.email, lists);
  res.json({ list: lists[listIndex], lists: savedLists });
});

// Remove an item from a list
app.delete('/api/users/me/lists/:listId/items/:objectiveId', requireAuth, (req, res) => {
  const { listId, objectiveId } = req.params;

  const lists = getUserLists(req.user.email);
  const listIndex = lists.findIndex(l => l.id === listId);

  if (listIndex === -1) {
    return res.status(404).json({ error: 'List not found' });
  }

  const itemIndex = lists[listIndex].items.findIndex(i => i.objectiveId === objectiveId);
  if (itemIndex === -1) {
    return res.status(404).json({ error: 'Item not found in list' });
  }

  const removedPosition = listSortedPosition(lists[listIndex].items, objectiveId);
  lists[listIndex].items.splice(itemIndex, 1);
  lists[listIndex].updatedAt = new Date().toISOString();

  const removeActor = listHistoryActor(req);
  pushListHistory(lists[listIndex], {
    userEmail: removeActor.email,
    userName: removeActor.name,
    action: 'item_removed',
    objectiveId,
    objectiveTitle: objectiveTitleById(objectiveId),
    position: removedPosition,
  });

  const savedLists = saveUserLists(req.user.email, lists);
  res.json({ list: lists[listIndex], lists: savedLists });
});

// Reorder items in a list
app.put('/api/users/me/lists/:listId/reorder', requireAuth, (req, res) => {
  const { listId } = req.params;
  const { items, movedObjectiveId } = req.body; // items: [{ objectiveId, order }]

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items array is required' });
  }

  const lists = getUserLists(req.user.email);
  const listIndex = lists.findIndex(l => l.id === listId);

  if (listIndex === -1) {
    return res.status(404).json({ error: 'List not found' });
  }

  // Capture the moved item's old position before re-ordering.
  const fromPosition = movedObjectiveId
    ? listSortedPosition(lists[listIndex].items, movedObjectiveId)
    : -1;

  // Update order for each item
  items.forEach(({ objectiveId, order }) => {
    const item = lists[listIndex].items.find(i => i.objectiveId === objectiveId);
    if (item) {
      item.order = order;
    }
  });

  // Sort by order
  lists[listIndex].items.sort((a, b) => a.order - b.order);
  lists[listIndex].updatedAt = new Date().toISOString();

  if (movedObjectiveId) {
    const toPosition = listSortedPosition(lists[listIndex].items, movedObjectiveId);
    if (fromPosition !== -1 && toPosition !== -1 && fromPosition !== toPosition) {
      const moveActor = listHistoryActor(req);
      pushListHistory(lists[listIndex], {
        userEmail: moveActor.email,
        userName: moveActor.name,
        action: 'item_moved',
        objectiveId: movedObjectiveId,
        objectiveTitle: objectiveTitleById(movedObjectiveId),
        fromPosition,
        toPosition,
      });
    }
  }

  const savedLists = saveUserLists(req.user.email, lists);
  res.json({ list: lists[listIndex], lists: savedLists });
});

// ============ Agent Sessions API Routes ============

app.get('/api/users/me/agent-sessions', requireAuth, (req, res) => {
  res.json({ sessions: getUserAgentSessions(req.user.email) });
});

app.post('/api/users/me/agent-sessions', requireAuth, (req, res) => {
  const { title, transcript, state } = req.body || {};
  const sessions = getUserAgentSessions(req.user.email);
  const now = new Date().toISOString();
  const session = {
    id: `as-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    title: typeof title === 'string' && title.trim() ? title : 'New chat',
    archived: false,
    transcript: Array.isArray(transcript) ? transcript : [],
    state: state && typeof state === 'object' ? state : {},
    createdAt: now,
    updatedAt: now,
  };
  sessions.unshift(session);
  saveUserAgentSessions(req.user.email, sessions);
  res.json({ session });
});

app.put('/api/users/me/agent-sessions/:id', requireAuth, (req, res) => {
  const sessions = getUserAgentSessions(req.user.email);
  const idx = sessions.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Session not found' });
  const { title, transcript, state, archived } = req.body || {};
  if (typeof title === 'string') sessions[idx].title = title;
  if (Array.isArray(transcript)) sessions[idx].transcript = transcript;
  if (state && typeof state === 'object') sessions[idx].state = state;
  if (typeof archived === 'boolean') sessions[idx].archived = archived;
  sessions[idx].updatedAt = new Date().toISOString();
  saveUserAgentSessions(req.user.email, sessions);
  res.json({ session: sessions[idx] });
});

app.delete('/api/users/me/agent-sessions/:id', requireAuth, (req, res) => {
  const sessions = getUserAgentSessions(req.user.email);
  const idx = sessions.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Session not found' });
  sessions.splice(idx, 1);
  saveUserAgentSessions(req.user.email, sessions);
  res.json({ ok: true });
});

// ============ Work Logs API Routes ============

// Get all work logs for the current user
app.get('/api/users/me/worklogs', requireAuth, (req, res) => {
  const workLogs = getUserWorkLogs(req.user.email);
  res.json({ workLogs });
});

// Create a new work log entry
app.post('/api/users/me/worklogs', requireAuth, (req, res) => {
  const { message, startTime, endTime, timeSpentMinutes } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const now = new Date().toISOString();
  const newEntry = {
    id: generateWorkLogId(),
    message: message.trim(),
    createdAt: now,
    startTime: startTime || null,
    endTime: endTime || null,
    timeSpentMinutes: timeSpentMinutes != null ? timeSpentMinutes : null,
  };

  const workLogs = getUserWorkLogs(req.user.email);
  workLogs.push(newEntry);
  const savedWorkLogs = saveUserWorkLogs(req.user.email, workLogs);

  res.json({ entry: newEntry, workLogs: savedWorkLogs });
});

// Update a work log entry
app.put('/api/users/me/worklogs/:entryId', requireAuth, (req, res) => {
  const { entryId } = req.params;
  const { message, startTime, endTime, timeSpentMinutes } = req.body;
  const workLogs = getUserWorkLogs(req.user.email);
  const entryIndex = workLogs.findIndex(e => e.id === entryId);

  if (entryIndex === -1) {
    return res.status(404).json({ error: 'Work log entry not found' });
  }

  if (message !== undefined) workLogs[entryIndex].message = message.trim();
  if (startTime !== undefined) workLogs[entryIndex].startTime = startTime;
  if (endTime !== undefined) workLogs[entryIndex].endTime = endTime;
  if (timeSpentMinutes !== undefined) workLogs[entryIndex].timeSpentMinutes = timeSpentMinutes;

  const savedWorkLogs = saveUserWorkLogs(req.user.email, workLogs);
  res.json({ entry: workLogs[entryIndex], workLogs: savedWorkLogs });
});

// Delete a work log entry
app.delete('/api/users/me/worklogs/:entryId', requireAuth, (req, res) => {
  const { entryId } = req.params;
  const workLogs = getUserWorkLogs(req.user.email);
  const entryIndex = workLogs.findIndex(e => e.id === entryId);

  if (entryIndex === -1) {
    return res.status(404).json({ error: 'Work log entry not found' });
  }

  workLogs.splice(entryIndex, 1);
  const savedWorkLogs = saveUserWorkLogs(req.user.email, workLogs);

  res.json({ workLogs: savedWorkLogs });
});

// ============ Todos API Routes ============

// Get all todos for the current user
app.get('/api/users/me/todos', requireAuth, (req, res) => {
  const todos = getUserTodos(req.user.email);
  res.json({ todos });
});

// Create a new todo
app.post('/api/users/me/todos', requireAuth, (req, res) => {
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const todos = getUserTodos(req.user.email);
  const maxOrder = todos.length > 0 ? Math.max(...todos.map(t => t.order)) : -1;
  const now = new Date().toISOString();
  const newTodo = {
    id: generateTodoId(),
    text: text.trim(),
    objectiveId: req.body.objectiveId || null,
    order: maxOrder + 1,
    createdAt: now,
  };

  todos.push(newTodo);
  const savedTodos = saveUserTodos(req.user.email, todos);

  res.json({ todo: newTodo, todos: savedTodos });
});

// Reorder todos (must be before :todoId route)
app.put('/api/users/me/todos/reorder', requireAuth, (req, res) => {
  const { orderedIds } = req.body;

  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'orderedIds must be an array' });
  }

  const todos = getUserTodos(req.user.email);
  for (let i = 0; i < orderedIds.length; i++) {
    const todo = todos.find(t => t.id === orderedIds[i]);
    if (todo) todo.order = i;
  }

  todos.sort((a, b) => a.order - b.order);
  const savedTodos = saveUserTodos(req.user.email, todos);

  res.json({ todos: savedTodos });
});

// Update a todo
app.put('/api/users/me/todos/:todoId', requireAuth, (req, res) => {
  const { todoId } = req.params;
  const { text } = req.body;
  const todos = getUserTodos(req.user.email);
  const todoIndex = todos.findIndex(t => t.id === todoId);

  if (todoIndex === -1) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  const { objectiveId } = req.body;
  if (text !== undefined) todos[todoIndex].text = text.trim();
  if (objectiveId !== undefined) todos[todoIndex].objectiveId = objectiveId;

  const savedTodos = saveUserTodos(req.user.email, todos);
  res.json({ todo: todos[todoIndex], todos: savedTodos });
});

// Delete a todo
app.delete('/api/users/me/todos/:todoId', requireAuth, (req, res) => {
  const { todoId } = req.params;
  const todos = getUserTodos(req.user.email);
  const todoIndex = todos.findIndex(t => t.id === todoId);

  if (todoIndex === -1) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  todos.splice(todoIndex, 1);
  const savedTodos = saveUserTodos(req.user.email, todos);

  res.json({ todos: savedTodos });
});

app.post('/api/users', requireOrgAdminOrSuperAdmin, (req, res) => {
  const { email, name } = req.body;

  if (!email || !name) {
    return res.status(400).json({ error: 'Email and name are required' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const domain = normalizedEmail.split('@')[1];

  if (!domain) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Check if user already exists
  const existingUsers = getUsers();
  if (existingUsers.some(u => u.email === normalizedEmail)) {
    return res.status(409).json({ error: 'User with this email already exists' });
  }

  // Determine organization based on domain
  let org = getOrganizationByDomain(domain);

  // If super admin, they can create users for any org
  // If org admin, user must be in their org's domain
  if (!isSuperAdmin(req.user.email)) {
    const adminOrg = getOrganizationByDomain(req.user.domain);
    if (!org || org.id !== adminOrg?.id) {
      return res.status(403).json({ error: 'Can only create users for your organization domain' });
    }
  }

  if (!org) {
    return res.status(400).json({ error: 'No organization found for this email domain' });
  }

  const now = new Date().toISOString();
  const newUser = {
    id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    email: normalizedEmail,
    name: name.trim(),
    domain,
    organizationId: org.id,
    role: 'user',
    createdAt: now,
    lastLoginAt: now,
  };

  const users = getUsers();
  users.push(newUser);
  saveUsers(users);

  res.json({
    user: {
      ...newUser,
      organizationName: org.name,
    }
  });
});

// ============ OKR Data API Routes ============

// Get all OKR data for the user's organization
app.get('/api/okr-data', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.json({ objectives: [], keyResults: [], teams: [], periods: [], tags: [] });
  }

  const data = getOKRData();
  const orgId = org.id;

  // Filter data by organization. Private objectives (shared === false) are
  // visible only to creator, owner, assignee, or admins.
  const userEmail = req.user.email;
  const isAdmin = org.admins.some(a => a.email === userEmail);
  const users = getUsers();
  const me = users.find(u => u.email === userEmail);
  const myUserId = me?.id;
  const canSeeObjective = (o) => {
    if (o.shared !== false) return true;
    if (isAdmin) return true;
    if (o.createdBy === userEmail) return true;
    if (myUserId && (o.ownerId === myUserId || o.assigneeId === myUserId)) return true;
    return false;
  };
  res.json({
    objectives: data.objectives.filter(o => o.orgId === orgId && canSeeObjective(o)),
    keyResults: data.keyResults.filter(kr => kr.orgId === orgId),
    teams: data.teams.filter(t => t.orgId === orgId),
    periods: data.periods.filter(p => p.orgId === orgId),
    tags: data.tags.filter(t => t.orgId === orgId),
  });
});

// Objectives
app.post('/api/objectives', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.status(403).json({ error: 'No organization found' });
  }

  const data = getOKRData();
  const now = new Date().toISOString();

  const newObjective = {
    ...req.body,
    id: generateId(),
    orgId: org.id,
    createdBy: req.user.email,
    progress: 0,
    status: 'behind',
    workflowStatus: req.body.workflowStatus || 'todo',
    createdAt: now,
    updatedAt: now,
  };

  data.objectives.push(newObjective);
  saveOKRData(data);
  res.json(newObjective);
});

app.put('/api/objectives/:id', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.status(403).json({ error: 'No organization found' });
  }

  const data = getOKRData();
  const index = data.objectives.findIndex(o => o.id === req.params.id && o.orgId === org.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Objective not found' });
  }

  data.objectives[index] = {
    ...data.objectives[index],
    ...req.body,
    updatedAt: new Date().toISOString(),
  };

  saveOKRData(data);
  res.json(data.objectives[index]);
});

app.delete('/api/objectives/:id', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.status(403).json({ error: 'No organization found' });
  }

  const data = getOKRData();
  const index = data.objectives.findIndex(o => o.id === req.params.id && o.orgId === org.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Objective not found' });
  }

  // Only the creator or an org/super admin can delete an objective.
  const callerEmail = req.user.email?.toLowerCase();
  const isOrgAdminUser = org.admins?.some(a => a.email === callerEmail && a.status === 'accepted');
  const isSuperAdminUser = isSuperAdmin(req.user.email);
  const objective = data.objectives[index];
  if (!isOrgAdminUser && !isSuperAdminUser && objective.createdBy?.toLowerCase() !== callerEmail) {
    return res.status(403).json({ error: 'Only the creator or an admin can delete this objective.' });
  }

  // Also delete associated key results
  data.keyResults = data.keyResults.filter(kr => kr.objectiveId !== req.params.id);
  data.objectives.splice(index, 1);

  saveOKRData(data);
  res.json({ success: true });
});

// Key Results
app.post('/api/key-results', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.status(403).json({ error: 'No organization found' });
  }

  const data = getOKRData();
  const now = new Date().toISOString();

  const newKeyResult = {
    ...req.body,
    id: generateId(),
    orgId: org.id,
    createdBy: req.user.email,
    createdAt: now,
    updatedAt: now,
  };

  data.keyResults.push(newKeyResult);
  saveOKRData(data);
  res.json(newKeyResult);
});

app.put('/api/key-results/:id', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.status(403).json({ error: 'No organization found' });
  }

  const data = getOKRData();
  const index = data.keyResults.findIndex(kr => kr.id === req.params.id && kr.orgId === org.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Key result not found' });
  }

  data.keyResults[index] = {
    ...data.keyResults[index],
    ...req.body,
    updatedAt: new Date().toISOString(),
  };

  saveOKRData(data);
  res.json(data.keyResults[index]);
});

app.delete('/api/key-results/:id', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.status(403).json({ error: 'No organization found' });
  }

  const data = getOKRData();
  const index = data.keyResults.findIndex(kr => kr.id === req.params.id && kr.orgId === org.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Key result not found' });
  }

  data.keyResults.splice(index, 1);
  saveOKRData(data);
  res.json({ success: true });
});

// Teams
app.post('/api/teams', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.status(403).json({ error: 'No organization found' });
  }

  const data = getOKRData();

  const newTeam = {
    ...req.body,
    id: generateId(),
    orgId: org.id,
    createdBy: req.user.email,
  };
  // Self (individual contributor) teams cannot have other members.
  if (newTeam.type === 'self') newTeam.memberEmails = [];

  data.teams.push(newTeam);
  saveOKRData(data);
  res.json(newTeam);
});

app.put('/api/teams/:id', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.status(403).json({ error: 'No organization found' });
  }

  const data = getOKRData();
  const index = data.teams.findIndex(t => t.id === req.params.id && t.orgId === org.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Team not found' });
  }

  data.teams[index] = { ...data.teams[index], ...req.body };
  // Self (individual contributor) teams cannot have other members.
  if (data.teams[index].type === 'self') data.teams[index].memberEmails = [];
  saveOKRData(data);
  res.json(data.teams[index]);
});

app.delete('/api/teams/:id', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.status(403).json({ error: 'No organization found' });
  }

  const data = getOKRData();
  const index = data.teams.findIndex(t => t.id === req.params.id && t.orgId === org.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Team not found' });
  }

  data.teams.splice(index, 1);
  saveOKRData(data);
  res.json({ success: true });
});

// Team Assignments (per-organization): who is assigned to which team, at what
// weekly story-point capacity, over a date range.
app.get('/api/assignments', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.json({ assignments: [] });
  const data = getOKRData();
  const assignments = (data.assignments || []).filter(a => a.orgId === org.id);
  res.json({ assignments });
});

app.post('/api/assignments', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const { who, teamId, isSelf, capacitySpPerWeek, startDate, endDate } = req.body || {};
  if (!who || !startDate || (!isSelf && !teamId)) {
    return res.status(400).json({ error: 'who, startDate, and either a team or isSelf are required' });
  }
  const data = getOKRData();
  data.assignments = data.assignments || [];
  const now = new Date().toISOString();
  const assignment = {
    id: generateId(),
    orgId: org.id,
    who,
    teamId: isSelf ? '' : teamId,
    isSelf: !!isSelf,
    capacitySpPerWeek: Number(capacitySpPerWeek) || 0,
    startDate,
    endDate: endDate || undefined,
    createdBy: req.user.email,
    createdAt: now,
    updatedAt: now,
  };
  data.assignments.push(assignment);
  saveOKRData(data);
  res.json(assignment);
});

app.put('/api/assignments/:id', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const data = getOKRData();
  data.assignments = data.assignments || [];
  const idx = data.assignments.findIndex(a => a.id === req.params.id && a.orgId === org.id);
  if (idx === -1) return res.status(404).json({ error: 'Assignment not found' });
  const { who, teamId, isSelf, capacitySpPerWeek, startDate, endDate } = req.body || {};
  const next = { ...data.assignments[idx] };
  if (typeof who === 'string' && who) next.who = who;
  if (typeof isSelf === 'boolean') next.isSelf = isSelf;
  if (typeof teamId === 'string') next.teamId = teamId;
  if (next.isSelf) next.teamId = '';
  if (capacitySpPerWeek !== undefined) next.capacitySpPerWeek = Number(capacitySpPerWeek) || 0;
  if (typeof startDate === 'string' && startDate) next.startDate = startDate;
  if ('endDate' in (req.body || {})) next.endDate = endDate || undefined;
  next.updatedAt = new Date().toISOString();
  data.assignments[idx] = next;
  saveOKRData(data);
  res.json(next);
});

app.delete('/api/assignments/:id', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) return res.status(403).json({ error: 'No organization found' });
  const data = getOKRData();
  data.assignments = data.assignments || [];
  const idx = data.assignments.findIndex(a => a.id === req.params.id && a.orgId === org.id);
  if (idx === -1) return res.status(404).json({ error: 'Assignment not found' });
  data.assignments.splice(idx, 1);
  saveOKRData(data);
  res.json({ success: true });
});

// Periods
app.post('/api/periods', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.status(403).json({ error: 'No organization found' });
  }

  const data = getOKRData();

  const newPeriod = {
    ...req.body,
    id: generateId(),
    orgId: org.id,
    createdBy: req.user.email,
  };

  data.periods.push(newPeriod);
  saveOKRData(data);
  res.json(newPeriod);
});

app.put('/api/periods/:id', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.status(403).json({ error: 'No organization found' });
  }

  const data = getOKRData();
  const index = data.periods.findIndex(p => p.id === req.params.id && p.orgId === org.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Period not found' });
  }

  data.periods[index] = { ...data.periods[index], ...req.body };
  saveOKRData(data);
  res.json(data.periods[index]);
});

app.delete('/api/periods/:id', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.status(403).json({ error: 'No organization found' });
  }

  const data = getOKRData();
  const index = data.periods.findIndex(p => p.id === req.params.id && p.orgId === org.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Period not found' });
  }

  data.periods.splice(index, 1);
  saveOKRData(data);
  res.json({ success: true });
});

// Tags
app.post('/api/tags', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.status(403).json({ error: 'No organization found' });
  }

  const data = getOKRData();

  const newTag = {
    ...req.body,
    id: generateId(),
    orgId: org.id,
    createdBy: req.user.email,
  };

  data.tags.push(newTag);
  saveOKRData(data);
  res.json(newTag);
});

app.put('/api/tags/:id', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.status(403).json({ error: 'No organization found' });
  }

  const data = getOKRData();
  const index = data.tags.findIndex(t => t.id === req.params.id && t.orgId === org.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Tag not found' });
  }

  data.tags[index] = { ...data.tags[index], ...req.body };
  saveOKRData(data);
  res.json(data.tags[index]);
});

app.delete('/api/tags/:id', requireAuth, (req, res) => {
  const org = getOrganizationByDomain(req.user.domain);
  if (!org) {
    return res.status(403).json({ error: 'No organization found' });
  }

  const data = getOKRData();
  const index = data.tags.findIndex(t => t.id === req.params.id && t.orgId === org.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Tag not found' });
  }

  data.tags.splice(index, 1);
  saveOKRData(data);
  res.json({ success: true });
});

// Bulk import for backup restore (super admin only)
app.post('/api/import/okr', requireSuperAdmin, (req, res) => {
  try {
    const { objectives, keyResults, teams, periods, tags } = req.body;
    const org = getOrganizationByDomain(req.user.domain);

    if (!org) {
      return res.status(403).json({ error: 'No organization found for your domain' });
    }

    const data = getOKRData();
    const orgId = org.id;

    // Remove existing data for this organization
    data.objectives = data.objectives.filter(o => o.orgId !== orgId);
    data.keyResults = data.keyResults.filter(kr => kr.orgId !== orgId);
    data.teams = data.teams.filter(t => t.orgId !== orgId);
    data.periods = data.periods.filter(p => p.orgId !== orgId);
    data.tags = data.tags.filter(t => t.orgId !== orgId);

    // Add imported data with correct orgId
    if (Array.isArray(objectives)) {
      data.objectives.push(...objectives.map(o => ({ ...o, orgId })));
    }
    if (Array.isArray(keyResults)) {
      data.keyResults.push(...keyResults.map(kr => ({ ...kr, orgId })));
    }
    if (Array.isArray(teams)) {
      data.teams.push(...teams.map(t => ({ ...t, orgId })));
    }
    if (Array.isArray(periods)) {
      data.periods.push(...periods.map(p => ({ ...p, orgId })));
    }
    if (Array.isArray(tags)) {
      data.tags.push(...tags.map(t => ({ ...t, orgId })));
    }

    saveOKRData(data);

    res.json({
      success: true,
      imported: {
        objectives: objectives?.length || 0,
        keyResults: keyResults?.length || 0,
        teams: teams?.length || 0,
        periods: periods?.length || 0,
        tags: tags?.length || 0,
      }
    });
  } catch (err) {
    console.error('Import OKR error:', err);
    res.status(500).json({ error: 'Failed to import: ' + err.message });
  }
});

app.post('/api/import/users', requireSuperAdmin, (req, res) => {
  const { users } = req.body;

  if (!Array.isArray(users)) {
    return res.status(400).json({ error: 'Users array is required' });
  }

  const existingUsers = getUsers();
  const existingEmails = new Set(existingUsers.map(u => u.email));
  let imported = 0;
  let skipped = 0;

  for (const user of users) {
    if (!user.email || existingEmails.has(user.email)) {
      skipped++;
      continue;
    }

    existingUsers.push({
      id: user.id || `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      email: user.email,
      name: user.name || user.email.split('@')[0],
      picture: user.picture,
      domain: user.domain || user.email.split('@')[1],
      organizationId: user.organizationId,
      role: user.role || 'user',
      createdAt: user.createdAt || new Date().toISOString(),
      lastLoginAt: user.lastLoginAt || new Date().toISOString(),
    });
    existingEmails.add(user.email);
    imported++;
  }

  saveUsers(existingUsers);
  res.json({ success: true, imported, skipped, total: existingUsers.length });
});

app.post('/api/import/organizations', requireSuperAdmin, (req, res) => {
  const { organizations } = req.body;

  if (!Array.isArray(organizations)) {
    return res.status(400).json({ error: 'Organizations array is required' });
  }

  const existingOrgs = getOrganizations();
  const existingDomains = new Set(existingOrgs.map(o => o.domain));
  const existingIds = new Set(existingOrgs.map(o => o.id));
  let imported = 0;
  let skipped = 0;

  for (const org of organizations) {
    // Skip if domain or ID already exists
    if (!org.domain || existingDomains.has(org.domain) || existingIds.has(org.id)) {
      skipped++;
      continue;
    }

    const now = new Date().toISOString();
    existingOrgs.push({
      id: org.id || `org-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: org.name,
      domain: org.domain,
      admins: (org.admins || []).map(a => ({
        email: a.email,
        inviteToken: generateInviteToken(),
        inviteCreatedAt: now,
        status: a.status || 'pending',
        ...(a.status === 'accepted' ? { acceptedAt: now } : {}),
      })),
      createdAt: org.createdAt || now,
      updatedAt: now,
    });
    existingDomains.add(org.domain);
    existingIds.add(org.id);
    imported++;

    // Also add domain to allowed domains
    const allowedDomains = getAllowedDomains();
    if (!allowedDomains.includes(org.domain) && !ALWAYS_ALLOWED_DOMAINS.includes(org.domain)) {
      allowedDomains.push(org.domain);
      saveAllowedDomains(allowedDomains);
    }
  }

  saveOrganizations(existingOrgs);
  res.json({ success: true, imported, skipped, total: existingOrgs.length });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Make sure to set up your .env file with Google OAuth credentials');
});
