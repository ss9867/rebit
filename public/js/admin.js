// 운영자 화면: 상담 답장, 저장된 답변(자주 묻는 질문) 관리, 문구 설정, 계정 관리.
import {
  api, fmtAgo, fmtClock, fmtDay, fragment, html, post, raw, render,
} from './dom.js';
import { MOOD_LIST, rabbitSvg } from '../levi/rabbit.js';

const app = document.getElementById('app');
const rabbit = (size, mood = 'happy') => raw(rabbitSvg({ size, mood }));
const TITLE = '레비 상담 관리';

const state = {
  me: null,
  tab: 'chat',
  filter: 'active',
  threads: { items: [], unread: 0, waiting: 0 },
  currentId: null,
  faqs: [],
  stream: null,
  roomKey: '',
  opFilter: '', // 상담 목록을 이 운영자가 답한 것만 보기 ('' = 전체)
};

const STATUS = { waiting: ['대기', 'warn'], open: ['상담 중', 'ok'], closed: ['종료', ''] };

let toastTimer = null;
function toast(text, kind = '') {
  const el = document.querySelector('[data-toast]');
  el.textContent = text;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

const fail = (err) => {
  if (err.status === 401) return showLogin();
  toast(err.message, 'error');
};

// 로그인 ------------------------------------------------------------------------

function showLogin() {
  state.me = null;
  state.stream?.close();
  state.stream = null;
  document.title = TITLE;
  render(app, html`<main class="login">
    <form class="login-card" data-login>
      <div class="login-face">${rabbit(96, 'wink')}</div>
      <h1>레비 상담 관리</h1>
      <p class="muted">운영자 계정으로 로그인해 주세요.</p>
      <label>아이디<input name="loginId" autocomplete="username" required></label>
      <label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
      <p class="form-error" data-error hidden></p>
      <button class="btn primary block">로그인</button>
      <a class="muted small" href="/">← 쇼핑몰로 돌아가기</a>
    </form>
  </main>`);
  const form = app.querySelector('[data-login]');
  form.loginId.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = form.querySelector('[data-error]');
    try {
      const { operator } = await post('/api/admin/login', { loginId: form.loginId.value, password: form.password.value });
      state.me = operator;
      showShell();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
}

// 뼈대 ----------------------------------------------------------------------------

const TABS = [['chat', '상담'], ['faq', '저장된 답변'], ['settings', '안내 문구'], ['account', '계정']];

function showShell() {
  render(app, html`<div class="shell">
    <header class="top">
      <div class="brand">${rabbit(38)}<b>레비 상담 관리</b></div>
      <nav class="tabs" data-tabs aria-label="관리 메뉴">${TABS.map(([key, label]) => html`
        <button type="button" data-tab="${key}" aria-current="${key === state.tab ? 'page' : 'false'}">${label}${key === 'chat' ? html`<span class="badge" data-chat-badge hidden></span>` : ''}</button>`)}
      </nav>
      <div class="who">
        <span class="presence" title="상담 화면을 열어 두면 손님에게 '상담원 연결 가능'으로 보여요.">온라인</span>
        <span class="muted small">${state.me.name}</span>
        <a class="btn ghost sm" href="/" target="_blank" rel="noopener">쇼핑몰 보기</a>
        <button type="button" class="btn ghost sm" data-logout>로그아웃</button>
      </div>
    </header>
    <main class="view" data-view></main>
  </div>`);
  app.querySelector('[data-tabs]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) switchTab(b.dataset.tab);
  });
  app.querySelector('[data-logout]').addEventListener('click', async () => {
    await post('/api/admin/logout').catch(() => {});
    showLogin();
  });
  openStream();
  switchTab(state.tab);
}

function switchTab(tab) {
  state.tab = tab;
  app.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  const view = app.querySelector('[data-view]');
  ({
    chat: showChat, faq: showFaqs, settings: showSettings, account: showAccount,
  })[tab](view);
}

function openStream() {
  state.stream?.close();
  const es = new EventSource('/api/admin/stream');
  state.stream = es;
  es.addEventListener('hello', () => refreshThreads());
  es.addEventListener('threads', (e) => {
    const data = JSON.parse(e.data);
    if (data.fresh) toast('새 상담이 연결되었어요!', 'pink');
    refreshThreads();
    if (state.tab === 'chat' && state.currentId && (!data.id || data.id === state.currentId)) loadRoom(state.currentId);
  });
  es.onerror = () => {
    // 로그인이 풀려 401이 나면 EventSource가 멈춘다. 그때는 로그인 화면으로 보낸다.
    if (es.readyState === EventSource.CLOSED) api('/api/admin/me').then(({ operator }) => { if (!operator) showLogin(); }).catch(() => {});
  };
}

function drawBadge() {
  const badge = app.querySelector('[data-chat-badge]');
  const n = state.threads.unread;
  if (badge) {
    badge.hidden = !n;
    badge.textContent = n > 99 ? '99+' : String(n);
  }
  document.title = n ? `(${n}) ${TITLE}` : TITLE;
}

// 상담 ----------------------------------------------------------------------------

function showChat(view) {
  state.roomKey = '';
  render(view, html`<div class="chat-layout ${state.currentId ? 'has-room' : ''}" data-chat>
    <aside class="threads">
      <div class="seg" role="tablist">
        <button type="button" role="tab" data-filter="active" aria-selected="${state.filter === 'active'}">진행 중</button>
        <button type="button" role="tab" data-filter="closed" aria-selected="${state.filter === 'closed'}">종료</button>
      </div>
      <label class="op-filter"><span class="sr">담당 운영자</span>
        <select data-op-filter><option value="">모든 운영자의 상담</option></select>
      </label>
      <div class="thread-list" data-list><p class="empty">불러오는 중…</p></div>
    </aside>
    <section class="room" data-room></section>
  </div>`);
  view.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    state.filter = b.dataset.filter;
    view.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    refreshThreads();
  });
  // 운영자별로 상담 모아 보기. 목록은 열 때마다 새로 받아 추가·이름 변경이 바로 반영되게 한다.
  const opFilter = view.querySelector('[data-op-filter]');
  api('/api/admin/operators').then(({ items }) => {
    opFilter.append(fragment(html`${items.map((o) => html`<option value="${o.id}">${o.name}${o.id === state.me.id ? ' (나)' : ''} 님이 답한 상담</option>`)}`));
    opFilter.value = state.opFilter;
    if (opFilter.value !== state.opFilter) { state.opFilter = ''; refreshThreads(); }
  }).catch(() => {});
  opFilter.addEventListener('change', () => {
    state.opFilter = opFilter.value;
    refreshThreads();
  });
  view.querySelector('[data-list]').addEventListener('click', (e) => {
    const row = e.target.closest('[data-thread]');
    if (row) openRoom(Number(row.dataset.thread));
  });
  if (state.currentId) openRoom(state.currentId);
  else drawEmptyRoom();
  refreshThreads();
}

