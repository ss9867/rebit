// 가상 쇼핑몰 메인 화면. 상품 사진 대신 간단한 일러스트를 그려 넣는다.
import { html, raw, render } from './dom.js';
import { rabbitSvg } from '../levi/rabbit.js';

const ART = {
  mug: (c) => `<rect x="62" y="70" width="64" height="72" rx="10" fill="${c}"/><path d="M126 86h10a16 16 0 010 32h-10" fill="none" stroke="${c}" stroke-width="9"/><ellipse cx="94" cy="72" rx="32" ry="7" fill="#fff" opacity=".55"/><path d="M84 52q6-8 0-16M100 54q6-8 0-16" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/>`,
  candle: (c) => `<rect x="66" y="78" width="68" height="70" rx="12" fill="${c}"/><rect x="66" y="98" width="68" height="22" fill="#fff" opacity=".45"/><path d="M100 78v-12" stroke="#5a4650" stroke-width="3"/><path d="M100 40c8 10 9 17 0 25-9-8-8-15 0-25z" fill="#ffb347"/>`,
  cushion: (c) => `<path d="M48 64q52-14 104 0q10 36 0 72q-52 14-104 0q-10-36 0-72z" fill="${c}"/><circle cx="100" cy="100" r="5" fill="#fff" opacity=".7"/><path d="M60 72q40 28 80 0M60 128q40-28 80 0" fill="none" stroke="#fff" stroke-width="2" opacity=".35"/>`,
  tote: (c) => `<path d="M76 74v-12a24 24 0 0148 0v12" fill="none" stroke="#6b5862" stroke-width="5"/><path d="M56 74h88l-8 78H64z" fill="${c}"/><circle cx="100" cy="112" r="14" fill="#fff" opacity=".6"/>`,
  plant: (c) => `<path d="M74 112h52l-6 40H80z" fill="#d79b7a"/><path d="M100 112c-2-24-20-34-34-34 2 20 14 30 34 34zM100 112c2-30 18-46 36-48-2 24-16 40-36 48zM100 112c0-20-4-38-10-50 10 10 14 30 10 50z" fill="${c}"/>`,
  blanket: (c) => `<rect x="50" y="62" width="100" height="78" rx="14" fill="${c}"/><path d="M50 84h100M50 106h100M50 128h100" stroke="#fff" stroke-width="5" opacity=".4"/><path d="M58 140v10M74 140v10M90 140v10M106 140v10M122 140v10M138 140v10" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`,
  notebook: (c) => `<rect x="62" y="52" width="76" height="98" rx="8" fill="${c}"/><rect x="62" y="52" width="14" height="98" rx="4" fill="#000" opacity=".1"/><rect x="88" y="74" width="38" height="18" rx="4" fill="#fff" opacity=".75"/>`,
  slipper: (c) => `<ellipse cx="80" cy="112" rx="22" ry="40" fill="${c}"/><path d="M58 104a22 22 0 0144 0v8H58z" fill="#fff" opacity=".55"/><ellipse cx="124" cy="104" rx="22" ry="40" fill="${c}"/><path d="M102 96a22 22 0 0144 0v8h-44z" fill="#fff" opacity=".55"/>`,
  plate: (c) => `<circle cx="100" cy="102" r="50" fill="#fff"/><circle cx="100" cy="102" r="50" fill="none" stroke="${c}" stroke-width="7"/><circle cx="100" cy="102" r="32" fill="none" stroke="${c}" stroke-width="2" opacity=".5"/>`,
  lamp: (c) => `<path d="M72 92l14-40h28l14 40z" fill="${c}"/><rect x="96" y="92" width="8" height="44" fill="#8a7680"/><rect x="76" y="136" width="48" height="10" rx="5" fill="#8a7680"/><ellipse cx="100" cy="96" rx="34" ry="6" fill="#ffe9a8" opacity=".6"/>`,
};

const art = (kind, bg, color) => raw(`<svg viewBox="0 0 200 200" aria-hidden="true" preserveAspectRatio="xMidYMid slice"><rect width="200" height="200" fill="${bg}"/>${ART[kind](color)}</svg>`);

