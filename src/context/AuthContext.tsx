import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  domain: string;
}

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  isAllowed: boolean;
  user: User | null;
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
  });

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/auth/user`, {
        credentials: 'include',
      });
      const data = await response.json();

      setState({
        isLoading: false,
        isAuthenticated: data.authenticated,
        isAllowed: data.allowed || false,
        user: data.user || null,
      });
    } catch (error) {
      console.error('Auth check failed:', error);
      setState({
        isLoading: false,
        isAuthenticated: false,
        isAllowed: false,
        user: null,
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
