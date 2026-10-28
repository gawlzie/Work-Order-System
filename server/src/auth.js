import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DB_PATH, loadUser } from './db.js';

const TOKEN_TTL_SEC = 60 * 60 * 12;

function loadSecret() {
  if (process.env.WOS_SECRET) return process.env.WOS_SECRET;
  const file = join(dirname(DB_PATH), 'secret.key');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'));
  return readFileSync(file, 'utf8').trim();
}
const SECRET = loadSecret();

export function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(plain, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const candidate = scryptSync(plain, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const sign = (data) => createHmac('sha256', SECRET).update(data).digest('base64url');

export function issueToken(userId) {
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return data.exp > Date.now() / 1000 ? data : null;
}

export const publicUser = (u) => ({
  id: u.id,
  employee_id: u.employee_id,
  full_name: u.full_name,
  username: u.username,
  role: u.role,
  role_name: u.role_name,
  permissions: u.permissions,
  company: u.company,
  site: u.site,
  phone: u.phone,
  email: u.email,
  must_change_password: !!u.must_change_password,
});

/** Express middleware: requires a valid bearer token and attaches req.user. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const data = header.startsWith('Bearer ') ? readToken(header.slice(7)) : null;
  const user = data && loadUser('e.id = ? AND e.is_active = 1', data.sub);
  if (!user) return res.status(401).json({ message: 'Unauthorized' });
  req.user = user;
  // Until the user has set their own password, only the profile and the password change are open.
  if (user.must_change_password && !PASSWORD_CHANGE_PATHS.has(req.path)) {
    return res.status(428).json({ message: 'Set your own password before you continue', code: 'password_change_required' });
  }
  next();
}

const PASSWORD_CHANGE_PATHS = new Set(['/auth/profile', '/auth/change-password']);

/* ---------- Sign-in lock-out ---------- */
// Failed sign-ins per account and per address in a sliding window; at the limit the account (or address) waits.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_ACCOUNT = 5;
const MAX_PER_ADDRESS = 20;
const failures = new Map();

/** The client's address: behind the Cloudflare tunnel (a local connection) the one Cloudflare passes on. */
export function clientAddress(req) {
  const local = /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress ?? '');
  return (local && req.headers['cf-connecting-ip']) || req.socket.remoteAddress || 'unknown';
}

const recent = (key, now) => (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

/** Throws 429 when the account or the address has too many recent failed sign-ins. */
export function assertLoginAllowed(username, address, now = Date.now()) {
  for (const [key, max] of [[`u:${username}`, MAX_PER_ACCOUNT], [`a:${address}`, MAX_PER_ADDRESS]]) {
    const list = recent(key, now);
    if (list.length >= max) {
      const minutes = Math.max(1, Math.ceil((list[0] + WINDOW_MS - now) / 60000));
      const err = new Error(`Too many failed sign-ins. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
      err.status = 429;
      throw err;
    }
  }
}

export function recordLoginFailure(username, address, now = Date.now()) {
  for (const key of [`u:${username}`, `a:${address}`]) failures.set(key, [...recent(key, now), now]);
  if (failures.size > 10000) for (const [key] of failures) if (!recent(key, now).length) failures.delete(key);
}

export const clearLoginFailures = (username) => failures.delete(`u:${username}`);

export const hasPermission = (user, permission) => user.permissions.includes(permission);

/** Express middleware factory: restricts a route to users whose role holds the permission. */
export const requirePermission = (permission) => (req, res, next) =>
  hasPermission(req.user, permission) ? next() : res.status(403).json({ message: 'Forbidden for your role' });
