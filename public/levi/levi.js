// 우측 하단 퀵메뉴와 토끼 챗봇 레비.
// 상담 연결 전에는 저장된 답변(자주 묻는 질문)으로 레비가 바로 답하고,
// [상담 연결]을 누르면 운영자와 1:1로 대화한다. 운영자 답장은 실시간(SSE)으로 받는다.
import {
  api, fmtClock, fmtDay, fragment, html, post, raw, render,
} from '../js/dom.js';
import { rabbitSvg } from './rabbit.js';

const MAX = 1000;
// 서버 없이 올리는 정적 버전(예: 카페24 스킨)은 페이지에 window.LEVI_STATIC = { welcome, hours, faqs, contactUrl }를 넣어 둔다.
// 이때 저장된 답변·키워드 찾기는 그대로 되고, [상담 연결]은 contactUrl(1:1 문의 게시판 등)로 안내한다.
// api 주소까지 넣으면 그 서버와 실시간 상담을 하고, 서버에 닿지 않을 때만 위의 정적 동작으로 바뀐다.
const STATIC = window.LEVI_STATIC || null;
const REMOTE = STATIC?.api ? String(STATIC.api).replace(/\/+$/, '') : '';
let offline = !!STATIC && !REMOTE;
const ALL = '전체';

// 다른 사이트에 붙은 경우 그 사이트 쿠키를 쓸 수 없어서, 서버가 준 손님 번호표를 이 브라우저에 보관한다.
const TOKEN_KEY = 'levi-visitor';
let visitorToken = '';
try { visitorToken = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* 저장소를 못 쓰면 새로고침 때 상담이 이어지지 않을 뿐 */ }

async function call(path, body) {
  if (!REMOTE) return body === undefined ? api(path) : post(path, body);
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (visitorToken) headers['x-levi-visitor'] = visitorToken;
  const res = await fetch(REMOTE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
  return data;
}

function keepToken(token) {
  if (!token) return;
  visitorToken = token;
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* 위와 같음 */ }
}

const state = {
  boot: null,
  open: false,
  online: false,
  thread: null,
  category: ALL,
  pending: null, // 레비가 답을 찾지 못한 마지막 질문. 상담을 연결하면 운영자에게 같이 넘긴다.
  stream: null,
  streamVisitor: false,
  liveKey: '',
  recoFor: null, // 종료 후 추천 질문을 이미 보여 준 상담 번호
  hintTimer: null,
};

const rabbit = (size, mood) => raw(rabbitSvg({ size, mood }));

const ICONS = {
  headset: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.500"/><rect x="17" y="14" width="4" height="6" rx="1.500"/><path d="M19 20a3 3 0 0 1-3 2h-2"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  cart: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.400 11h10.800L21 7H6.200"/><circle cx="9.500" cy="19.500" r="1.300"/><circle cx="17" cy="19.500" r="1.300"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
};

// 뼈대 ------------------------------------------------------------------------

const root = document.createElement('div');
root.className = 'levi-root';
render(root, html`
  <nav class="lq" aria-label="퀵메뉴">
    <button type="button" class="lq-levi" data-toggle aria-expanded="false" aria-controls="levi-panel">
      <span class="lq-face">${rabbit(50, 'happy')}</span>
      <span class="lq-label">레비 상담</span>
      <span class="lq-badge" data-badge hidden></span>
    </button>
    <a class="lq-item" href="#cart" data-cart-link>${raw(ICONS.cart)}<span>장바구니</span></a>
    <button type="button" class="lq-item" data-top>${raw(ICONS.up)}<span>TOP</span></button>
  </nav>
  <button type="button" class="lq-hint" data-hint hidden></button>
  <section id="levi-panel" class="levi" role="dialog" aria-label="레비 챗봇" aria-modal="false" hidden>
    <header class="levi-head">
      <span class="levi-head-face">${rabbit(42, 'happy')}</span>
      <div class="levi-head-text">
        <b>레비</b>
        <span class="levi-status" data-status>rebit 고객센터</span>
      </div>
      <button type="button" class="levi-x" data-close aria-label="레비 닫기">${raw(ICONS.close)}</button>
    </header>
    <div class="levi-log" data-log role="log" aria-live="polite" tabindex="0">
      <div data-bot></div>
      <div data-live></div>
      <div data-after></div>
    </div>
    <form class="levi-compose" data-form autocomplete="off">
      <label class="sr" for="levi-input">메시지</label>
      <textarea id="levi-input" data-input rows="2" maxlength="${MAX}" placeholder="레비에게 메시지 입력" enterkeyhint="send"></textarea>
      <div class="levi-tools">
        <button type="button" class="levi-connect" data-connect>${raw(ICONS.headset)}<span data-connect-label>상담 연결</span></button>
        <span class="levi-grow"></span>
        <button type="submit" class="levi-send" data-send disabled>전송</button>
      </div>
    </form>
  </section>`);
