// AuthModalProvider — no-auth stub, never shows login modal
import React, { createContext, useContext, useCallback } from 'react';

interface AuthModalContextType {
  showAuthModal: (context?: string, onSuccess?: () => void, intendedUrl?: string) => void;
  hideAuthModal: () => void;
  isAuthModalOpen: boolean;
}

const AuthModalContext = createContext<AuthModalContextType | undefined>(undefined);

export function useAuthModal() {
  const context = useContext(AuthModalContext);
  if (context === undefined) {
    throw new Error('useAuthModal must be used within an AuthModalProvider');
  }
  return context;
}

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const noop = useCallback(() => { }, []);
  const value: AuthModalContextType = {
    showAuthModal: noop,
    hideAuthModal: noop,
    isAuthModalOpen: false,
  };
  return <AuthModalContext.Provider value={value}>{children}</AuthModalContext.Provider>;
}
