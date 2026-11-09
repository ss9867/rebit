// HTTP 서버. 정적 파일, 방문자용 레비 API, 운영자용 관리 API, 실시간 알림(SSE)을 한곳에서 처리한다.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VISITOR_COOKIE, createOperator, createSession, endSession, hashPassword, operatorFrom, parseCookies, verifyPassword, visitorFrom,
} from './auth.js';
import {
  all, get, run, settings, tx,
} from './db.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MESSAGE_MAX = 1000;
const HISTORY_LIMIT = 300;
export const MOODS = ['happy', 'normal', 'wink', 'surprised', 'sweat', 'cry', 'love'];
const SETTING_KEYS = { welcome: 600, away: 300, hours: 120 };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (message) => new HttpError(400, message);

// 짧은 시간에 너무 많이 보내는 것을 막는다. 서버 메모리에만 기록한다.
const hits = new Map();
function rateLimit(key, max, windowMs, message) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, message);
  list.push(now);
  hits.set(key, list);
}
setInterval(() => {
  const now = Date.now();
  for (const [key, list] of hits) if (list.every((t) => now - t > 15 * 60 * 1000)) hits.delete(key);
}, 5 * 60 * 1000).unref();

function text(value, label, { max, required = true } = {}) {
  const s = typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
  if (required && !s) throw bad(`${label}을(를) 입력해 주세요.`);
  if (max && s.length > max) throw bad(`${label}은(는) ${max}자 이하로 입력해 주세요.`);
  return s;
}

const intId = (value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, '찾을 수 없습니다.');
  return n;
};

// 실시간 알림 ------------------------------------------------------------------

const clients = new Set();

function send(client, event, data) {
  client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const operatorsOnline = () => [...clients].some((c) => c.operator);

function emit(filter, event, data = {}) {
  for (const c of clients) if (filter(c)) send(c, event, data);
}
const toOperators = (event, data) => emit((c) => c.operator, event, data);
const toVisitor = (visitorId, event, data) => emit((c) => c.visitorId === visitorId, event, data);

function presenceChanged(before) {
  const now = operatorsOnline();
  if (now !== before) emit((c) => !c.operator, 'presence', { online: now });
}

function openStream(req, res, meta) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const before = operatorsOnline();
  const client = { res, ...meta };
  clients.add(client);
  send(client, 'hello', { online: operatorsOnline() });
  if (meta.operator) presenceChanged(before);
  req.on('close', () => {
    const was = operatorsOnline();
    clients.delete(client);
    if (meta.operator) presenceChanged(was);
  });
}

setInterval(() => {
  for (const c of clients) c.res.write(': ping\n\n');
}, 20000).unref();

// 공통 변환 --------------------------------------------------------------------

// 손님에게 가는 메시지에는 운영자 정보를 넣지 않는다. 손님 화면에는 모두 '레비'로 보인다.
const messageView = (m) => ({
  id: m.id, from: m.sender, body: m.body, mood: m.mood, at: m.created_at,
});

// 운영 화면용: 누가 보냈는지(또는 종료했는지)까지 붙인다.
const adminMessageView = (m) => ({
  ...messageView(m),
  ...(m.operator_name ? { operatorId: m.operator_id, operatorName: m.operator_name } : {}),
});

const history = (threadId, view = messageView) => all(
  'SELECT * FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT ?',
  threadId,
  HISTORY_LIMIT,
).reverse().map(view);

const faqView = (f, { admin = false } = {}) => ({
  id: f.id,
  category: f.category,
  path: f.path,
  question: f.question,
  answer: f.answer,
  keywords: f.keywords,
  ...(admin ? { sort: f.sort, visible: !!f.visible, views: f.views } : {}),
});

const visitorLabel = (visitorId) => `손님 ${String(visitorId).padStart(4, '0')}`;

const currentThread = (visitorId) => get(
  "SELECT * FROM threads WHERE visitor_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 1",
  visitorId,
);

