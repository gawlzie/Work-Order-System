import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setUnauthorizedHandler, tokenStore } from './api';
import { clearCache, flush, startSync } from './offline';
import type { Permission, User } from './types';

interface Auth {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  can: (permission: Permission) => boolean;
  /** Re-reads the profile, e.g. after the user's own role permissions changed. */
  refresh: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);

/** The signed-in user, also kept on the phone so the app opens without signal. */
const USER_KEY = 'wos-user';
export function cachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw && tokenStore.get() ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}
const keepUser = (u: User | null) => {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* storage unavailable */
  }
};
let current: User | null = null;
let syncing = false;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // Offline start: the user kept on the phone, refreshed from the server when there is signal.
  const [user, setUserState] = useState<User | null>(() => (current = cachedUser()));
  const [loading, setLoading] = useState(() => !!tokenStore.get() && !current);
  const setUser = (u: User | null) => {
    current = u;
    keepUser(u);
    setUserState(u);
  };

  /** Ends the session. Unsent offline actions stay on the phone and are sent after the next login. */
  const logout = () => {
    tokenStore.set(null);
    setUser(null);
    void clearCache();
    qc.clear();
  };

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) return;
    api<User>('/auth/profile')
      .then(setUser)
      .catch((err) => {
        // Only a refused login ends the session; no signal keeps the offline user.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) logout();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sends this phone's outbox whenever someone is signed in.
  useEffect(() => {
    if (!user) return;
    if (!syncing) {
      syncing = true;
      startSync(qc, () => current);
    } else void flush();
  }, [user, qc]);

  const login = async (username: string, password: string) => {
    const res = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { username, password } });
    tokenStore.set(res.token);
    setUser(res.user);
  };

  const can: Auth['can'] = (permission) => !!user?.permissions.includes(permission);
  const refresh = () => api<User>('/auth/profile').then(setUser);

  return <Ctx.Provider value={{ user, loading, login, logout, can, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