const PRODUCTS = [
  { id: 1, name: '레비 에디션 스톤웨어 머그 350ml', kind: 'mug', bg: '#ffe7ee', color: '#ff8fab', price: 18000, sale: 15, rating: 4.9, reviews: 1284, tag: 'living', badge: 'BEST' },
  { id: 2, name: '코튼 와플 블랭킷 (아이보리)', kind: 'blanket', bg: '#f3eee6', color: '#d8c3a5', price: 59000, sale: 30, rating: 4.8, reviews: 842, tag: 'fabric', badge: 'SALE' },
  { id: 3, name: '우드윅 소이 캔들 · 체리블라썸', kind: 'candle', bg: '#fbe9e4', color: '#f4a6a0', price: 32000, sale: 0, rating: 4.9, reviews: 611, tag: 'living' },
  { id: 4, name: '구름 패브릭 쿠션 45×45', kind: 'cushion', bg: '#e8f1fb', color: '#a8c8ec', price: 29000, sale: 10, rating: 4.7, reviews: 529, tag: 'fabric' },
  { id: 5, name: '데일리 캔버스 토트백', kind: 'tote', bg: '#eef4e9', color: '#9cc29a', price: 24000, sale: 0, rating: 4.6, reviews: 377, tag: 'living', badge: 'NEW' },
  { id: 6, name: '미니 몬스테라 + 테라코타 화분', kind: 'plant', bg: '#edf5ee', color: '#5fae7a', price: 21000, sale: 20, rating: 4.8, reviews: 298, tag: 'living' },
  { id: 7, name: '레비 하드커버 위클리 노트', kind: 'notebook', bg: '#fff3dc', color: '#f6bd60', price: 12000, sale: 0, rating: 4.9, reviews: 455, tag: 'stationery' },
  { id: 8, name: '포근 털 실내화', kind: 'slipper', bg: '#f6ecf7', color: '#cfa5d6', price: 19000, sale: 25, rating: 4.7, reviews: 690, tag: 'fabric' },
  { id: 9, name: '림 라인 디저트 접시 2P', kind: 'plate', bg: '#eaf2f6', color: '#8fb8cf', price: 22000, sale: 0, rating: 4.8, reviews: 112, tag: 'kitchen', badge: 'NEW' },
  { id: 10, name: '버섯 무드등 (충전식)', kind: 'lamp', bg: '#fff1e2', color: '#f2a65a', price: 34000, sale: 15, rating: 4.9, reviews: 87, tag: 'living', badge: 'NEW' },
  { id: 11, name: '레비 에디션 머그 · 민트', kind: 'mug', bg: '#e5f6f1', color: '#7ccbb6', price: 18000, sale: 0, rating: 4.8, reviews: 64, tag: 'kitchen', badge: 'NEW' },
  { id: 12, name: '체크 패턴 미니 쿠션', kind: 'cushion', bg: '#fdf0e6', color: '#f3b58a', price: 16000, sale: 0, rating: 4.6, reviews: 41, tag: 'fabric', badge: 'NEW' },
];

const BEST_TABS = [['all', '전체'], ['living', '리빙'], ['fabric', '패브릭'], ['kitchen', '키친'], ['stationery', '문구']];

const SLIDES = [
  { eyebrow: 'WINTER LIVING', title: '포근함을 들이는 계절,\n겨울 리빙 컬렉션', desc: '블랭킷·캔들·무드등 최대 30% 할인', bg: 'linear-gradient(120deg,#ffd9e3,#ffeef2 55%,#fff6e9)', kind: 'blanket', color: '#ff9fb6' },
  { eyebrow: 'REBIT ORIGINAL', title: '레비 에디션\n머그 컬렉션 출시', desc: '하나하나 손으로 그린 토끼 일러스트', bg: 'linear-gradient(120deg,#dff3ec,#f0faf6 55%,#fff9ec)', kind: 'mug', color: '#7ccbb6' },
  { eyebrow: 'NEW MEMBER', title: '첫 구매라면\n10% 할인 쿠폰부터', desc: '가입 즉시 발급 · 5만원 이상 무료배송', bg: 'linear-gradient(120deg,#e4ecfb,#f3f6fe 55%,#fdf2f7)', kind: 'tote', color: '#93b3e6' },
];

