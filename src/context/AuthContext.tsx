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
