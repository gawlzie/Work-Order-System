import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setUnauthorizedHandler, tokenStore } from './api';
import type { User } from './types';

interface Auth {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  can: (action: 'create' | 'update' | 'delete' | 'approve' | 'progress') => boolean;
}

const Ctx = createContext<Auth | null>(null);

const PERMISSIONS: Record<string, User['role'][]> = {
  create: ['admin', 'mechanic'],
  update: ['admin'],
  delete: ['admin'],
  approve: ['admin'],
  progress: ['admin', 'mechanic'],
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => !!tokenStore.get());

  const logout = () => {
    tokenStore.set(null);
    setUser(null);
    qc.clear();
  };

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) return;
    api<User>('/auth/profile')
      .then(setUser)
      .catch(() => tokenStore.set(null))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (username: string, password: string) => {
    const res = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { username, password } });
    tokenStore.set(res.token);
    setUser(res.user);
  };

  const can: Auth['can'] = (action) => !!user && PERMISSIONS[action].includes(user.role);

  return <Ctx.Provider value={{ user, loading, login, logout, can }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