function drawEmptyRoom() {
  const room = app.querySelector('[data-room]');
  if (!room) return;
  render(room, html`<div class="room-empty">${rabbit(110, 'normal')}<p>왼쪽 목록에서 상담을 골라 주세요.</p>
    <p class="muted small">이 화면을 열어 두는 동안 손님에게는 <b>상담원 연결 가능</b>으로 표시돼요.</p></div>`);
}

async function refreshThreads() {
  try {
    const q = new URLSearchParams({ status: state.filter === 'closed' ? 'closed' : 'active' });
    if (state.opFilter) q.set('operator', state.opFilter);
    state.threads = await api(`/api/admin/threads?${q}`);
  } catch (err) {
    fail(err);
    return;
  }
  drawBadge();
  const list = app.querySelector('[data-list]');
  if (!list) return;
  const { items } = state.threads;
  render(list, items.length ? html`${items.map((t) => html`
    <button type="button" class="thread ${t.id === state.currentId ? 'active' : ''}" data-thread="${t.id}">
      <span class="thread-top">
        <b>${t.label}</b>
        <span class="tag ${STATUS[t.status][1]}">${STATUS[t.status][0]}</span>
        <span class="grow"></span>
        ${t.unread ? html`<span class="badge">${t.unread > 99 ? '99+' : t.unread}</span>` : ''}
      </span>
      <span class="thread-last">${t.lastFrom === 'operator' ? '레비: ' : ''}${t.last}</span>
      <span class="thread-time">${t.handlers.length ? html`<span class="handlers">담당 ${t.handlers.join(', ')}</span> · ` : ''}${fmtAgo(t.lastAt)}</span>
    </button>`)}`
    : html`<p class="empty">${state.opFilter ? '이 운영자가 답한 상담이 없어요.' : state.filter === 'closed' ? '종료된 상담이 없어요.' : '진행 중인 상담이 없어요.'}</p>`);
}

