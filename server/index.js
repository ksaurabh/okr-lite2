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
}, (accessToken, refreshToken, profile, done) => {
  const email = profile.emails?.[0]?.value;
  const user = {
    id: profile.id,
    email,
    name: profile.displayName,
    picture: profile.photos?.[0]?.value,
    domain: email?.split('@')[1]?.toLowerCase(),
  };
  return done(null, user);
}));

// Auth routes
app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
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

  res.json({
    authenticated: true,
    allowed: isAllowed,
    user: {
      ...req.user,
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
      ...(init.headers || {}),
    },
  });
  return res;
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
  const { baseUrl, email, apiToken, projectKey, epicIssueTypeId, periodFieldKey, periodValueMap } = req.body || {};
  const existing = getJiraConfig(org.id) || {};
  const next = { ...existing };
  if (typeof baseUrl === 'string') next.baseUrl = baseUrl.trim();
  if (typeof email === 'string') next.email = email.trim();
  if (typeof apiToken === 'string' && apiToken.trim()) next.apiToken = apiToken.trim();
  if (typeof projectKey === 'string') next.projectKey = projectKey.trim();
  if (typeof epicIssueTypeId === 'string') next.epicIssueTypeId = epicIssueTypeId.trim();
  if (typeof periodFieldKey === 'string') next.periodFieldKey = periodFieldKey.trim() || undefined;
  if (periodValueMap && typeof periodValueMap === 'object') next.periodValueMap = periodValueMap;
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