const CATS = [
  ['living', '리빙', 'lamp', '#fff1e2', '#f2a65a'],
  ['kitchen', '키친', 'plate', '#eaf2f6', '#8fb8cf'],
  ['fabric', '패브릭', 'cushion', '#e8f1fb', '#a8c8ec'],
  ['candle', '캔들·향', 'candle', '#fbe9e4', '#f4a6a0'],
  ['plant', '플랜트', 'plant', '#edf5ee', '#5fae7a'],
  ['stationery', '문구', 'notebook', '#fff3dc', '#f6bd60'],
  ['bag', '가방', 'tote', '#eef4e9', '#9cc29a'],
  ['home', '홈웨어', 'slipper', '#f6ecf7', '#cfa5d6'],
];

const REVIEWS = [
  { name: 'ha***', item: '레비 에디션 스톤웨어 머그', text: '토끼 그림이 너무 귀여워서 출근할 때마다 기분이 좋아요. 무게감도 적당하고 전자레인지도 돼요!', rating: 5 },
  { name: 'jy***', item: '코튼 와플 블랭킷', text: '세탁하고 나니 더 부드러워졌어요. 소파에 두니까 거실 분위기가 확 달라졌습니다.', rating: 5 },
  { name: 'mo***', item: '버섯 무드등', text: '배송이 하루 만에 왔어요. 밝기 조절이 돼서 수면등으로 딱이에요. 레비 챗봇 덕분에 충전 방법도 금방 알았어요.', rating: 4 },
];

const won = (n) => `${n.toLocaleString('ko-KR')}원`;
const finalPrice = (p) => Math.round((p.price * (100 - p.sale)) / 100 / 100) * 100;
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

const productCard = (p) => html`
  <li class="product">
    <a class="thumb" href="#p${p.id}" aria-label="${p.name}">
      ${art(p.kind, p.bg, p.color)}
      ${p.badge ? html`<span class="badge ${p.badge.toLowerCase()}">${p.badge}</span>` : ''}
    </a>
    <button type="button" class="add-cart" data-add="${p.id}" aria-label="${p.name} 장바구니 담기">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
    </button>
    <div class="info">
      <a class="name" href="#p${p.id}">${p.name}</a>
      <p class="price">
        ${p.sale ? html`<b class="rate">${p.sale}%</b>` : ''}
        <b>${won(finalPrice(p))}</b>
        ${p.sale ? html`<s>${won(p.price)}</s>` : ''}
      </p>
      <p class="meta"><span class="star">★</span> ${p.rating} · 리뷰 ${p.reviews.toLocaleString('ko-KR')}</p>
    </div>
  </li>`;

// 상단 기획전 슬라이드 ---------------------------------------------------------------
const hero = document.querySelector('[data-hero]');
const dots = document.querySelector('[data-hero-dots]');
render(hero, html`${SLIDES.map((s, i) => html`
  <article class="slide" style="background:${s.bg}" aria-roledescription="slide" aria-label="${i + 1} / ${SLIDES.length}" ${i ? raw('hidden') : ''}>
    <div class="wrap slide-in">
      <div class="slide-text">
        <p class="eyebrow">${s.eyebrow}</p>
        <h2>${s.title}</h2>
        <p>${s.desc}</p>
        <a class="btn-dark" href="#best">지금 보러가기</a>
      </div>
      <div class="slide-art">${art(s.kind, 'transparent', s.color)}</div>
    </div>
  </article>`)}`);
render(dots, html`${SLIDES.map((s, i) => html`<button type="button" role="tab" aria-selected="${i === 0}" aria-label="${s.eyebrow}" data-dot="${i}"></button>`)}`);