document.body.append(root);

const $ = (sel) => root.querySelector(sel);
const panel = $('#levi-panel');
const log = $('[data-log]');
const botBox = $('[data-bot]');
const liveBox = $('[data-live]');
const afterBox = $('[data-after]'); // 상담이 시작된 뒤의 레비 안내·답변은 상담 기록 아래에 쌓는다.
const input = $('[data-input]');
const sendBtn = $('[data-send]');
const connectBtn = $('[data-connect]');
const toggleBtn = $('[data-toggle]');
const badge = $('[data-badge]');
const hint = $('[data-hint]');

const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
const toBottom = () => { log.scrollTop = log.scrollHeight; };

// 말풍선 --------------------------------------------------------------------------

const botRow = (body, { extra = '', name = '레비', mood = 'happy', at = Date.now() } = {}) => html`
  <div class="lv-row lv-bot">
    <span class="lv-ava">${rabbit(36, mood)}</span>
    <div class="lv-col">
      <b class="lv-name">${name}</b>
      ${body ? html`<div class="lv-bubble">${body}</div>` : ''}
      ${extra}
      <time class="lv-time">${fmtClock(at)}</time>
    </div>
  </div>`;

const userRow = (body, at = Date.now()) => html`
  <div class="lv-row lv-me">
    <time class="lv-time">${fmtClock(at)}</time>
    <div class="lv-bubble">${body}</div>
  </div>`;

function appendBot(content) {
  (state.thread ? afterBox : botBox).append(fragment(content));
  requestAnimationFrame(toBottom);
}

const categories = () => [ALL, ...new Set(state.boot.faqs.map((f) => f.category))];

const cards = (faqs) => html`${faqs.map((f) => html`
  <article class="lv-card">
    <h4>${f.question}</h4>
    <p class="lv-path">[카테고리] ${f.path || f.category}</p>
    <button type="button" class="lv-card-btn" data-faq="${f.id}">답변보기</button>
  </article>`)}`;

// 카드를 가로로 넘겨 보는 묶음. withChips가 참이면 위에 분류 버튼을 단다.
const carousel = (faqs, { withChips = false } = {}) => html`
  <div class="lv-carousel" ${withChips ? raw('data-main') : ''}>
    ${withChips ? html`<div class="lv-chips" role="group" aria-label="질문 분류">${categories().map((c) => html`
      <button type="button" class="lv-chip" data-chip="${c}" aria-pressed="${c === state.category}">${c}</button>`)}</div>` : ''}
    <div class="lv-track-wrap">
      <button type="button" class="lv-nav lv-prev" data-slide="-1" aria-label="이전 질문">${raw(ICONS.prev)}</button>
      <div class="lv-track" data-track>${cards(faqs)}</div>
      <button type="button" class="lv-nav lv-next" data-slide="1" aria-label="다음 질문">${raw(ICONS.next)}</button>
    </div>
  </div>`;

function updateNav(wrap) {
  const track = wrap.querySelector('[data-track]');
  const max = track.scrollWidth - track.clientWidth - 2;
  wrap.querySelector('.lv-prev').hidden = track.scrollLeft <= 2;
  wrap.querySelector('.lv-next').hidden = track.scrollLeft >= max;
}

function wireTracks() {
  root.querySelectorAll('.lv-track-wrap').forEach((wrap) => {
    if (wrap.dataset.wired) return;
    wrap.dataset.wired = '1';
    const track = wrap.querySelector('[data-track]');
    track.addEventListener('scroll', () => updateNav(wrap), { passive: true });
    updateNav(wrap);
  });
}

// 저장된 답변 찾기 ----------------------------------------------------------------

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const PARTICLE = /(은|는|이|가|을|를|도|요|에|에서|으로|로|랑|하고|인가요|나요|까요|해요|어요|아요)$/;

