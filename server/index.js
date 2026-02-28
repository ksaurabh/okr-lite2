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
    // Update existing user
    users[existingIndex] = {
      ...users[existingIndex],
      name: userData.name,
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

  // Track user login
  if (isAllowed && org) {
    upsertUser({
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
      organizationId: org?.id || null,
    },
    isSuperAdmin: isSuperAdminUser,
    isOrgAdmin: isOrgAdminUser,
    organization: org || null,
  });
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

app.get('/api/users', requireOrgAdminOrSuperAdmin, (req, res) => {
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

app.put('/api/users/:email/name', requireOrgAdminOrSuperAdmin, (req, res) => {
  const { email } = req.params;
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
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

// ============ Lists API Routes ============

// Get all lists for the current user
app.get('/api/users/me/lists', requireAuth, (req, res) => {
  const lists = getUserLists(req.user.email);
  res.json({ lists });
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
  const { name, color } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'List name is required' });
  }

  const now = new Date().toISOString();
  const newList = {
    id: generateListId(),
    name: name.trim(),
    color: color || '#6b7280',
    items: [],
    createdAt: now,
    updatedAt: now,
  };

  const lists = getUserLists(req.user.email);
  lists.push(newList);
  const savedLists = saveUserLists(req.user.email, lists);

  res.json({ list: newList, lists: savedLists });
});

// Update a list (rename or change color)
app.put('/api/users/me/lists/:listId', requireAuth, (req, res) => {
  const { listId } = req.params;
  const { name, color } = req.body;

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

  lists[listIndex].items.splice(itemIndex, 1);
  lists[listIndex].updatedAt = new Date().toISOString();

  const savedLists = saveUserLists(req.user.email, lists);
  res.json({ list: lists[listIndex], lists: savedLists });
});

// Reorder items in a list
app.put('/api/users/me/lists/:listId/reorder', requireAuth, (req, res) => {
  const { listId } = req.params;
  const { items } = req.body; // Array of { objectiveId, order }

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items array is required' });
  }

  const lists = getUserLists(req.user.email);
  const listIndex = lists.findIndex(l => l.id === listId);

  if (listIndex === -1) {
    return res.status(404).json({ error: 'List not found' });
  }

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

  const savedLists = saveUserLists(req.user.email, lists);
  res.json({ list: lists[listIndex], lists: savedLists });
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

  if (text !== undefined) todos[todoIndex].text = text.trim();

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

  // Filter data by organization
  res.json({
    objectives: data.objectives.filter(o => o.orgId === orgId),
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
