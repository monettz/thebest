import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { normalizePhone } from '@shared/schemas';
import type { Role } from '@shared/constants';
import { supabase } from '@/lib/supabase';
import { userNumId } from '@/lib/ids';
import { clearAll } from '@/mock/hydrate';
import { invalidate } from '@/mock/sync';
import type { LoginResult, SessionUser } from '@/mock/auth';

interface AuthCtx {
  user: SessionUser | null;
  /** False until the saved Supabase session (if any) has been checked, so a refresh never flashes the login page. */
  ready: boolean;
  login: (phone: string, pin: string, remember: boolean) => Promise<LoginResult>;
  logout: () => void;
  isOwner: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

interface ProfileRow {
  id: string;
  full_name: string;
  phone: string;
  role: Role;
  is_active: boolean;
}

async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const { data } = await supabase.from('profiles').select('id, full_name, phone, role, is_active').eq('id', userId).maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

const toSessionUser = (p: ProfileRow): SessionUser => ({ id: userNumId(p.id), name: p.full_name, phone: p.phone, role: p.role });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  // The saved Supabase session is the only login state. There is no copy of it in our own storage.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          const profile = await fetchProfile(data.session.user.id);
          if (!alive) return;
          if (profile?.is_active) {
            invalidate();
            setUser(toSessionUser(profile));
          } else {
            await supabase.auth.signOut();
          }
        }
      } catch {
        /* offline: show the login page */
      } finally {
        if (alive) setReady(true);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        clearAll();
        setUser(null);
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (phoneInput: string, pin: string, _remember: boolean): Promise<LoginResult> => {
    const phone = normalizePhone(phoneInput);
    if (!phone) return { ok: false, reason: 'invalid', message: 'Namba ya simu si sahihi' };

    const { data, error } = await supabase.auth.signInWithPassword({ email: `${phone}@thebest.pos`, password: `pin_${pin}` });
    if (error || !data.user) {
      const offline = /fetch|network/i.test(error?.message ?? '');
      return { ok: false, reason: 'invalid', message: offline ? 'Hakuna mtandao. Jaribu tena.' : 'Namba ya simu au PIN si sahihi' };
    }
    const profile = await fetchProfile(data.user.id);
    if (!profile) {
      await supabase.auth.signOut();
      return { ok: false, reason: 'invalid', message: 'Akaunti haina wasifu. Wasiliana na mmiliki.' };
    }
    if (!profile.is_active) {
      await supabase.auth.signOut();
      return { ok: false, reason: 'inactive', message: 'Akaunti hii imezimwa. Wasiliana na mmiliki.' };
    }
    const sessionUser = toSessionUser(profile);
    invalidate();
    setUser(sessionUser);
    return { ok: true, user: sessionUser };
  }, []);

  const logout = useCallback(() => {
    void supabase.auth.signOut();
    clearAll();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, login, logout, isOwner: user?.role === 'owner' }), [user, ready, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