function findAnswers(question) {
  const q = norm(question);
  const words = question.toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.replace(PARTICLE, ''))
    .filter((w) => w.length >= 2);
  return state.boot.faqs
    .map((f) => {
      let score = 0;
      for (const k of f.keywords.split(',')) if (k && q.includes(norm(k))) score += 3;
      const fq = norm(f.question);
      for (const w of words) if (fq.includes(w)) score += 1;
      return { f, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.f);
}

function botAnswer(question) {
  appendBot(userRow(question));
  if (/^(안녕|하이|헬로|hello|hi|ㅎㅇ)/i.test(question.trim())) {
    appendBot(botRow('안녕하세요! 궁금한 걸 편하게 물어봐 주세요. 🐰', { mood: 'wink' }));
    return;
  }
  const found = findAnswers(question);
  if (found.length) {
    state.pending = null;
    appendBot(botRow(`이런 답변을 찾았어요. 카드를 눌러 확인해 보세요!`, { extra: carousel(found), mood: 'happy' }));
  } else {
    state.pending = question;
    appendBot(botRow(offline
      ? '앗, 딱 맞는 답변을 찾지 못했어요.\n아래 버튼을 누르면 1:1 문의로 안내해 드릴게요.'
      : '앗, 딱 맞는 답변을 찾지 못했어요.\n아래 버튼을 누르면 상담원에게 지금 질문을 바로 전달할게요.', {
      mood: 'sweat',
      extra: html`<button type="button" class="lv-inline-connect" data-connect-inline>${raw(ICONS.headset)} 상담 연결하기</button>`,
    }));
  }
  wireTracks();
}

function showFaq(id) {
  const f = state.boot.faqs.find((x) => x.id === id);
  if (!f) return;
  appendBot(html`${userRow(f.question)}${botRow(f.answer, {
    extra: html`<p class="lv-after">더 궁금한 점이 있으면 아래 <b>상담 연결</b>을 눌러 주세요.</p>`,
  })}`);
  if (!offline) call(`/api/levi/faqs/${f.id}/view`, {}).catch(() => {});
}

// 상담 ------------------------------------------------------------------------

const connected = () => state.thread && state.thread.status !== 'closed';

function statusText() {
  if (connected()) return state.thread.status === 'open' ? '상담원과 대화 중' : (state.online ? '상담원 연결 중' : '상담원 부재 · 메시지를 남겨 주세요');
  return state.online ? '상담원 연결 가능' : 'rebit 고객센터';
}

function drawChrome() {
  $('[data-status]').textContent = statusText();
  $('[data-status]').classList.toggle('on', state.online);
  connectBtn.classList.toggle('active', !!connected());
  $('[data-connect-label]').textContent = connected() ? '상담 종료' : '상담 연결';
  input.placeholder = connected() ? '상담원에게 메시지 입력' : '레비에게 메시지 입력';
  sendBtn.disabled = !input.value.trim();
}

function liveRow(m) {
  if (m.from === 'system') return html`<p class="lv-system">${m.body}</p>`;
  if (m.from === 'visitor') return userRow(m.body, m.at);
  if (m.mood) return botRow('', { name: '레비 · 상담원', mood: 'happy', at: m.at, extra: html`<span class="lv-sticker">${rabbit(96, m.mood)}</span>` });
  return botRow(m.body, { name: '레비 · 상담원', at: m.at });
}

function drawLive() {
  const t = state.thread;
  const waitingNote = t && t.status === 'waiting'
    ? (state.online
      ? html`<p class="lv-system">상담원을 연결하고 있어요. 잠시만 기다려 주세요.</p>`
      : html`<div class="lv-away">${rabbit(40, 'sweat')}<p>${state.boot.away}<br><small>운영 시간 · ${state.boot.hours}</small></p></div>`)
    : '';
  const key = t ? `${t.id}:${t.status}:${t.messages.length}:${t.messages.at(-1)?.id}:${state.online}` : '';
  if (key === state.liveKey) return;
  const stick = nearBottom();
  state.liveKey = key;
  render(liveBox, t ? html`
    <div class="lv-divider"><span>${fmtDay(t.messages[0]?.at ?? Date.now())} 상담</span></div>
    ${t.messages.map(liveRow)}
    ${waitingNote}
    ${t.status === 'closed' ? html`<p class="lv-after center">다시 문의하려면 <b>상담 연결</b>을 눌러 주세요.</p>` : ''}` : '');
  if (stick) toBottom();
}

function setBadge(n) {
  badge.hidden = !n;
  badge.textContent = n > 9 ? '9+' : String(n);
}

function showHint(textValue) {
  hint.textContent = textValue;
  hint.hidden = false;
  clearTimeout(state.hintTimer);
  state.hintTimer = setTimeout(() => { hint.hidden = true; }, 8000);
}

async function markRead() {
  if (state.thread?.unread && state.open) {
    state.thread.unread = 0;
    setBadge(0);
    await call('/api/levi/read', {}).catch(() => {});
  }
}

// 지난 상담과 그 뒤의 레비 대화를 위쪽 기록으로 옮겨 고정한다. 새 상담은 그 아래에 이어서 그린다.
function freezeLive() {
  botBox.append(...liveBox.childNodes, ...afterBox.childNodes);
  liveBox.replaceChildren();
  state.liveKey = '';
}

// 상담이 끝나면 레비가 다시 자주 묻는 질문을 보여 준다. 이후 입력은 키워드로 답변을 찾는다.
function showRecommendAfterClose() {
  const t = state.thread;
  if (!t || t.status !== 'closed' || state.recoFor === t.id || !state.boot?.faqs.length) return;
  state.recoFor = t.id;
  appendBot(botRow('상담이 종료되었어요. 이용해 주셔서 고마워요!\n더 궁금한 점은 아래 질문을 눌러 보거나 직접 입력해 주세요.', {
    mood: 'love',
    extra: carousel(state.boot.faqs, { withChips: true }),
  }));
  wireTracks();
}

const HINTS = {
  idle: '레비: 답변이 없으면 상담이 곧 자동 종료돼요.',
  closed: '레비: 상담이 자동으로 종료되었어요.',
};

function applyThread(data, { reply = false, notice = '' } = {}) {
  state.online = data.online ?? state.online;
  const prevId = state.thread?.id;
  state.thread = data.thread;
  if (state.thread?.messages.length === 0) state.thread = null;
  // 새 상담이 시작됐거나, 끝난 상담이 서버 목록에서 빠졌을 때(종료 1시간 뒤) 지난 기록은 화면에 남겨 둔다.
  if (prevId && state.thread?.id !== prevId) freezeLive();
  drawLive();
  showRecommendAfterClose();
  drawChrome();
  if (state.open) markRead();
  else {
    setBadge(state.thread?.unread || 0);
    if (reply && state.thread?.unread) showHint(HINTS[notice] || '레비: 상담원 답변이 도착했어요!');
  }
}

async function refreshThread(opts) {
  try {
    applyThread(await call('/api/levi/thread'), opts);
  } catch {
    // 연결이 잠깐 끊긴 경우. 다음 알림에서 다시 받는다.
  }
}

function openStream() {
  if (offline) return;
  const hasVisitor = !!state.thread;
  if (state.stream && state.streamVisitor === hasVisitor) return;
  state.stream?.close();
  state.streamVisitor = hasVisitor;
  const es = new EventSource(`${REMOTE}/api/levi/stream${REMOTE && visitorToken ? `?v=${encodeURIComponent(visitorToken)}` : ''}`);
  state.stream = es;
  es.addEventListener('hello', (e) => {
    state.online = JSON.parse(e.data).online;
    refreshThread();
  });
  es.addEventListener('presence', (e) => {
    state.online = JSON.parse(e.data).online;
    drawLive();
    drawChrome();
  });
  es.addEventListener('thread', (e) => {
    const d = JSON.parse(e.data);
    refreshThread({ reply: !!d.reply, notice: d.notice || '' });
  });
}

function connectStatic() {
  const q = state.pending;
  state.pending = null;
  const guide = STATIC.contactText || '1:1 문의 게시판에 남겨 주시면 확인하는 대로 답변드릴게요.';
  appendBot(botRow(`실시간 상담은 준비 중이에요.\n${guide}${q ? `\n\n남기실 질문: ${q}` : ''}`, {
    mood: 'sweat',
    extra: STATIC.contactUrl ? html`<a class="lv-inline-connect" href="${STATIC.contactUrl}">${raw(ICONS.headset)} 1:1 문의 남기기</a>` : '',
  }));
}

async function connect() {
  if (offline) return connectStatic();
  connectBtn.disabled = true;
  try {
    const data = await call('/api/levi/connect', { first: state.pending || '', page: location.pathname });
    keepToken(data.visitorToken);
    const forwarded = state.pending;
    state.pending = null;
    applyThread(data);
    openStream();
    if (forwarded) appendBot(botRow('남겨 주신 질문을 상담원에게 전달했어요.', { mood: 'wink' }));
    input.focus();
  } catch (err) {
    appendBot(botRow(err.message, { mood: 'cry' }));
  } finally {
    connectBtn.disabled = false;
  }
}

async function endChat() {
  if (!window.confirm('상담을 종료할까요?')) return;
  await call('/api/levi/close', {}).catch(() => {});
  await refreshThread();
}

async function sendLive(textValue) {
  const data = await call('/api/levi/messages', { body: textValue });
  applyThread({ thread: data.thread });
}

// 열고 닫기 ---------------------------------------------------------------------

function setOpen(open) {
  state.open = open;
  panel.hidden = !open;
  root.classList.toggle('is-open', open);
  toggleBtn.setAttribute('aria-expanded', String(open));
  hint.hidden = true;
  if (open) {
    openStream();
    requestAnimationFrame(() => {
      wireTracks();
      root.querySelectorAll('.lv-track-wrap').forEach(updateNav);
      toBottom();
      if (window.matchMedia('(min-width: 720px)').matches) input.focus();
    });
    markRead();
  } else toggleBtn.focus();
}

// 이벤트 -------------------------------------------------------------------------

toggleBtn.addEventListener('click', () => setOpen(!state.open));
$('[data-close]').addEventListener('click', () => setOpen(false));
hint.addEventListener('click', () => setOpen(true));
$('[data-top]').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.open) setOpen(false);
});

