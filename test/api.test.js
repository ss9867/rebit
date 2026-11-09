import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebit-test-'));
let server;

before(async () => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    env: {
      ...process.env, PORT: String(PORT), REBIT_DATA_DIR: dataDir, ADMIN_ID: 'tester', ADMIN_PASSWORD: 'test-pass-1234', ALLOWED_ORIGINS: 'https://shop.example/',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i += 1) {
    try {
      await fetch(`${BASE}/api/levi/boot`);
      return;
    } catch {
      await new Promise((r) => { setTimeout(r, 100); });
    }
  }
  throw new Error('서버가 시작되지 않았습니다.');
});

after(async () => {
  const exited = new Promise((r) => { server.once('exit', r); });
  server.kill();
  await exited;
  // Windows는 DB 파일을 늦게 놓아 줄 때가 있다. 임시 폴더라 못 지워도 테스트 결과에는 영향이 없다.
  try {
    fs.rmSync(dataDir, {
      recursive: true, force: true, maxRetries: 5, retryDelay: 200,
    });
  } catch { /* 무시 */ }
});

// 쿠키를 기억하는 간단한 클라이언트
function client() {
  const jar = {};
  return async (url, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + url, {
      method,
      headers: {
        ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
        cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
}

test('쇼핑몰과 운영자 화면이 열린다', async () => {
  for (const p of ['/', '/admin', '/levi/levi.js', '/css/shop.css']) {
    const res = await fetch(BASE + p);
    assert.equal(res.status, 200, p);
  }
  assert.equal((await fetch(`${BASE}/../server/db.js`)).status, 404);
});

test('방문자: 저장된 답변 → 상담 연결 → 운영자 답장 → 종료', async () => {
  const guest = client();
  const op = client();

  const boot = await guest('/api/levi/boot');
  assert.ok(boot.data.faqs.length >= 5);
  assert.equal(boot.data.thread, null);

  // 연결 전에는 메시지를 보낼 수 없다.
  assert.equal((await guest('/api/levi/messages', { method: 'POST', body: { body: '안녕' } })).status, 409);

  const conn = await guest('/api/levi/connect', { method: 'POST', body: { first: '선물 포장 되나요?' } });
  assert.equal(conn.status, 200);
  assert.equal(conn.data.thread.status, 'waiting');
  assert.deepEqual(conn.data.thread.messages.map((m) => m.from), ['system', 'visitor']);

  // 운영자 로그인 전에는 막힌다.
  assert.equal((await op('/api/admin/threads')).status, 401);
  assert.equal((await op('/api/admin/login', { method: 'POST', body: { loginId: 'tester', password: 'wrong' } })).status, 401);
  assert.equal((await op('/api/admin/login', { method: 'POST', body: { loginId: 'tester', password: 'test-pass-1234' } })).status, 200);

  const list = await op('/api/admin/threads');
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.unread, 1);
  const id = list.data.items[0].id;

  assert.equal((await op(`/api/admin/threads/${id}/messages`, { method: 'POST', body: { body: '네, 가능해요!' } })).status, 200);
  assert.equal((await op(`/api/admin/threads/${id}/messages`, { method: 'POST', body: { mood: 'wink' } })).status, 200);
  assert.equal((await op(`/api/admin/threads/${id}/messages`, { method: 'POST', body: { mood: 'nope' } })).status, 400);

  const t = await guest('/api/levi/thread');
  assert.equal(t.data.thread.status, 'open');
  assert.equal(t.data.thread.unread, 2);
  assert.equal(t.data.thread.messages.at(-1).mood, 'wink');

  await guest('/api/levi/messages', { method: 'POST', body: { body: '감사합니다' } });
  await op(`/api/admin/threads/${id}/close`, { method: 'POST' });
  const closed = await guest('/api/levi/thread');
  assert.equal(closed.data.thread.status, 'closed');
  assert.equal((await guest('/api/levi/messages', { method: 'POST', body: { body: '또 질문' } })).status, 409);

  // 종료 후 다시 연결하면 새 상담이 열린다.
  const again = await guest('/api/levi/connect', { method: 'POST', body: {} });
  assert.notEqual(again.data.thread.id, id);

  // 다른 방문자는 남의 상담을 볼 수 없다.
  const other = client();
  assert.equal((await other('/api/levi/thread')).data.thread, null);
});

test('운영자: 저장된 답변 추가·수정·순서·삭제, 문구 설정', async () => {
  const op = client();
  await op('/api/admin/login', { method: 'POST', body: { loginId: 'tester', password: 'test-pass-1234' } });

  const created = await op('/api/admin/faqs', {
    method: 'POST',
    body: {
      category: '포장', path: '주문 > 선물 포장', question: '선물 포장 되나요?', answer: '2,000원에 가능해요.', keywords: '선물, 포장',
    },
  });
  assert.equal(created.status, 200);
  const fid = created.data.id;

  let items = (await op('/api/admin/faqs')).data.items;
  assert.equal(items.at(-1).keywords, '선물,포장');
  await op(`/api/admin/faqs/${fid}/move`, { method: 'POST', body: { dir: 'up' } });
  items = (await op('/api/admin/faqs')).data.items;
  assert.equal(items.at(-2).id, fid);

  await op(`/api/admin/faqs/${fid}`, {
    method: 'PUT',
    body: {
      category: '포장', path: '', question: '선물 포장 되나요?', answer: '무료로 해 드려요.', keywords: '', visible: false,
    },
  });
  const guest = client();
  assert.ok(!(await guest('/api/levi/boot')).data.faqs.some((f) => f.id === fid), '숨긴 답변은 손님에게 안 보인다');

  await op(`/api/admin/faqs/${fid}`, { method: 'DELETE' });
  assert.ok(!(await op('/api/admin/faqs')).data.items.some((f) => f.id === fid));

  assert.equal((await op('/api/admin/settings', { method: 'PUT', body: { welcome: '반가워요', away: '부재중', hours: '평일' } })).status, 200);
  assert.equal((await guest('/api/levi/boot')).data.welcome, '반가워요');
});

test('JSON이 아닌 쓰기 요청은 거절한다', async () => {
  const res = await fetch(`${BASE}/api/levi/connect`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  assert.equal(res.status, 415);
});

test('허용한 다른 사이트에서는 쿠키 대신 번호표로 상담한다', async () => {
  const SHOP = 'https://shop.example';
  const pre = await fetch(`${BASE}/api/levi/connect`, {
    method: 'OPTIONS',
    headers: { origin: SHOP, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, x-levi-visitor' },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), SHOP);
  assert.match(pre.headers.get('access-control-allow-headers'), /x-levi-visitor/);

  const embed = async (url, body, token) => {
    const headers = { origin: SHOP };
    if (body) headers['content-type'] = 'application/json';
    if (token) headers['x-levi-visitor'] = token;
    const res = await fetch(BASE + url, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body) });
    assert.equal(res.headers.get('access-control-allow-origin'), SHOP);
    assert.equal(res.headers.getSetCookie().length, 0, '다른 사이트 응답에는 쿠키를 넣지 않는다');
    return { status: res.status, data: await res.json() };
  };

  const c = await embed('/api/levi/connect', { first: '카페24에서 왔어요' });
  assert.equal(c.status, 200);
  const token = c.data.visitorToken;
  assert.ok(token && token.length >= 16);
  assert.equal(c.data.thread.messages.at(-1).body, '카페24에서 왔어요');

  const m = await embed('/api/levi/messages', { body: '두 번째 메시지' }, token);
  assert.equal(m.status, 200);
  assert.equal(m.data.thread.messages.at(-1).body, '두 번째 메시지');

  const b = await embed('/api/levi/boot', null, token);
  assert.equal(b.data.thread.messages.length, m.data.thread.messages.length);
  assert.equal((await embed('/api/levi/messages', { body: '번호표 없음' })).status, 409);

  // 허용하지 않은 사이트에는 CORS 허락을 주지 않는다.
  const other = await fetch(`${BASE}/api/levi/boot`, { headers: { origin: 'https://evil.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('운영자 이름은 운영 화면에만 보이고, 운영자별로 상담을 모아 볼 수 있다', async () => {
  const boss = client();
  assert.equal((await boss('/api/admin/login', { method: 'POST', body: { loginId: 'tester', password: 'test-pass-1234' } })).status, 200);
  const made = await boss('/api/admin/operators', { method: 'POST', body: { loginId: 'kim', name: '김상담', password: 'kim-pass-1234' } });
  assert.equal(made.status, 200);
  const kim = client();
  assert.equal((await kim('/api/admin/login', { method: 'POST', body: { loginId: 'kim', password: 'kim-pass-1234' } })).status, 200);

  const guest = client();
  await guest('/api/levi/connect', { method: 'POST', body: { first: '이름 테스트' } });
  const { id } = (await kim('/api/admin/threads')).data.items.find((t) => t.handlers.length === 0 && t.status === 'waiting');
  await kim(`/api/admin/threads/${id}/messages`, { method: 'POST', body: { body: '첫 번째 운영자 답장' } });
  await boss(`/api/admin/threads/${id}/messages`, { method: 'POST', body: { body: '관리자도 답해요' } });

  // 손님 쪽 응답에는 운영자 이름·번호가 전혀 없다.
  const seen = await guest('/api/levi/thread');
  assert.equal(seen.data.thread.messages.filter((m) => m.from === 'operator').length, 2);
  assert.ok(!JSON.stringify(seen.data).includes('김상담'));
  assert.ok(!JSON.stringify(seen.data).includes('operator' + 'Name'));

  // 운영 화면에는 메시지마다 누가 보냈는지 나온다.
  const detail = await boss(`/api/admin/threads/${id}`);
  const ops = detail.data.messages.filter((m) => m.from === 'operator').map((m) => m.operatorName);
  assert.deepEqual(ops, ['김상담', '레비 운영자']);
  assert.deepEqual([...detail.data.thread.handlers].sort(), ['김상담', '레비 운영자'].sort());

  // 종료한 사람도 기록된다.
  await kim(`/api/admin/threads/${id}/close`, { method: 'POST' });
  const closed = await boss(`/api/admin/threads/${id}`);
  assert.equal(closed.data.messages.at(-1).operatorName, '김상담');
  assert.ok(!JSON.stringify((await guest('/api/levi/thread')).data).includes('김상담'));

  // 운영자별 상담 모아 보기와 상담 수
  const byKim = await boss(`/api/admin/threads?status=closed&operator=${made.data.id}`);
  assert.deepEqual(byKim.data.items.map((t) => t.id), [id]);
  const list = (await boss('/api/admin/operators')).data.items;
  assert.equal(list.find((o) => o.loginId === 'kim').handled, 1);

  // 이름을 바꿔도 이미 보낸 메시지에는 보낼 때의 이름이 남는다.
  assert.equal((await boss(`/api/admin/operators/${made.data.id}`, { method: 'PUT', body: { name: '김매니저' } })).status, 200);
  assert.equal((await boss('/api/admin/operators')).data.items.find((o) => o.loginId === 'kim').name, '김매니저');
  assert.equal((await boss(`/api/admin/threads/${id}`)).data.messages.find((m) => m.from === 'operator').operatorName, '김상담');
});
