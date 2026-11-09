// 화면 그리기 도우미. html`` 안에 넣은 값은 자동으로 이스케이프되고, raw()로 감싼 값만 그대로 들어간다.
const RAW = Symbol('raw');

export const raw = (value) => ({ [RAW]: String(value) });

const ESC = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ESC[c]);

function part(value) {
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return value.map(part).join('');
  if (typeof value === 'object' && RAW in value) return value[RAW];
  return escape(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return raw(out);
}

export const toString = (content) => part(content);

export function render(el, content) {
  el.innerHTML = part(content);
}

export function fragment(content) {
  const t = document.createElement('template');
  t.innerHTML = part(content);
  return t.content;
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined && method === 'GET' ? {} : { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    // 본문이 없는 응답
  }
  if (!res.ok) {
    const err = new Error(data.error || '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
    err.status = res.status;
    throw err;
  }
  return data;
}

export const post = (path, body) => api(path, { method: 'POST', body });

const clock = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' });
const day = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
export const fmtClock = (ts) => clock.format(ts);
export const fmtDay = (ts) => day.format(ts);

export function fmtAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return fmtDay(ts);
}