const stickerTray = () => html`${MOOD_LIST.map(([mood, label]) => html`
  <button type="button" class="sticker-btn" data-mood="${mood}" title="${label}" aria-label="${label} 이모티콘 보내기">${rabbit(52, mood)}</button>`)}`;

function openRoom(id) {
  state.currentId = id;
  state.roomKey = '';
  app.querySelector('[data-chat]')?.classList.add('has-room');
  app.querySelectorAll('[data-thread]').forEach((b) => b.classList.toggle('active', Number(b.dataset.thread) === id));
  const room = app.querySelector('[data-room]');
  render(room, html`
    <header class="room-head">
      <button type="button" class="icon-btn back" data-back aria-label="목록으로">←</button>
      <div class="grow" data-room-title></div>
      <button type="button" class="btn ghost sm" data-close-thread hidden>상담 종료</button>
    </header>
    <div class="log" data-log role="log" aria-live="polite" tabindex="0"><p class="empty">불러오는 중…</p></div>
    <div class="tray" data-tray hidden>${stickerTray()}</div>
    <div class="quick" data-quick hidden>
      <input type="search" data-quick-search placeholder="저장된 답변 검색" aria-label="저장된 답변 검색">
      <div class="quick-list" data-quick-list></div>
    </div>
    <form class="composer" data-composer autocomplete="off">
      <div class="composer-tools">
        <button type="button" class="tool" data-toggle="tray" aria-expanded="false">${rabbit(22)} 이모티콘</button>
        <button type="button" class="tool" data-toggle="quick" aria-expanded="false">📋 저장된 답변 넣기</button>
      </div>
      <div class="composer-row">
        <label class="sr" for="reply">답장</label>
        <textarea id="reply" data-input rows="2" maxlength="1000" placeholder="레비로 답장하기 (Enter 전송, Shift+Enter 줄바꿈)"></textarea>
        <button class="btn primary">보내기</button>
      </div>
    </form>`);

  const input = room.querySelector('[data-input]');
  const form = room.querySelector('[data-composer]');
  const panels = { tray: room.querySelector('[data-tray]'), quick: room.querySelector('[data-quick]') };
  const togglePanel = (name, show) => {
    Object.entries(panels).forEach(([key, el]) => {
      const on = key === name ? (show ?? el.hidden) : false;
      el.hidden = !on;
      room.querySelector(`[data-toggle="${key}"]`).setAttribute('aria-expanded', String(on));
    });
    if (name === 'quick' && !panels.quick.hidden) {
      drawQuick('');
      room.querySelector('[data-quick-search]').focus();
    }
  };

  room.querySelector('[data-back]').addEventListener('click', () => {
    state.currentId = null;
    app.querySelector('[data-chat]')?.classList.remove('has-room');
    drawEmptyRoom();
    refreshThreads();
  });
  room.querySelector('[data-close-thread]').addEventListener('click', async () => {
    if (!window.confirm('이 상담을 종료할까요? 손님 화면에도 종료 안내가 표시됩니다.')) return;
    try {
      await post(`/api/admin/threads/${id}/close`);
      toast('상담을 종료했어요.');
    } catch (err) { fail(err); }
  });
  room.querySelector('.composer-tools').addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle]');
    if (t) togglePanel(t.dataset.toggle);
  });

  const send = async (payload) => {
    try {
      await post(`/api/admin/threads/${id}/messages`, payload);
      await loadRoom(id);
    } catch (err) {
      fail(err);
      return false;
    }
    return true;
  };

  panels.tray.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mood]');
    if (!b) return;
    togglePanel('tray', false);
    await send({ mood: b.dataset.mood });
  });

  // 저장된 답변을 입력창에 넣어 고친 뒤 보낼 수 있다.
  const quickList = room.querySelector('[data-quick-list]');
  const drawQuick = async (q) => {
    if (!state.faqs.length) {
      try { state.faqs = (await api('/api/admin/faqs')).items; } catch (err) { fail(err); return; }
    }
    const query = q.trim().toLowerCase();
    const found = state.faqs.filter((f) => !query || `${f.category} ${f.question} ${f.answer} ${f.keywords}`.toLowerCase().includes(query));
    render(quickList, found.length ? html`${found.map((f) => html`
      <button type="button" class="quick-item" data-use="${f.id}"><span class="tag">${f.category}</span><b>${f.question}</b><span class="muted">${f.answer}</span></button>`)}`
      : html`<p class="empty">찾는 답변이 없어요.</p>`);
  };
  room.querySelector('[data-quick-search]').addEventListener('input', (e) => drawQuick(e.target.value));
  quickList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-use]');
    if (!b) return;
    const f = state.faqs.find((x) => x.id === Number(b.dataset.use));
    input.value = input.value ? `${input.value}\n${f.answer}` : f.answer;
    togglePanel('quick', false);
    input.focus();
  });

  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (!(await send({ body: text })) && !input.value) input.value = text;
    input.focus();
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      submit();
    }
  });

  loadRoom(id);
}

