import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Organization } from '../types';

const API_URL = import.meta.env.VITE_API_URL || '';

interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  domain: string;
  organizationId?: string;
}

interface Impersonation {
  email: string;
  name: string;
}

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  isAllowed: boolean;
  user: User | null;
  isSuperAdmin: boolean;
  isOrgAdmin: boolean;
  organization: Organization | null;
  impersonating: Impersonation | null;
}

interface AuthContextType extends AuthState {
  login: () => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  impersonate: (email: string) => Promise<void>;
  stopImpersonating: () => Promise<void>;
  serverReachable: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [serverReachable, setServerReachable] = useState(true);
  const [state, setState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    isAllowed: false,
    user: null,
    isSuperAdmin: false,
    isOrgAdmin: false,
    organization: null,
    impersonating: null,
  });

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/auth/user`, {
        credentials: 'include',
      });
      const data = await response.json();

      // Legacy: filters used to be cached in localStorage. They are now
      // server-side under user preferences. Wipe any stale local copy.
      try {
        localStorage.removeItem('okr-lite-filters');
        localStorage.removeItem('okr-lite-filter-owner');
      } catch { /* ignore */ }

      setState({
        isLoading: false,
        isAuthenticated: data.authenticated,
        isAllowed: data.allowed || false,
        user: data.user || null,
        isSuperAdmin: data.isSuperAdmin || false,
        isOrgAdmin: data.isOrgAdmin || false,
        organization: data.organization || null,
        impersonating: data.impersonating || null,
      });
    } catch (error) {
      console.error('Auth check failed:', error);
      setState({
        isLoading: false,
        isAuthenticated: false,
        isAllowed: false,
        user: null,
        isSuperAdmin: false,
        isOrgAdmin: false,
        organization: null,
        impersonating: null,
      });
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Detect lost connection or expired session: install a global fetch wrapper
  // that watches for 401s and network failures on our API URL, then logs out.
  useEffect(() => {
    const origFetch = window.fetch.bind(window);
    let signedOut = false;
    const apiBase = API_URL || window.location.origin;
    const isOurApi = (url: string) => {
      if (!url) return false;
      if (apiBase && url.startsWith(apiBase)) return true;
      // Relative URLs from this app's origin
      if (url.startsWith('/api') || url.startsWith('/auth')) return true;
      return false;
    };
    const triggerSignOut = (reason: string) => {
      if (signedOut) return;
      signedOut = true;
      console.warn('Auth lost — signing out:', reason);
      setState({
        isLoading: false,
        isAuthenticated: false,
        isAllowed: false,
        user: null,
        isSuperAdmin: false,
        isOrgAdmin: false,
        organization: null,
        impersonating: null,
      });
    };
    const wrapped: typeof window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
      try {
        const res = await origFetch(input, init);
        if (isOurApi(url)) {
          if (res.status === 401) {
            // Don't sign out on the auth-check endpoint itself — its 401 just
            // means "not signed in yet"; checkAuth handles that path already.
            if (!url.includes('/auth/user')) triggerSignOut(`401 from ${url}`);
          } else {
            // Reachable
            setServerReachable(prev => prev ? prev : true);
          }
        }
        return res;
      } catch (err) {
        if (isOurApi(url)) {
          setServerReachable(false);
        }
        throw err;
      }
    };
    window.fetch = wrapped;
    return () => { window.fetch = origFetch; };
  }, []);

  // When server is unreachable, poll periodically to detect recovery.
  useEffect(() => {
    if (serverReachable) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/auth/user`, { credentials: 'include' });
        if (res.status < 500) setServerReachable(true);
      } catch { /* still down */ }
    }, 5000);
    return () => clearInterval(id);
  }, [serverReachable]);

  const login = () => {
    window.location.href = `${API_URL}/auth/google`;
  };

  // Switching the effective user changes every scoped query in the app, so the
  // simplest correct way to re-render as that user is a full reload — the app
  // then re-fetches all data fresh as the impersonated (or restored) identity.
  const impersonate = async (email: string) => {
    const res = await fetch(`${API_URL}/api/super-admin/impersonate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to impersonate' }));
      throw new Error(err.error || 'Failed to impersonate');
    }
    window.location.reload();
  };

  const stopImpersonating = async () => {
    await fetch(`${API_URL}/api/super-admin/stop-impersonating`, {
      method: 'POST',
      credentials: 'include',
    });
    window.location.reload();
  };

  const logout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        credentials: 'include',
      });
      setState({
        isLoading: false,
        isAuthenticated: false,
        isAllowed: false,
        user: null,
        isSuperAdmin: false,
        isOrgAdmin: false,
        organization: null,
        impersonating: null,
      });
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout, checkAuth, impersonate, stopImpersonating, serverReachable }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
