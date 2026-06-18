import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { api, setCsrf, clearCsrf } from '../api';
import type { Lang } from '../i18n';

export interface Account {
  id: number;
  login_id: string;
  email: string;
  phone: string;
  address: string;
  name: string;
  exocad_id: string;
  language: Lang;
  status: string;
  created_at: string;
}

interface AuthContextType {
  account: Account | null;
  lang: Lang;
  loading: boolean;
  setLang: (lang: Lang) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState<Lang>('ko');
  // Holds a lang the user explicitly selected before logging in
  const pendingLang = useRef<Lang | null>(null);

  async function refresh() {
    try {
      const data = await api.get<Account & { csrf_token: string }>('/auth/me');
      setCsrf(data.csrf_token);
      setAccount(data);
      if (pendingLang.current !== null) {
        // User chose a language before login — apply it and sync to server
        api.patch('/profile/language', { language: pendingLang.current }).catch(() => {});
        pendingLang.current = null;
      } else {
        setLangState(data.language || 'ko');
      }
    } catch {
      clearCsrf();
      setAccount(null);
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function logout() {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    clearCsrf();
    setAccount(null);
    pendingLang.current = null;
  }

  function setLang(l: Lang) {
    setLangState(l);
    if (account) {
      api.patch('/profile/language', { language: l }).catch(() => {});
    } else {
      pendingLang.current = l;
    }
  }

  return (
    <AuthContext.Provider value={{ account, lang, loading, setLang, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