function roomMessage(m) {
  // 운영자 이름은 이 화면에서만 보인다. 손님에게는 모두 '레비'로 나간다.
  if (m.from === 'system') return html`<p class="sys">${m.body}${m.operatorName ? html` <span class="op-name">(${m.operatorName})</span>` : ''} · ${fmtClock(m.at)}</p>`;
  const mine = m.from === 'operator';
  const self = mine && m.operatorId === state.me.id;
  return html`<div class="msg ${mine ? 'mine' : ''}">
    <span class="msg-meta">${mine ? html`레비 · <b class="op-name">${m.operatorName || '상담원'}${self ? ' (나)' : ''}</b>` : '손님'} · ${fmtClock(m.at)}</span>
    ${m.mood ? html`<span class="sticker">${rabbit(88, m.mood)}</span>` : html`<span class="bubble">${m.body}</span>`}
  </div>`;
}

async function loadRoom(id) {
  let data;
  try {
    data = await api(`/api/admin/threads/${id}`);
  } catch (err) {
    if (err.status === 404) {
      state.currentId = null;
      drawEmptyRoom();
      return;
    }
    fail(err);
    return;
  }
  if (state.currentId !== id || !app.querySelector('[data-log]')) return;
  const { thread, messages } = data;
  const [label, cls] = STATUS[thread.status];
  render(app.querySelector('[data-room-title]'), html`<b>${thread.label}</b> <span class="tag ${cls}">${label}</span>
    <span class="muted small">${fmtDay(thread.createdAt)} 시작${thread.page ? ` · ${thread.page}에서 연결` : ''}${thread.pastCount ? ` · 지난 상담 ${thread.pastCount}건` : ''}${thread.handlers.length ? ` · 담당 ${thread.handlers.join(', ')}` : ''}</span>`);
  const closed = thread.status === 'closed';
  app.querySelector('[data-close-thread]').hidden = closed;
  app.querySelector('[data-composer]').hidden = closed;
  if (closed) app.querySelectorAll('[data-tray], [data-quick]').forEach((el) => { el.hidden = true; });

  const key = `${messages.length}:${messages.at(-1)?.id}:${thread.status}`;
  if (key !== state.roomKey) {
    const log = app.querySelector('[data-log]');
    const stick = !state.roomKey || log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    state.roomKey = key;
    render(log, html`${messages.map(roomMessage)}${closed ? html`<p class="sys">종료된 상담이라 답장할 수 없어요.</p>` : ''}`);
    if (stick) log.scrollTop = log.scrollHeight;
  }
  if (thread.unread) {
    await post(`/api/admin/threads/${id}/read`).catch(() => {});
  }
}

