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
});

/** Express middleware: requires a valid bearer token and attaches req.user. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const data = header.startsWith('Bearer ') ? readToken(header.slice(7)) : null;
  const user = data && loadUser('e.id = ? AND e.is_active = 1', data.sub);
  if (!user) return res.status(401).json({ message: 'Unauthorized' });
  req.user = user;
  next();
}

export const hasPermission = (user, permission) => user.permissions.includes(permission);

/** Express middleware factory: restricts a route to users whose role holds the permission. */
export const requirePermission = (permission) => (req, res, next) =>
  hasPermission(req.user, permission) ? next() : res.status(403).json({ message: 'Forbidden for your role' });
