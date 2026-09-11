import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { AppError } from './network.mjs';

const SESSION_COOKIE = 'figlet_session';
const READER_COOKIE = 'figlet_reader';
const SESSION_DAYS = 90;
const LOGIN_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{2,62}$/u;

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const candidate = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const saved = Buffer.from(hash, 'hex');
  return candidate.length === saved.length && timingSafeEqual(candidate, saved);
}
function parseCookies(header) {
  const jar = {};
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) jar[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return jar;
}
function isHttps(req) {
  return (req.headers['x-forwarded-proto'] || '').includes('https') || Boolean(req.socket?.encrypted);
}

export function createAuth(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);`);
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  const admins = () =>
    (process.env.FIGLET_ADMIN_LOGINS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

  function issueSession(req, res, userId) {
    const id = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(
      id,
      userId,
      Date.now() + SESSION_DAYS * 86400000,
    );
    res.append(
      'Set-Cookie',
      `${SESSION_COOKIE}=${id}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax${
        isHttps(req) ? '; Secure' : ''
      }`,
    );
  }
  function userFromRequest(req, res) {
    const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!id || !/^[a-f0-9]{64}$/.test(id)) return null;
    const row = db
      .prepare(
        'SELECT u.id, u.login, u.is_admin, s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?',
      )
      .get(id);
    if (!row || row.expires < Date.now()) return null;
    if (res && row.expires < Date.now() + 30 * 86400000) issueSession(req, res, row.id);
    return { id: row.id, login: row.login, isAdmin: Boolean(row.is_admin) };
  }
  function readerFromRequest(req, res) {
    const user = userFromRequest(req, res);
    if (user) return { id: `user:${user.id}`, user };
    let deviceId = parseCookies(req.headers.cookie)[READER_COOKIE];
    if (!deviceId || !/^[a-f0-9]{32}$/.test(deviceId)) {
      deviceId = randomBytes(16).toString('hex');
      res.append(
        'Set-Cookie',
        `${READER_COOKIE}=${deviceId}; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax${
          isHttps(req) ? '; Secure' : ''
        }`,
      );
    }
    return { id: `device:${deviceId}`, user: null };
  }
  function register(login, password, req, res) {
    if (!LOGIN_RE.test(login || ''))
      throw new AppError('Логин: 3–63 символа — буквы, цифры, точка, дефис или подчёркивание.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200)
      throw new AppError('Пароль: минимум 8 символов.');
    const { salt, hash } = hashPassword(password);
    const isAdmin = admins().includes(login.toLowerCase()) ? 1 : 0;
    let id;
    try {
      id = db
        .prepare(
          'INSERT INTO users (login, password_salt, password_hash, is_admin, created) VALUES (?,?,?,?,?)',
        )
        .run(login, salt, hash, isAdmin, Date.now()).lastInsertRowid;
    } catch {
      throw new AppError('Такой логин уже занят.', 409);
    }
    issueSession(req, res, id);
    return { id, login, isAdmin: Boolean(isAdmin) };
  }
  function login(login, password, req, res) {
    const row = db
      .prepare('SELECT id, login, password_salt, password_hash, is_admin FROM users WHERE login=?')
      .get(String(login || ''));
    if (!row || !verifyPassword(String(password || ''), row.password_salt, row.password_hash))
      throw new AppError('Неверный логин или пароль.', 401);
    let isAdmin = row.is_admin;
    if (!isAdmin && admins().includes(row.login.toLowerCase())) {
      db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(row.id);
      isAdmin = 1;
    }
    issueSession(req, res, row.id);
    return { id: row.id, login: row.login, isAdmin: Boolean(isAdmin) };
  }
  return {
    register,
    login,
    currentUser: userFromRequest,
    reader: readerFromRequest,
    logout(req, res) {
      const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (id) db.prepare('DELETE FROM sessions WHERE id=?').run(id);
      res.append(
        'Set-Cookie',
        `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`,
      );
    },
    // An anonymous device that later logs in keeps its subscription.
    migrateReader(fromId, toId) {
      if (!fromId?.startsWith('device:') || !toId?.startsWith('user:')) return;
      db.prepare('UPDATE OR IGNORE subscriptions SET reader=? WHERE reader=?').run(toId, fromId);
      db.prepare('DELETE FROM subscriptions WHERE reader=?').run(fromId);
    },
  };
}