// 저장된 답변 -------------------------------------------------------------------------

async function loadFaqs() {
  state.faqs = (await api('/api/admin/faqs')).items;
}

async function showFaqs(view) {
  render(view, html`<div class="faq-layout">
    <section class="panel">
      <div class="panel-head">
        <div><h2>저장된 답변</h2><p class="muted small">손님이 레비 창에서 카드로 보고 [답변보기]로 바로 확인하는 질문이에요. 키워드는 손님이 직접 입력한 질문에 레비가 답을 찾을 때 씁니다.</p></div>
        <button type="button" class="btn primary" data-new>+ 새 답변</button>
      </div>
      <div data-faq-list><p class="empty">불러오는 중…</p></div>
    </section>
    <section class="panel editor" data-editor hidden></section>
  </div>`);
  view.querySelector('[data-new]').addEventListener('click', () => openEditor(null));
  view.querySelector('[data-faq-list]').addEventListener('click', onFaqListClick);
  try {
    await loadFaqs();
    drawFaqList();
  } catch (err) { fail(err); }
}

function drawFaqList() {
  const list = app.querySelector('[data-faq-list]');
  if (!list) return;
  render(list, state.faqs.length ? html`<ol class="faq-list">${state.faqs.map((f, i) => html`
    <li class="faq-row ${f.visible ? '' : 'off'}">
      <div class="faq-order">
        <button type="button" class="icon-btn" data-move="up" data-id="${f.id}" aria-label="위로" ${i === 0 ? raw('disabled') : ''}>▲</button>
        <button type="button" class="icon-btn" data-move="down" data-id="${f.id}" aria-label="아래로" ${i === state.faqs.length - 1 ? raw('disabled') : ''}>▼</button>
      </div>
      <div class="faq-main">
        <p class="faq-q"><span class="tag">${f.category}</span> ${f.question}</p>
        <p class="muted small">[카테고리] ${f.path || f.category} · 조회 ${f.views}${f.visible ? '' : ' · 숨김'}</p>
      </div>
      <div class="faq-actions">
        <button type="button" class="btn ghost sm" data-edit="${f.id}">수정</button>
        <button type="button" class="btn ghost sm danger" data-del="${f.id}">삭제</button>
      </div>
    </li>`)}</ol>` : html`<p class="empty">저장된 답변이 없어요. [+ 새 답변]으로 추가해 주세요.</p>`);
}

async function onFaqListClick(e) {
  const move = e.target.closest('[data-move]');
  const edit = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  try {
    if (move) {
      await post(`/api/admin/faqs/${move.dataset.id}/move`, { dir: move.dataset.move });
      await loadFaqs();
      drawFaqList();
    } else if (edit) {
      openEditor(state.faqs.find((f) => f.id === Number(edit.dataset.edit)));
    } else if (del) {
      const f = state.faqs.find((x) => x.id === Number(del.dataset.del));
      if (!window.confirm(`"${f.question}" 답변을 삭제할까요?`)) return;
      await api(`/api/admin/faqs/${f.id}`, { method: 'DELETE', body: {} });
      toast('삭제했어요.');
      await loadFaqs();
      drawFaqList();
      const editor = app.querySelector('[data-editor]');
      if (editor && Number(editor.dataset.id) === f.id) editor.hidden = true;
    }
  } catch (err) { fail(err); }
}

