// 토끼 챗봇 레비 그림. 표정(mood)마다 눈과 입 모양이 바뀐다.
const INK = '#3d2c3a';
const LINE = `fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;

const EYES = {
  open: (x) => `<ellipse cx="${x}" cy="70" rx="4.2" ry="5.2" fill="${INK}"/><circle cx="${x + 1.5}" cy="68" r="1.5" fill="#fff"/>`,
  happy: (x) => `<path d="M${x - 5} 72q5-7 10 0" ${LINE}/>`,
  round: (x) => `<circle cx="${x}" cy="70" r="5" fill="#fff" stroke="${INK}" stroke-width="2.4"/><circle cx="${x}" cy="70" r="2" fill="${INK}"/>`,
  shutL: (x) => `<path d="M${x - 4} 66l7 4-7 4" ${LINE}/>`,
  shutR: (x) => `<path d="M${x + 4} 66l-7 4 7 4" ${LINE}/>`,
  heart: (x) => `<path d="M${x} 75.500c-5-3.500-7-6-7-8.500a3.500 3.500 0 017-1.200 3.500 3.500 0 017 1.200c0 2.500-2 5-7 8.500z" fill="#ff5c86"/>`,
};

const MOUTHS = {
  w: `<path d="M54 84q3 4 6 0q3 4 6 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
  o: `<ellipse cx="60" cy="87" rx="3" ry="3.600" fill="${INK}"/>`,
  wave: `<path d="M53 87q2.300-3 4.600 0t4.600 0t4.600 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
};

const DROP = 'c3 4 5 7 5 10a5 5 0 01-10 0c0-3 2-6 5-10z';

const MOODS = {
  normal: { l: 'open', r: 'open', mouth: 'w' },
  happy: { l: 'happy', r: 'happy', mouth: 'w' },
  wink: { l: 'open', r: 'happy', mouth: 'w' },
  surprised: { l: 'round', r: 'round', mouth: 'o' },
  sweat: { l: 'happy', r: 'happy', mouth: 'w', extra: `<path fill="#8fd3ff" d="M92 48${DROP}"/>` },
  cry: { l: 'shutL', r: 'shutR', mouth: 'wave', extra: '<ellipse class="rb-tear" cx="40" cy="81" rx="2.800" ry="4" fill="#8fd3ff"/><ellipse class="rb-tear" cx="80" cy="81" rx="2.800" ry="4" fill="#8fd3ff"/>' },
  love: { l: 'heart', r: 'heart', mouth: 'w' },
};

export const MOOD_LIST = [
  ['happy', '웃음'], ['normal', '기본'], ['wink', '윙크'], ['love', '하트'], ['surprised', '놀람'], ['sweat', '머쓱'], ['cry', '울음'],
];

export function rabbitSvg({ size = 64, mood = 'normal', label = '레비' } = {}) {
  const m = MOODS[mood] || MOODS.normal;
  return `<svg class="rabbit" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="${label}">
    <ellipse cx="60" cy="112" rx="28" ry="4.500" fill="#3d2c3a" opacity=".08"/>
    <g class="rb-body">
      <g class="rb-ear rb-ear-l">
        <path d="M42 54C30 38 27 12 38 5s21 18 19 46z" fill="#fff" stroke="#ecdfe7" stroke-width="2"/>
        <path d="M43 46C36 34 35 18 40 13s11 14 10 32z" fill="#ffc6d6"/>
      </g>
      <g class="rb-ear rb-ear-r">
        <path d="M78 54C90 38 93 12 82 5s-21 18-19 46z" fill="#fff" stroke="#ecdfe7" stroke-width="2"/>
        <path d="M77 46C84 34 85 18 80 13s-11 14-10 32z" fill="#ffc6d6"/>
      </g>
      <ellipse cx="60" cy="76" rx="41" ry="33" fill="#fff" stroke="#ecdfe7" stroke-width="2"/>
      <ellipse cx="36" cy="83" rx="7" ry="4.500" fill="#ffb3c7" opacity=".75"/>
      <ellipse cx="84" cy="83" rx="7" ry="4.500" fill="#ffb3c7" opacity=".75"/>
      ${EYES[m.l](45)}${EYES[m.r](75)}
      <path d="M56.500 78.500h7l-3.500 3.500z" fill="#ff8fab" stroke="#ff8fab" stroke-width="1.500" stroke-linejoin="round"/>
      ${MOUTHS[m.mouth]}
      ${m.extra || ''}
    </g>
  </svg>`;
}
