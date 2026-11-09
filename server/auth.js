// 운영자 로그인과 방문자 식별. 방문자는 가입 없이 쿠키에 든 무작위 토큰으로만 구분한다.
import crypto from 'node:crypto';
import { get, run } from './db.js';

export const SECURE_COOKIE = process.env.NODE_ENV === 'production';
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const VISITOR_MS = 180 * 24 * 60 * 60 * 1000;
export const OP_COOKIE = 'rb_op';
export const VISITOR_COOKIE = 'rb_v';

export const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
export const randomToken = () => crypto.randomBytes(24).toString('base64url');

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// 영문·숫자를 섞은 임시 비밀번호. 헷갈리는 글자(0/O, 1/l)는 뺐다.
export function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(12), (b) => chars[b % chars.length]).join('');
}

export function cookieHeader(name, value, maxAgeMs) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (SECURE_COOKIE) parts.push('Secure');
  return parts.join('; ');
}

export function parseCookies(header = '') {
  const out = {};
  for (const piece of header.split(';')) {
    const i = piece.indexOf('=');
    if (i > 0) out[piece.slice(0, i).trim()] = piece.slice(i + 1).trim();
  }
  return out;
}

export function createSession(operatorId) {
  const token = randomToken();
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  run('INSERT INTO sessions (token_hash, operator_id, expires_at) VALUES (?, ?, ?)', sha256(token), operatorId, Date.now() + SESSION_MS);
  return cookieHeader(OP_COOKIE, token, SESSION_MS);
}

export function operatorFrom(cookies) {
  const token = cookies[OP_COOKIE];
  if (!token) return null;
  return get(
    `SELECT o.id, o.login_id, o.name FROM sessions s JOIN operators o ON o.id = s.operator_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    sha256(token),
    Date.now(),
  ) || null;
}

export const endSession = (cookies) => {
  if (cookies[OP_COOKIE]) run('DELETE FROM sessions WHERE token_hash = ?', sha256(cookies[OP_COOKIE]));
  return cookieHeader(OP_COOKIE, '', 0);
};

// create가 참이면 처음 온 방문자에게 토큰을 새로 발급한다. 돌려준 cookie가 있으면 응답에 실어야 한다.
export function visitorFrom(cookies, { create = false } = {}) {
  const token = cookies[VISITOR_COOKIE];
  if (token) {
    const row = get('SELECT id FROM visitors WHERE token_hash = ?', sha256(token));
    if (row) return { id: row.id, cookie: null };
  }
  if (!create) return null;
  const fresh = randomToken();
  const { lastInsertRowid } = run('INSERT INTO visitors (token_hash, created_at) VALUES (?, ?)', sha256(fresh), Date.now());
  return { id: Number(lastInsertRowid), token: fresh, cookie: cookieHeader(VISITOR_COOKIE, fresh, VISITOR_MS) };
}

export function createOperator(loginId, name, password) {
  const { lastInsertRowid } = run(
    'INSERT INTO operators (login_id, name, pw_hash, created_at) VALUES (?, ?, ?, ?)',
    loginId, name, hashPassword(password), Date.now(),
  );
  return Number(lastInsertRowid);
}

// 운영자가 한 명도 없으면 첫 계정을 만들고 임시 비밀번호를 콘솔에 한 번만 보여 준다.
export function ensureFirstOperator() {
  if (get('SELECT 1 AS x FROM operators LIMIT 1')) return null;
  const loginId = process.env.ADMIN_ID || 'admin';
  const password = process.env.ADMIN_PASSWORD || tempPassword();
  createOperator(loginId, '레비 운영자', password);
  return { loginId, password, fromEnv: !!process.env.ADMIN_PASSWORD };
}