function openEditor(faq) {
  const editor = app.querySelector('[data-editor]');
  editor.hidden = false;
  editor.dataset.id = faq?.id || '';
  const cats = [...new Set(state.faqs.map((f) => f.category))];
  render(editor, html`<form data-faq-form>
    <div class="panel-head"><h2>${faq ? '답변 수정' : '새 답변'}</h2><button type="button" class="icon-btn" data-cancel aria-label="닫기">✕</button></div>
    <div class="grid2">
      <label>분류<input name="category" list="cat-list" maxlength="20" required value="${faq?.category || ''}" placeholder="예: 배송"></label>
      <datalist id="cat-list">${cats.map((c) => html`<option value="${c}">`)}</datalist>
      <label>카드에 보일 경로<input name="path" maxlength="80" value="${faq?.path || ''}" placeholder="예: 배송 > 배송 조회"></label>
    </div>
    <label>질문<input name="question" maxlength="120" required value="${faq?.question || ''}" placeholder="손님이 카드에서 보는 질문"></label>
    <label>답변<textarea name="answer" rows="7" maxlength="2000" required placeholder="[답변보기]를 누르면 레비가 보여 주는 내용">${faq?.answer || ''}</textarea></label>
    <label>키워드 <span class="muted small">쉼표로 구분 · 손님이 이 단어를 입력하면 이 답변을 추천해요</span><input name="keywords" maxlength="300" value="${faq?.keywords || ''}" placeholder="배송비, 무료배송, 택배비"></label>
    <label class="check"><input type="checkbox" name="visible" ${faq?.visible === false ? '' : raw('checked')}> 손님에게 보이기</label>
    <div class="preview">
      <p class="muted small">미리보기</p>
      <article class="pv-card" data-preview></article>
    </div>
    <div class="row-end">
      <button type="button" class="btn ghost" data-cancel>취소</button>
      <button class="btn primary">${faq ? '저장' : '추가'}</button>
    </div>
  </form>`);
  const form = editor.querySelector('[data-faq-form]');
  const preview = () => render(editor.querySelector('[data-preview]'), html`
    <h4>${form.question.value || '질문을 입력해 주세요'}</h4>
    <p>[카테고리] ${form.path.value || form.category.value || '분류'}</p>
    <span>답변보기</span>`);
  form.addEventListener('input', preview);
  preview();
  editor.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => { editor.hidden = true; }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      category: form.category.value,
      path: form.path.value,
      question: form.question.value,
      answer: form.answer.value,
      keywords: form.keywords.value,
      visible: form.visible.checked,
    };
    try {
      if (faq) await api(`/api/admin/faqs/${faq.id}`, { method: 'PUT', body });
      else await post('/api/admin/faqs', body);
      toast(faq ? '저장했어요.' : '추가했어요.');
      editor.hidden = true;
      await loadFaqs();
      drawFaqList();
    } catch (err) { fail(err); }
  });
  form.question.focus();
  if (window.matchMedia('(max-width: 900px)').matches) editor.scrollIntoView({ behavior: 'smooth' });
}

// 안내 문구 ----------------------------------------------------------------------------

async function showSettings(view) {
  let s;
  try { s = await api('/api/admin/settings'); } catch (err) { fail(err); return; }
  render(view, html`<section class="panel narrow">
    <div class="panel-head"><div><h2>안내 문구</h2><p class="muted small">레비 창에서 손님에게 보이는 문구예요.</p></div></div>
    <form data-settings>
      <label>첫 인사<textarea name="welcome" rows="4" maxlength="600" required>${s.welcome}</textarea></label>
      <label>상담원 부재 안내 <span class="muted small">상담 화면을 연 운영자가 없을 때 보여요</span><textarea name="away" rows="3" maxlength="300" required>${s.away}</textarea></label>
      <label>운영 시간<input name="hours" maxlength="120" required value="${s.hours}"></label>
      <div class="row-end"><button class="btn primary">저장</button></div>
    </form>
  </section>`);
  const form = view.querySelector('[data-settings]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/settings', { method: 'PUT', body: { welcome: form.welcome.value, away: form.away.value, hours: form.hours.value } });
      toast('저장했어요. 손님이 레비 창을 새로 열면 반영돼요.');
    } catch (err) { fail(err); }
  });
}

// 계정 ------------------------------------------------------------------------------