const threadSummary = (t) => ({
  id: t.id,
  label: visitorLabel(t.visitor_id),
  status: t.status,
  unread: t.unread_op,
  page: t.page,
  last: t.last_body === '' ? '(레비 이모티콘)' : t.last_body || '',
  lastFrom: t.last_from,
  lastAt: t.last_at,
  createdAt: t.created_at,
  handlers: t.handlers ? t.handlers.split(String.fromCharCode(31)) : [],
});

const THREAD_SELECT = `SELECT t.*,
  (SELECT m.body FROM messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
  (SELECT m.sender FROM messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_from,
  (SELECT group_concat(n, char(31)) FROM (SELECT DISTINCT m.operator_name AS n FROM messages m
    WHERE m.thread_id = t.id AND m.sender = 'operator' AND m.operator_name IS NOT NULL)) AS handlers
  FROM threads t`;

function loadThread(id) {
  const row = get(`${THREAD_SELECT} WHERE t.id = ?`, intId(id));
  if (!row) throw new HttpError(404, '상담을 찾을 수 없습니다.');
  return row;
}

function addMessage(threadId, sender, { body = '', mood = null, operator = null }) {
  const now = Date.now();
  run(
    'INSERT INTO messages (thread_id, sender, operator_id, operator_name, body, mood, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    threadId, sender, operator?.id ?? null, operator?.name ?? null, body, mood, now,
  );
  run('UPDATE threads SET last_at = ? WHERE id = ?', now, threadId);
}

function closeThread(thread, by, operator = null) {
  tx(() => {
    addMessage(thread.id, 'system', { body: by === 'visitor' ? '손님이 상담을 종료했어요.' : '상담이 종료되었어요. 이용해 주셔서 감사해요!', operator });
    run("UPDATE threads SET status = 'closed', closed_at = ?, unread_op = 0 WHERE id = ?", Date.now(), thread.id);
  });
  toVisitor(thread.visitor_id, 'thread', { id: thread.id });
  toOperators('threads', { id: thread.id });
}

// 방문자 API -------------------------------------------------------------------

// 진행 중인 상담, 없으면 1시간 안에 끝난 상담을 보여 줘서 종료 직후에도 대화 내용이 남아 있게 한다.
function visitorThreadView(visitorId) {
  const thread = currentThread(visitorId) || get(
    "SELECT * FROM threads WHERE visitor_id = ? AND status = 'closed' AND closed_at > ? ORDER BY id DESC LIMIT 1",
    visitorId,
    Date.now() - 60 * 60 * 1000,
  );
  if (!thread) return null;
  return {
    id: thread.id, status: thread.status, unread: thread.unread_visitor, messages: history(thread.id),
  };
}

