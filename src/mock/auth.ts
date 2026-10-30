import { LOCK_MINUTES, MAX_FAILED_PINS, type Role } from '@shared/constants';
import { normalizePhone } from '@shared/schemas';
import { verifySecret } from '@shared/passwords';
import { SEED_USERS } from './seed';

/** A user as the login check sees them: a plain PIN (demo seed data) or a salted hash (users added in the app). */
export type AuthUser = { id: number; name: string; phone: string; role: Role; isActive: boolean } & ({ pin: string } | { salt: string; hash: string });
const pinMatches = (u: AuthUser, pin: string) => ('hash' in u ? verifySecret(pin, u.salt, u.hash) : u.pin === pin);

export interface SessionUser {
  id: number;
  name: string;
  phone: string;
  role: Role;
}

interface AttemptState {
  failed: number;
  lockedUntil: number | null;
}

export type LoginResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: 'invalid' | 'locked' | 'inactive'; message: string; minutesLeft?: number };

/** Failed-PIN counters live per phone number (server-side in the real build). */
export function createAuthService(source: AuthUser[] | (() => AuthUser[]) = SEED_USERS) {
  const getUsers = typeof source === 'function' ? source : () => source;
  const attempts = new Map<string, AttemptState>();

  return function login(phoneInput: string, pin: string, now = Date.now()): LoginResult {
    const phone = normalizePhone(phoneInput);
    const generic = { ok: false as const, reason: 'invalid' as const, message: 'Namba ya simu au PIN si sahihi' };
    if (!phone) return generic;

    const user = getUsers().find((u) => u.phone === phone);
    if (!user) return generic;
    if (!user.isActive) {
      return { ok: false, reason: 'inactive', message: 'Akaunti hii imezimwa. Wasiliana na mmiliki.' };
    }

    const st = attempts.get(phone) ?? { failed: 0, lockedUntil: null };
    if (st.lockedUntil && st.lockedUntil > now) {
      const minutesLeft = Math.ceil((st.lockedUntil - now) / 60_000);
      return {
        ok: false,
        reason: 'locked',
        minutesLeft,
        message: `Akaunti imefungwa. Jaribu tena baada ya dakika ${minutesLeft}.`,
      };
    }
    if (st.lockedUntil && st.lockedUntil <= now) {
      st.failed = 0;
      st.lockedUntil = null;
    }

    if (!pinMatches(user, pin)) {
      st.failed += 1;
      if (st.failed >= MAX_FAILED_PINS) {
        st.lockedUntil = now + LOCK_MINUTES * 60_000;
        attempts.set(phone, st);
        return {
          ok: false,
          reason: 'locked',
          minutesLeft: LOCK_MINUTES,
          message: `PIN si sahihi mara ${MAX_FAILED_PINS}. Akaunti imefungwa kwa dakika ${LOCK_MINUTES}.`,
        };
      }
      attempts.set(phone, st);
      return generic;
    }

    attempts.delete(phone);
    return { ok: true, user: { id: user.id, name: user.name, phone: user.phone, role: user.role } };
  };
}