async function showAccount(view) {
  let ops;
  try { ops = (await api('/api/admin/operators')).items; } catch (err) { fail(err); return; }
  render(view, html`<div class="account">
    <section class="panel">
      <div class="panel-head"><h2>내 비밀번호 바꾸기</h2></div>
      <form data-pw>
        <label>현재 비밀번호<input type="password" name="current" autocomplete="current-password" required></label>
        <label>새 비밀번호 <span class="muted small">8자 이상</span><input type="password" name="next" autocomplete="new-password" minlength="8" required></label>
        <div class="row-end"><button class="btn primary">변경</button></div>
      </form>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>운영자 계정</h2></div>
      <p class="muted small">이름은 운영 화면에서 누가 상담했는지 구분하는 데만 쓰여요. 손님에게는 모두 <b>레비</b>로 보여요.</p>
      <ul class="ops">${ops.map((o) => html`<li><b>${o.name}</b> <span class="muted">${o.loginId}</span>
        ${o.id === state.me.id ? html`<span class="tag ok">나</span>` : ''}<span class="grow"></span>
        <button type="button" class="btn ghost sm" data-op-chats="${o.id}" title="이 운영자가 답한 상담 보기">상담 ${o.handled}건</button>
        <button type="button" class="btn ghost sm" data-rename-op="${o.id}" data-name="${o.name}">이름 변경</button>
        ${o.id === state.me.id ? '' : html`<button type="button" class="btn ghost sm danger" data-del-op="${o.id}" data-name="${o.name}">삭제</button>`}</li>`)}</ul>
      <form data-op class="add-op">
        <h3>운영자 추가</h3>
        <div class="grid2">
          <label>아이디<input name="loginId" pattern="[a-zA-Z0-9_.\\-]{3,30}" required placeholder="영문·숫자 3~30자"></label>
          <label>이름<input name="name" maxlength="30" required placeholder="상담원 이름"></label>
        </div>
        <label>임시 비밀번호<input name="password" type="text" minlength="8" required autocomplete="off"></label>
        <div class="row-end"><button class="btn primary">추가</button></div>
      </form>
    </section>
  </div>`);
  const pw = view.querySelector('[data-pw]');
  pw.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await post('/api/admin/password', { current: pw.current.value, next: pw.next.value });
      pw.reset();
      toast('비밀번호를 바꿨어요.');
    } catch (err) { fail(err); }
  });
  const opForm = view.querySelector('[data-op]');
  opForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await post('/api/admin/operators', { loginId: opForm.loginId.value, name: opForm.name.value, password: opForm.password.value });
      toast('운영자를 추가했어요.');
      showAccount(view);
    } catch (err) { fail(err); }
  });
  view.querySelector('.ops').addEventListener('click', async (e) => {
    const chats = e.target.closest('[data-op-chats]');
    if (chats) {
      state.opFilter = chats.dataset.opChats;
      state.filter = 'closed';
      state.currentId = null;
      switchTab('chat');
      return;
    }
    const rename = e.target.closest('[data-rename-op]');
    if (rename) {
      const name = window.prompt('새 이름 (운영 화면에만 보여요)', rename.dataset.name)?.trim();
      if (!name || name === rename.dataset.name) return;
      try {
        await api(`/api/admin/operators/${rename.dataset.renameOp}`, { method: 'PUT', body: { name } });
        if (Number(rename.dataset.renameOp) === state.me.id) {
          state.me.name = name;
          const meName = app.querySelector('.who .muted');
          if (meName) meName.textContent = name;
        }
        toast('이름을 바꿨어요.');
        showAccount(view);
      } catch (err) { fail(err); }
      return;
    }
    const b = e.target.closest('[data-del-op]');
    if (!b || !window.confirm(`${b.dataset.name} 계정을 삭제할까요?`)) return;
    try {
      await api(`/api/admin/operators/${b.dataset.delOp}`, { method: 'DELETE', body: {} });
      showAccount(view);
    } catch (err) { fail(err); }
  });
}

// 시작 -------------------------------------------------------------------------------

api('/api/admin/me').then(({ operator }) => {
  if (!operator) return showLogin();
  state.me = operator;
  return showShell();
}).catch(() => showLogin());
