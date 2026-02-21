/**
 * Auth Context — NO-AUTH STUB
 * Always returns isAuthenticated: true so no login is ever required.
 */

import React, { createContext, useContext, useCallback } from 'react';
import type { AuthUser } from '../api-types';

const GUEST_USER: AuthUser = {
  id: 'local-user',
  email: 'local@vibecode.dev',
  name: 'Local User',
  avatar: undefined,
  isAnonymous: false,
};

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  session: null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  authProviders: { google: boolean; github: boolean; email: boolean } | null;
  hasOAuth: boolean;
  requiresEmailAuth: boolean;
  login: (provider: 'google' | 'github', redirectUrl?: string) => void;
  loginWithEmail: (credentials: { email: string; password: string }) => Promise<void>;
  register: (data: { email: string; password: string; name?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  clearError: () => void;
  setIntendedUrl: (url: string) => void;
  getIntendedUrl: () => string | null;
  clearIntendedUrl: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const noop = useCallback(() => { }, []);
  const noopAsync = useCallback(async () => { }, []);

  const value: AuthContextType = {
    user: GUEST_USER,
    token: null,
    session: null,
    isAuthenticated: true,
    isLoading: false,
    error: null,
    authProviders: { google: false, github: false, email: false },
    hasOAuth: false,
    requiresEmailAuth: false,
    login: noop,
    loginWithEmail: noopAsync,
    register: noopAsync,
    logout: noopAsync,
    refreshUser: noopAsync,
    clearError: noop,
    setIntendedUrl: noop,
    getIntendedUrl: () => null,
    clearIntendedUrl: noop,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function useRequireAuth(_redirectTo = '/') {
  return { isAuthenticated: true, isLoading: false };
}
