/**
 * Users. With Supabase the list comes from `profiles` and accounts are created/changed by the
 * owner-only database functions `rpc_create_user` / `rpc_update_user` (Supabase Auth holds the password).
 * The in-memory implementation below is used only by the automated tests.
 */
import type { Role } from '@shared/constants';
import { normalizePhone } from '@shared/schemas';
import { hashSecret, newSalt, validateSecret } from '@shared/passwords';
import { logAudit } from './audit';
import { SEED_USERS } from './seed';
import { userNumId } from '@/lib/ids';
import { ensureFresh, isRemote, rpc, write } from './sync';

export interface UserRecord {
  id: number;
  name: string;
  phone: string; // normalized 255XXXXXXXXX
  role: Role;
  isActive: boolean;
  salt: string;
  hash: string;
  createdAt: string;
}
export type UserView = Omit<UserRecord, 'salt' | 'hash'>;

export interface UserInput {
  name: string;
  phone: string;
  role: Role;
  isActive: boolean;
  password?: string; // required when creating; optional when editing (blank = keep)
  confirm?: string;
}

/** What the rest of the app depends on. Supabase will provide another implementation. */
export interface UsersRepo {
  list(): Promise<UserView[]>;
  create(actor: { name: string; role: Role }, input: UserInput): Promise<UserView>;
  update(actor: { id?: number; name: string; role: Role }, id: number, input: UserInput): Promise<UserView>;
}

const view = ({ salt: _s, hash: _h, ...u }: UserRecord): UserView => u;

function seed(): UserRecord[] {
  return SEED_USERS.map((u) => {
    const salt = newSalt();
    return { id: u.id, name: u.name, phone: u.phone, role: u.role, isActive: u.isActive, salt, hash: hashSecret(u.pin, salt), createdAt: new Date().toISOString() };
  });
}

let users: UserRecord[] = isRemote() ? [] : seed();
const uuids = new Map<number, string>();
const persist = () => {
  /* nothing to persist: the database is the source of truth */
};

/** Replaces the user list with what `profiles` holds (called by ./hydrate). */
export function hydrateUsers(next: Array<UserView & { uuid: string }>): void {
  uuids.clear();
  users = next.map(({ uuid, ...u }) => {
    uuids.set(u.id, uuid);
    return { ...u, salt: '', hash: '' };
  });
}
const delay = <T,>(v: T) => (isRemote() ? Promise.resolve(v) : new Promise<T>((r) => setTimeout(() => r(v), 120)));

/** Used by the login service. Returns what it needs to check a password and nothing else. */
export const authUsers = (): UserRecord[] => users;
/** Test hook. */
export const resetUsersForTest = () => {
  users = seed();
};

function check(input: UserInput, id: number | null): { phone: string } {
  if (input.name.trim().length < 2) throw new Error('Weka jina kamili');
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error('Namba ya simu si sahihi');
  if (users.some((u) => u.phone === phone && u.id !== id)) throw new Error('Namba hii tayari inatumika na mtumiaji mwingine');
  return { phone };
}

export const localUsers: UsersRepo = {
  async list() {
    await ensureFresh();
    return delay(users.map(view));
  },

  async create(actor, input) {
    if (actor.role !== 'owner') throw new Error('Mmiliki tu ndiye anaweza kuongeza watumiaji');
    await ensureFresh();
    const { phone } = check(input, null);
    const bad = validateSecret(input.password ?? '', input.confirm ?? '');
    if (bad) throw new Error(bad);
    if (isRemote()) {
      return write(async () => {
        const uuid = await rpc<string>('rpc_create_user', {
          payload: { phone, name: input.name.trim(), role: input.role, isActive: input.isActive, password: input.password },
        });
        return { id: userNumId(uuid), name: input.name.trim(), phone, role: input.role, isActive: input.isActive, createdAt: new Date().toISOString() };
      });
    }
    const salt = newSalt();
    const rec: UserRecord = {
      id: Math.max(0, ...users.map((u) => u.id)) + 1,
      name: input.name.trim(),
      phone,
      role: input.role,
      isActive: input.isActive,
      salt,
      hash: hashSecret(input.password!, salt),
      createdAt: new Date().toISOString(),
    };
    users = [...users, rec];
    persist();
    logAudit(actor.name, 'USER_CREATE', rec.id, `${rec.name} (${rec.role})`);
    return delay(view(rec));
  },

  async update(actor, id, input) {
    if (actor.role !== 'owner') throw new Error('Mmiliki tu ndiye anaweza kubadilisha watumiaji');
    await ensureFresh();
    const before = users.find((u) => u.id === id);
    if (!before) throw new Error('Mtumiaji hajapatikana');
    const { phone } = check(input, id);
    // Never lock the shop out: the last active owner keeps the owner role and an active account.
    const activeOwners = users.filter((u) => u.role === 'owner' && u.isActive && u.id !== id).length;
    if (before.role === 'owner' && activeOwners === 0 && (input.role !== 'owner' || !input.isActive)) {
      throw new Error('Lazima abaki mmiliki mmoja mwenye akaunti hai');
    }
    if (actor.id === id && !input.isActive) throw new Error('Huwezi kuzima akaunti yako mwenyewe');

    if (isRemote()) {
      const uuid = uuids.get(id);
      if (!uuid) throw new Error('Mtumiaji hajapatikana');
      if (input.password || input.confirm) {
        const bad = validateSecret(input.password ?? '', input.confirm ?? '');
        if (bad) throw new Error(bad);
      }
      return write(async () => {
        await rpc('rpc_update_user', {
          payload: { id: uuid, phone, name: input.name.trim(), role: input.role, isActive: input.isActive, password: input.password || '' },
        });
        return { id, name: input.name.trim(), phone, role: input.role, isActive: input.isActive, createdAt: before.createdAt };
      });
    }

    let { salt, hash } = before;
    if (input.password || input.confirm) {
      const bad = validateSecret(input.password ?? '', input.confirm ?? '');
      if (bad) throw new Error(bad);
      salt = newSalt();
      hash = hashSecret(input.password!, salt);
    }
    const next: UserRecord = { ...before, name: input.name.trim(), phone, role: input.role, isActive: input.isActive, salt, hash };
    users = users.map((u) => (u.id === id ? next : u));
    persist();
    const changes = [
      before.name !== next.name && 'jina',
      before.phone !== next.phone && 'simu',
      before.role !== next.role && `jukumu ${before.role} → ${next.role}`,
      before.isActive !== next.isActive && (next.isActive ? 'imewashwa' : 'imezimwa'),
      hash !== before.hash && 'nenosiri',
    ].filter(Boolean);
    logAudit(actor.name, 'USER_UPDATE', id, `${next.name}: ${changes.join(', ') || 'hakuna mabadiliko'}`);
    return delay(view(next));
  },
};