function visitorRoutes(r) {
  r.get('/api/levi/boot', (ctx) => {
    const visitor = visitorFrom(ctx.cookies);
    const s = settings();
    return {
      welcome: s.welcome,
      away: s.away,
      hours: s.hours,
      online: operatorsOnline(),
      faqs: all('SELECT * FROM faqs WHERE visible = 1 ORDER BY sort, id').map((f) => faqView(f)),
      thread: visitor ? visitorThreadView(visitor.id) : null,
    };
  });

  r.get('/api/levi/thread', (ctx) => {
    const visitor = visitorFrom(ctx.cookies);
    return { online: operatorsOnline(), thread: visitor ? visitorThreadView(visitor.id) : null };
  });

  r.post('/api/levi/faqs/:id/view', (ctx) => {
    run('UPDATE faqs SET views = views + 1 WHERE id = ? AND visible = 1', intId(ctx.params.id));
  });

  // 상담 연결. 이미 진행 중인 상담이 있으면 그대로 이어간다.
  r.post('/api/levi/connect', async (ctx) => {
    const input = await ctx.json();
    const visitor = visitorFrom(ctx.cookies, { create: true });
    if (visitor.token && ctx.embedded) ctx.visitorToken = visitor.token;
    else if (visitor.cookie) ctx.setCookie(visitor.cookie);
    rateLimit(`connect:${ctx.ip}`, 10, 10 * 60 * 1000, '상담 연결을 너무 자주 시도했어요. 잠시 후 다시 눌러 주세요.');
    const first = text(input.first, '질문', { max: MESSAGE_MAX, required: false });
    const page = text(input.page, '페이지', { max: 200, required: false }) || null;
    let thread = currentThread(visitor.id);
    if (!thread) {
      const now = Date.now();
      tx(() => {
        const { lastInsertRowid } = run(
          'INSERT INTO threads (visitor_id, page, created_at, last_at) VALUES (?, ?, ?, ?)',
          visitor.id, page, now, now,
        );
        const id = Number(lastInsertRowid);
        addMessage(id, 'system', { body: '상담이 연결되었어요.' });
        if (first) {
          addMessage(id, 'visitor', { body: first });
          run('UPDATE threads SET unread_op = 1 WHERE id = ?', id);
        }
      });
      thread = currentThread(visitor.id);
      toOperators('threads', { id: thread.id, fresh: true });
    }
    return { online: operatorsOnline(), thread: visitorThreadView(visitor.id), visitorToken: ctx.visitorToken };
  });

  r.post('/api/levi/messages', async (ctx) => {
    const visitor = visitorFrom(ctx.cookies);
    const thread = visitor && currentThread(visitor.id);
    if (!thread) throw new HttpError(409, '상담이 종료되었어요. 다시 상담 연결을 눌러 주세요.');
    rateLimit(`msg:${visitor.id}`, 30, 60 * 1000, '메시지를 너무 빨리 보내고 있어요. 잠시 후 다시 보내 주세요.');
    const body = text((await ctx.json()).body, '메시지', { max: MESSAGE_MAX });
    tx(() => {
      addMessage(thread.id, 'visitor', { body });
      run('UPDATE threads SET unread_op = unread_op + 1 WHERE id = ?', thread.id);
    });
    toOperators('threads', { id: thread.id });
    toVisitor(visitor.id, 'thread', { id: thread.id });
    return { thread: visitorThreadView(visitor.id) };
  });

  r.post('/api/levi/read', (ctx) => {
    const visitor = visitorFrom(ctx.cookies);
    const thread = visitor && currentThread(visitor.id);
    if (thread) run('UPDATE threads SET unread_visitor = 0 WHERE id = ?', thread.id);
  });

  r.post('/api/levi/close', (ctx) => {
    const visitor = visitorFrom(ctx.cookies);
    const thread = visitor && currentThread(visitor.id);
    if (thread) closeThread(thread, 'visitor');
  });

  r.get('/api/levi/stream', (ctx) => {
    const visitor = visitorFrom(ctx.cookies);
    openStream(ctx.req, ctx.res, { operator: false, visitorId: visitor?.id ?? null });
    return ctx.STREAM;
  });
}

// 운영자 API -------------------------------------------------------------------

