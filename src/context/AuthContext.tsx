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

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  isAllowed: boolean;
  user: User | null;
  isSuperAdmin: boolean;
  isOrgAdmin: boolean;
  organization: Organization | null;
}

interface AuthContextType extends AuthState {
  login: () => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    isAllowed: false,
    user: null,
    isSuperAdmin: false,
    isOrgAdmin: false,
    organization: null,
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
      });
    };
    const wrapped: typeof window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
      try {
        const res = await origFetch(input, init);
        if (isOurApi(url) && res.status === 401) {
          // Don't sign out on the auth-check endpoint itself — its 401 just
          // means "not signed in yet"; checkAuth handles that path already.
          if (!url.includes('/auth/user')) triggerSignOut(`401 from ${url}`);
        }
        return res;
      } catch (err) {
        if (isOurApi(url)) triggerSignOut(`network error on ${url}: ${String(err)}`);
        throw err;
      }
    };
    window.fetch = wrapped;
    return () => { window.fetch = origFetch; };
  }, []);

  const login = () => {
    window.location.href = `${API_URL}/auth/google`;
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
      });
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout, checkAuth }}>
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
