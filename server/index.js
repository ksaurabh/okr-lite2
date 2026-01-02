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
const PORT = process.env.PORT || 3001;
const DOMAINS_FILE = join(__dirname, 'allowed-domains.json');
const ORGANIZATIONS_FILE = join(__dirname, 'organizations.json');
const SUPER_ADMINS_FILE = join(__dirname, 'super-admins.json');
const USERS_FILE = join(__dirname, 'users.json');

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
app.use(express.json());
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Make sure to set up your .env file with Google OAuth credentials');
});