function operatorRoutes(r) {
  const op = (ctx) => {
    if (!ctx.operator) throw new HttpError(401, '로그인이 필요합니다.');
  };

  r.post('/api/admin/login', async (ctx) => {
    const input = await ctx.json();
    rateLimit(`login:${ctx.ip}`, 10, 10 * 60 * 1000, '로그인 시도가 너무 많아요. 10분 뒤 다시 시도해 주세요.');
    const row = get('SELECT * FROM operators WHERE login_id = ?', String(input.loginId || '').trim());
    if (!row || !verifyPassword(String(input.password || ''), row.pw_hash)) throw new HttpError(401, '아이디 또는 비밀번호가 맞지 않습니다.');
    ctx.setCookie(createSession(row.id));
    return { operator: { id: row.id, loginId: row.login_id, name: row.name } };
  });

  r.post('/api/admin/logout', (ctx) => {
    ctx.setCookie(endSession(ctx.cookies));
  });

  r.get('/api/admin/me', (ctx) => ({
    operator: ctx.operator ? { id: ctx.operator.id, loginId: ctx.operator.login_id, name: ctx.operator.name } : null,
  }));

  r.post('/api/admin/password', op, async (ctx) => {
    const input = await ctx.json();
    const row = get('SELECT pw_hash FROM operators WHERE id = ?', ctx.operator.id);
    if (!verifyPassword(String(input.current || ''), row.pw_hash)) throw bad('현재 비밀번호가 맞지 않습니다.');
    const next = String(input.next || '');
    if (next.length < 8) throw bad('새 비밀번호는 8자 이상으로 정해 주세요.');
    run('UPDATE operators SET pw_hash = ? WHERE id = ?', hashPassword(next), ctx.operator.id);
  });

  r.get('/api/admin/operators', op, () => ({
    items: all(`SELECT o.id, o.login_id, o.name, o.created_at,
      (SELECT COUNT(DISTINCT m.thread_id) FROM messages m WHERE m.operator_id = o.id AND m.sender = 'operator') AS handled
      FROM operators o ORDER BY o.id`).map((o) => ({
      id: o.id, loginId: o.login_id, name: o.name, createdAt: o.created_at, handled: o.handled,
    })),
  }));

  // 이름 바꾸기. 이미 보낸 메시지에는 보낼 때의 이름이 남는다.
  r.put('/api/admin/operators/:id', op, async (ctx) => {
    const id = intId(ctx.params.id);
    const name = text((await ctx.json()).name, '이름', { max: 30 });
    if (!get('SELECT 1 AS x FROM operators WHERE id = ?', id)) throw new HttpError(404, '계정을 찾을 수 없습니다.');
    run('UPDATE operators SET name = ? WHERE id = ?', name, id);
  });

  r.post('/api/admin/operators', op, async (ctx) => {
    const input = await ctx.json();
    const loginId = text(input.loginId, '아이디', { max: 30 });
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(loginId)) throw bad('아이디는 영문·숫자·_ . - 로 3~30자입니다.');
    const name = text(input.name, '이름', { max: 30 });
    const password = String(input.password || '');
    if (password.length < 8) throw bad('비밀번호는 8자 이상으로 정해 주세요.');
    if (get('SELECT 1 AS x FROM operators WHERE login_id = ?', loginId)) throw bad('이미 있는 아이디입니다.');
    return { id: createOperator(loginId, name, password) };
  });

  r.delete('/api/admin/operators/:id', op, (ctx) => {
    const id = intId(ctx.params.id);
    if (id === ctx.operator.id) throw bad('지금 로그인한 계정은 지울 수 없습니다.');
    run('DELETE FROM operators WHERE id = ?', id);
  });

  // 상담 ------------------------------------------------------------
  r.get('/api/admin/threads', op, (ctx) => {
    const closed = ctx.query.get('status') === 'closed';
    // ?operator=<운영자 번호>: 그 운영자가 답장한 상담만
    const opId = ctx.query.get('operator') ? intId(ctx.query.get('operator')) : null;
    const rows = all(
      `${THREAD_SELECT} WHERE t.status ${closed ? "= 'closed'" : "!= 'closed'"}
       ${opId ? "AND EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND m.sender = 'operator' AND m.operator_id = ?)" : ''}
       ORDER BY t.last_at DESC LIMIT 200`,
      ...(opId ? [opId] : []),
    );
    return {
      online: operatorsOnline(),
      unread: get("SELECT COALESCE(SUM(unread_op), 0) AS n FROM threads WHERE status != 'closed'").n,
      waiting: get("SELECT COUNT(*) AS n FROM threads WHERE status = 'waiting'").n,
      items: rows.map(threadSummary),
    };
  });

  r.get('/api/admin/threads/:id', op, (ctx) => {
    const row = loadThread(ctx.params.id);
    const past = get("SELECT COUNT(*) AS n FROM threads WHERE visitor_id = ? AND id != ? AND status = 'closed'", row.visitor_id, row.id).n;
    return { thread: { ...threadSummary(row), pastCount: past }, messages: history(row.id, adminMessageView) };
  });

  r.post('/api/admin/threads/:id/read', op, (ctx) => {
    run('UPDATE threads SET unread_op = 0 WHERE id = ?', loadThread(ctx.params.id).id);
    toOperators('threads', {});
  });

  r.post('/api/admin/threads/:id/messages', op, async (ctx) => {
    const row = loadThread(ctx.params.id);
    if (row.status === 'closed') throw new HttpError(409, '종료된 상담에는 답장할 수 없습니다.');
    const input = await ctx.json();
    const mood = input.mood == null ? null : String(input.mood);
    if (mood && !MOODS.includes(mood)) throw bad('없는 이모티콘입니다.');
    const body = mood ? '' : text(input.body, '메시지', { max: MESSAGE_MAX });
    tx(() => {
      addMessage(row.id, 'operator', { body, mood, operator: ctx.operator });
      run("UPDATE threads SET status = 'open', unread_op = 0, unread_visitor = unread_visitor + 1 WHERE id = ?", row.id);
    });
    toVisitor(row.visitor_id, 'thread', { id: row.id, reply: true });
    toOperators('threads', { id: row.id });
  });

  r.post('/api/admin/threads/:id/close', op, (ctx) => {
    const row = loadThread(ctx.params.id);
    if (row.status !== 'closed') closeThread(row, 'operator', ctx.operator);
  });

  // 자주 묻는 질문 ---------------------------------------------------
  const faqInput = (input) => ({
    category: text(input.category, '분류', { max: 20 }),
    path: text(input.path, '경로', { max: 80, required: false }),
    question: text(input.question, '질문', { max: 120 }),
    answer: text(input.answer, '답변', { max: 2000 }),
    keywords: text(input.keywords, '키워드', { max: 300, required: false })
      .split(/[,\n]/).map((k) => k.trim()).filter(Boolean).join(','),
    visible: input.visible === false ? 0 : 1,
  });

  r.get('/api/admin/faqs', op, () => ({
    items: all('SELECT * FROM faqs ORDER BY sort, id').map((f) => faqView(f, { admin: true })),
  }));

  r.post('/api/admin/faqs', op, async (ctx) => {
    const f = faqInput(await ctx.json());
    const now = Date.now();
    const sort = get('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM faqs').n;
    const { lastInsertRowid } = run(
      'INSERT INTO faqs (category, path, question, answer, keywords, visible, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      f.category, f.path, f.question, f.answer, f.keywords, f.visible, sort, now, now,
    );
    return { id: Number(lastInsertRowid) };
  });

  r.put('/api/admin/faqs/:id', op, async (ctx) => {
    const id = intId(ctx.params.id);
    const f = faqInput(await ctx.json());
    const { changes } = run(
      'UPDATE faqs SET category = ?, path = ?, question = ?, answer = ?, keywords = ?, visible = ?, updated_at = ? WHERE id = ?',
      f.category, f.path, f.question, f.answer, f.keywords, f.visible, Date.now(), id,
    );
    if (!changes) throw new HttpError(404, '답변을 찾을 수 없습니다.');
  });

  r.post('/api/admin/faqs/:id/move', op, async (ctx) => {
    const id = intId(ctx.params.id);
    const dir = (await ctx.json()).dir === 'up' ? -1 : 1;
    const list = all('SELECT id FROM faqs ORDER BY sort, id').map((f) => f.id);
    const i = list.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    tx(() => list.forEach((fid, n) => run('UPDATE faqs SET sort = ? WHERE id = ?', n + 1, fid)));
  });

  r.delete('/api/admin/faqs/:id', op, (ctx) => {
    run('DELETE FROM faqs WHERE id = ?', intId(ctx.params.id));
  });

  // 설정 ---------------------------------------------------------------
  r.get('/api/admin/settings', op, () => settings());

  r.put('/api/admin/settings', op, async (ctx) => {
    const input = await ctx.json();
    const values = Object.entries(SETTING_KEYS).map(([key, max]) => [key, text(input[key], '문구', { max })]);
    tx(() => values.forEach(([key, value]) => run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    )));
  });

  r.get('/api/admin/stream', op, (ctx) => {
    openStream(ctx.req, ctx.res, { operator: true, operatorId: ctx.operator.id });
    return ctx.STREAM;
  });
}