let current = 0;
let heroTimer = null;
function go(i) {
  current = (i + SLIDES.length) % SLIDES.length;
  hero.querySelectorAll('.slide').forEach((el, n) => { el.hidden = n !== current; });
  dots.querySelectorAll('button').forEach((el, n) => el.setAttribute('aria-selected', String(n === current)));
}
const autoplay = () => {
  clearInterval(heroTimer);
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) heroTimer = setInterval(() => go(current + 1), 5000);
};
dots.addEventListener('click', (e) => {
  const b = e.target.closest('[data-dot]');
  if (b) { go(Number(b.dataset.dot)); autoplay(); }
});
autoplay();

// 카테고리, 베스트, 신상품, 리뷰 ---------------------------------------------------
render(document.querySelector('[data-cats]'), html`${CATS.map(([, label, kind, bg, color]) => html`
  <li><a href="#best"><span class="cat-art">${art(kind, bg, color)}</span><span>${label}</span></a></li>`)}`);

const bestList = document.querySelector('[data-best]');
const bestTabs = document.querySelector('[data-best-tabs]');
let bestTab = 'all';
function drawBest() {
  render(bestTabs, html`${BEST_TABS.map(([key, label]) => html`<button type="button" role="tab" aria-selected="${key === bestTab}" data-tab="${key}">${label}</button>`)}`);
  const items = PRODUCTS.filter((p) => p.reviews > 100 && (bestTab === 'all' || p.tag === bestTab)).slice(0, 8);
  render(bestList, items.length ? html`${items.map(productCard)}` : html`<li class="empty">준비 중인 상품이에요.</li>`);
}
bestTabs.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { bestTab = t.dataset.tab; drawBest(); }
});
drawBest();

render(document.querySelector('[data-new]'), html`${PRODUCTS.filter((p) => p.badge === 'NEW').map(productCard)}`);

render(document.querySelector('[data-reviews]'), html`${REVIEWS.map((r) => html`
  <li class="review">
    <p class="stars" aria-label="별점 ${r.rating}점">${stars(r.rating)}</p>
    <p class="r-text">${r.text}</p>
    <p class="r-meta"><b>${r.name}</b> · ${r.item}</p>
  </li>`)}`);

// 로고와 고객센터 영역의 레비 -------------------------------------------------------
render(document.querySelector('[data-logo]'), raw(rabbitSvg({ size: 34, mood: 'happy', label: '' })));
render(document.querySelector('[data-cs-levi]'), raw(rabbitSvg({ size: 132, mood: 'wink' })));
document.querySelector('[data-open-levi]').addEventListener('click', () => {
  const btn = document.querySelector('.lq-levi');
  if (btn?.getAttribute('aria-expanded') !== 'true') btn?.click();
});

// 장바구니(시연용) ------------------------------------------------------------------
const toastEl = document.querySelector('[data-toast]');
let toastTimer = null;
function toast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

let cart = 0;
document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) {
    cart += 1;
    document.querySelector('[data-cart-count]').textContent = String(cart);
    const p = PRODUCTS.find((x) => x.id === Number(add.dataset.add));
    toast(`장바구니에 담았어요 · ${p.name}`);
    return;
  }
  const link = e.target.closest('a[href^="#p"], a[href="#login"], a[href="#cart"]');
  if (link) {
    e.preventDefault();
    toast('시연용 쇼핑몰이라 이 페이지는 준비되어 있지 않아요.');
  }
});

document.querySelector('[data-search]').addEventListener('submit', (e) => {
  e.preventDefault();
  toast('시연용 쇼핑몰이라 검색은 준비되어 있지 않아요.');
});

// 모바일 메뉴 -----------------------------------------------------------------------
const menuBtn = document.querySelector('[data-menu]');
menuBtn.addEventListener('click', () => {
  const open = menuBtn.getAttribute('aria-expanded') !== 'true';
  menuBtn.setAttribute('aria-expanded', String(open));
  document.querySelector('[data-gnb]').classList.toggle('open', open);
});