connectBtn.addEventListener('click', () => (connected() ? endChat() : connect()));

input.addEventListener('input', () => { sendBtn.disabled = !input.value.trim(); });

async function submit() {
  const value = input.value.trim().slice(0, MAX);
  if (!value) return;
  input.value = '';
  sendBtn.disabled = true;
  if (!connected()) {
    botAnswer(value);
    return;
  }
  try {
    await sendLive(value);
  } catch (err) {
    if (!input.value) input.value = value;
    appendBot(botRow(err.message, { mood: 'cry' }));
    refreshThread();
  }
  drawChrome();
}

$('[data-form]').addEventListener('submit', (e) => {
  e.preventDefault();
  submit();
});

// 한글 조합 중 Enter는 글자를 확정하는 동작이라 보내지 않는다.
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    submit();
  }
});

log.addEventListener('click', (e) => {
  const faq = e.target.closest('[data-faq]');
  if (faq) return showFaq(Number(faq.dataset.faq));
  const chip = e.target.closest('[data-chip]');
  if (chip) {
    // 처음 인사와 상담 종료 뒤에 추천 카드 묶음이 여러 개 있을 수 있어서, 누른 버튼이 속한 묶음만 바꾼다.
    state.category = chip.dataset.chip;
    const main = chip.closest('[data-main]');
    main.querySelectorAll('[data-chip]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.chip === state.category)));
    const track = main.querySelector('[data-track]');
    render(track, cards(state.boot.faqs.filter((f) => state.category === ALL || f.category === state.category)));
    track.scrollLeft = 0;
    updateNav(main.querySelector('.lv-track-wrap'));
    return;
  }
  const slide = e.target.closest('[data-slide]');
  if (slide) {
    const track = slide.parentElement.querySelector('[data-track]');
    const card = track.querySelector('.lv-card');
    track.scrollBy({ left: Number(slide.dataset.slide) * ((card?.offsetWidth || 200) + 10), behavior: 'smooth' });
    return;
  }
  if (e.target.closest('[data-connect-inline]')) {
    if (connected()) input.focus();
    else connect();
  }
});

// 시작 ------------------------------------------------------------------------------

async function boot() {
  try {
    state.boot = offline ? { away: '', online: false, thread: null, ...STATIC } : await call('/api/levi/boot');
  } catch {
    // 상담 서버에 닿지 않으면 페이지에 넣어 둔 답변으로라도 동작한다.
    offline = !!STATIC;
    state.boot = {
      welcome: '안녕하세요, 레비예요!', away: '', hours: '', online: false, faqs: [], thread: null, ...(STATIC || {}),
    };
  }
  state.online = state.boot.online;
  appendBot(botRow(state.boot.welcome, {
    mood: 'happy',
    extra: state.boot.faqs.length ? html`<p class="lv-sub">많이 물어보시는 질문을 모아 뒀어요 👇</p>${carousel(state.boot.faqs, { withChips: true })}` : '',
  }));
  if (state.boot.hours) appendBot(html`<p class="lv-system">상담원 운영 시간 · ${state.boot.hours}</p>`);
  applyThread({ online: state.online, thread: state.boot.thread });
  if (state.thread) openStream();
  // 주소 끝에 #levi를 붙이면 레비 창이 열린 채로 시작한다. (링크 공유·배너용)
  if (location.hash === '#levi') setOpen(true);
  window.addEventListener('hashchange', () => { if (location.hash === '#levi' && !state.open) setOpen(true); });
}

boot();