// 라우터 ---------------------------------------------------------------------

function createRouter() {
  const routes = [];
  const add = (method) => (pattern, ...handlers) => {
    const keys = [];
    const regex = new RegExp(`^${pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({
      method, regex, keys, handlers,
    });
  };
  return {
    routes,
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    delete: add('DELETE'),
  };
}

const router = createRouter();
visitorRoutes(router);
operatorRoutes(router);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
const PAGES = { '/': 'index.html', '/admin': 'admin.html' };

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function serveStatic(req, res, pathname) {
  const rel = PAGES[pathname] || pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end(), true;
  fs.createReadStream(file).pipe(res);
  return true;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new HttpError(413, '내용이 너무 깁니다.'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(value && typeof value === 'object' ? value : {});
      } catch {
        reject(bad('요청 형식이 올바르지 않습니다.'));
      }
    });
    req.on('error', reject);
  });
}

const STREAM = Symbol('stream');

async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  const { pathname } = url;

  if (!pathname.startsWith('/api/')) {
    if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, pathname)) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('페이지를 찾을 수 없습니다.');
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const setCookies = [];

  // 다른 사이트(예: 카페24 쇼핑몰)에 레비를 붙인 경우. ALLOWED_ORIGINS에 적힌 주소만 손님 API를 쓸 수 있고,
  // 다른 사이트 쿠키는 브라우저가 막는 경우가 많아 손님 구분은 쿠키 대신 x-levi-visitor 헤더(스트림은 ?v=)로 받는다.
  const origin = String(req.headers.origin || '');
  const embedded = pathname.startsWith('/api/levi/') && ALLOWED_ORIGINS.has(origin);
  if (embedded) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers': 'content-type, x-levi-visitor',
        'access-control-max-age': '600',
      });
      res.end();
      return;
    }
    const token = String(req.headers['x-levi-visitor'] || url.searchParams.get('v') || '');
    if (/^[\w-]{16,128}$/.test(token)) cookies[VISITOR_COOKIE] = token;
    else delete cookies[VISITOR_COOKIE];
  }
  const ctx = {
    req,
    res,
    query: url.searchParams,
    cookies,
    params: {},
    STREAM,
    ip: (process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress,
    operator: null,
    embedded,
    setCookie: (c) => setCookies.push(c),
    json: () => readJson(req),
  };

  const reply = (status, body) => {
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
    if (setCookies.length) headers['set-cookie'] = setCookies;
    res.writeHead(status, headers);
    res.end(JSON.stringify(body ?? { ok: true }));
  };

  try {
    // 다른 사이트에서 폼으로 몰래 보내는 요청을 막기 위해 쓰기 요청은 JSON만 받는다.
    if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
      throw new HttpError(415, 'JSON 요청만 받습니다.');
    }
    let found = null;
    let pathOnly = false;
    for (const route of router.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathOnly = true;
      if (route.method !== req.method) continue;
      found = route;
      route.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
      break;
    }
    if (!found) throw new HttpError(pathOnly ? 405 : 404, '찾을 수 없습니다.');
    if (pathname.startsWith('/api/admin/')) ctx.operator = operatorFrom(cookies);
    let result;
    for (const fn of found.handlers) result = await fn(ctx);
    if (result === STREAM) return;
    reply(200, result);
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (res.headersSent) return res.end();
    reply(err.status || 500, { error: err instanceof HttpError ? err.message : '서버 오류가 발생했습니다.' });
  }
}

// 레비를 붙일 수 있는 다른 사이트 주소. 쉼표로 여러 개 (예: https://sodaonni.cafe24.com,https://www.example.com)
const ALLOWED_ORIGINS = new Set(String(process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean));

export function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}
