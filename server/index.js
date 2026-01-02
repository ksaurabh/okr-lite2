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

// Initialize domains file if it doesn't exist
if (!existsSync(DOMAINS_FILE)) {
  writeFileSync(DOMAINS_FILE, JSON.stringify({ domains: [] }, null, 2));
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
  res.json({
    authenticated: true,
    allowed: isAllowed,
    user: req.user,
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Make sure to set up your .env file with Google OAuth credentials');
});
