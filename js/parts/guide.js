// 사용 가이드 (오른쪽 위 ? 버튼).
// 그림 카드 한 장 = 그림 하나 + 반짝이는 곳 하나 + 짧은 문장 하나. 어린이도 알아볼 수 있게 쉬운 말로.
// 그림은 실제 화면을 단순하게 그린 SVG라서 밝은/어두운 화면 모두 맞고, 파일이 필요 없다.
// 기능이 바뀌면 여기 그림과 문장도 같이 고친다.
import { openOverlay, closeOverlay, closeOnBackdrop } from '../ui/overlay.js';
import { isTouchDevice } from '../settings.js';

const el = document.getElementById('guideModal');
closeOnBackdrop(el);

const hold = () => (isTouchDevice() ? '이름표를 꾹 누르면' : '이름표 위에서 마우스 오른쪽 버튼을 누르면');
const tap = () => (isTouchDevice() ? '누르면' : '클릭하면');

// ---- 그림 도구 (viewBox 300 × 180) ----
// 그림 클래스는 앱의 클래스(.card, .toast 등)와 겹치지 않게 p- 를 붙인다
const pc = cls => cls.split(' ').filter(Boolean).map(c => `p-${c}`).join(' ');
const rect = (x, y, w, h, r, cls) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" class="${pc(cls)}"/>`;
const text = (x, y, s, cls = 'tx', size = 10, anchor = 'start', weight = 400) =>
  `<text x="${x}" y="${y}" class="${pc(cls)}" font-size="${size}" text-anchor="${anchor}" font-weight="${weight}">${s}</text>`;
const circle = (x, y, r, cls) => `<circle cx="${x}" cy="${y}" r="${r}" class="${pc(cls)}"/>`;
// 반짝이는 곳 + 손가락
const ring = (x, y, w, h) => `
  <rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="${Math.min(12, (h + 6) / 2)}" class="p-hl"/>
  <text x="${Math.min(x + w - 2, 280)}" y="${Math.min(y + h + 18, 178)}" font-size="17" class="p-finger">👆</text>`;
// 지금 화면의 테마 버튼 모양 (밝은 화면 ☀️ / 어두운 화면 🌙)
const themeIcon = () => document.getElementById('themeToggle')?.textContent.trim() || '☀️';

function header(title = '📅 캘린더', pill = '이 기기에 저장', dot = 'dot-wait') {
  return `
    ${rect(0, 0, 300, 34, 0, 'card')}<path d="M0 34.5H300" class="p-hair"/>
    <path d="M12 12h14M12 17h14M12 22h14" class="p-stroke"/>
    ${text(34, 22, title, 'tx', 12, 'start', 700)}
    ${rect(150, 8, 92, 18, 9, 'soft')}${circle(160, 17, 3, dot)}${text(167, 20, pill, 'mu', 7.5)}
    ${rect(248, 7, 20, 20, 6, 'soft')}${text(258, 21, '?', 'ac', 11, 'middle', 700)}
    ${rect(272, 7, 20, 20, 6, 'soft')}${text(282, 21, themeIcon(), 'tx', 10, 'middle')}`;
}

function monthGrid() {
  let s = `${text(14, 44, '2026년', 'mu', 6.5)}
    ${rect(12, 47, 14, 12, 4, 'soft')}${text(19, 56, '‹', 'tx', 8, 'middle', 700)}
    ${text(32, 57, '10월 ▾', 'tx', 10, 'start', 700)}
    ${rect(70, 47, 14, 12, 4, 'soft')}${text(77, 56, '›', 'tx', 8, 'middle', 700)}
    ${rect(246, 44, 42, 15, 7.5, 'soft')}${text(256, 55, '💰', 'tx', 8, 'middle')}${rect(264, 47, 20, 10, 5, 'acf')}${circle(279, 52, 3.5, 'knob')}`;
  let d = 1;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 7; col++) {
      const x = 12 + col * 40;
      const y = 62 + row * 28;
      s += rect(x, y, 36, 24, 6, 'soft');
      s += d === 4 ? `${circle(x + 9, y + 9, 6, 'acf')}${text(x + 9, y + 12, d, 'on', 7, 'middle', 700)}` : text(x + 5, y + 11, d, col === 0 ? 'sun' : 'mu', 7);
      if (d === 9 || d === 17) s += circle(x + 18, y + 19, 2.2, 'acf');
      d++;
    }
  }
  return s;
}

const check = (x, y, done) => done
  ? `${circle(x, y, 6, 'acf')}<path d="M${x - 3} ${y}l2 2.2 4-4.4" class="p-stroke-on"/>`
  : circle(x, y, 6, 'ring');

function taskRow(y, label, done, extra = '') {
  return `${rect(12, y, 276, 24, 8, 'card-line')}${check(26, y + 12, done)}
    ${text(38, y + 15, label, done ? 'mu strike' : 'tx', 9)}${extra}`;
}

function chips(y, list, plusLabel = '＋ 추가') {
  let x = 12;
  let s = '';
  for (const [label, cls] of list) {
    const w = label.length * 9 + 16;
    s += `${rect(x, y, w, 20, 10, `chip ${cls || ''}`)}${text(x + w / 2, y + 13.5, label, 'tx', 8.5, 'middle')}`;
    x += w + 6;
  }
  s += `${rect(x, y, 46, 20, 10, 'dash')}${text(x + 23, y + 13.5, plusLabel, 'mu', 8, 'middle')}`;
  return { svg: s, plusX: x };
}

// ---- 장면 ----
const SCENES = {
  home: hl => `${header()}${monthGrid()}${hl}`,

  dayPanel: () => `${header()}${monthGrid()}
    ${rect(0, 66, 300, 114, 16, 'card shadow')}
    ${rect(135, 72, 30, 3, 2, 'soft')}
    ${text(14, 92, '10월 4일 (일)', 'tx', 11, 'start', 700)}
    ${taskRow(100, '숙제하기', true)}${taskRow(128, '줄넘기 100번', false)}
    ${rect(12, 156, 276, 18, 8, 'soft')}${text(20, 168, '💰 오늘 쓴 돈  3,000원', 'tx', 8.5)}`,

  tasks: hl => `${header('✅ 할 일')}
    ${text(150, 52, '‹   오늘 · 10월 4일   ›', 'tx', 10, 'middle', 700)}
    ${rect(12, 62, 158, 26, 9, 'card-line')}${text(22, 79, '새로운 할 일', 'faint', 9)}
    ${rect(176, 62, 56, 26, 9, 'dash')}${text(204, 79, '반복', 'mu', 8.5, 'middle')}
    ${rect(238, 62, 50, 26, 9, 'acf')}${text(263, 79, '추가', 'on', 9, 'middle', 700)}
    ${taskRow(100, '숙제하기', true)}
    ${taskRow(132, '💊 약 먹기', false, text(92, 147, '매일 · 🔥 5일 연속', 'mu', 8))}
    ${hl}`,

  ledger: hl => `${header('💰 가계부')}
    ${rect(12, 44, 96, 24, 9, 'soft')}${rect(15, 47, 45, 18, 7, 'card')}${text(37, 59.5, '지출', 'tx', 8.5, 'middle', 700)}${text(84, 59.5, '수입', 'mu', 8.5, 'middle')}
    ${rect(114, 44, 80, 24, 9, 'card-line')}${text(186, 60, '3,000원', 'tx', 9, 'end', 700)}
    ${rect(200, 44, 88, 24, 9, 'card-line')}${text(208, 60, '떡볶이', 'tx', 9)}
    ${rect(12, 74, 276, 44, 10, 'soft')}${text(20, 86, '이번 달', 'mu', 7.5)}
    <polyline points="24,110 60,106 96,107 132,98 168,96 204,90 240,86 272,80" class="p-line"/>
    ${circle(272, 80, 3, 'acf')}
    ${rect(12, 124, 276, 54, 10, 'card-line')}
    ${text(22, 138, '고정 수입·지출', 'tx', 9, 'start', 700)}${rect(240, 128, 40, 14, 7, 'soft')}${text(260, 138, '＋ 추가', 'tx', 7.5, 'middle')}
    ${text(22, 156, '24일', 'mu', 8, 'start', 700)}${text(46, 156, '용돈', 'tx', 8.5)}${text(280, 156, '+30,000', 'tx', 9, 'end', 700)}
    ${text(22, 171, '25일', 'mu', 8, 'start', 700)}${text(46, 171, '휴대폰 요금', 'tx', 8.5)}${text(280, 171, '-25,000', 'tx', 9, 'end', 700)}
    ${hl}`,

  category: (hl, opts = {}) => {
    const c = chips(51, [['공부', 'c1'], ['운동', 'c2'], ['집안일', 'c3']]);
    return `${header('✅ 할 일')}
      ${text(14, 46, opts.edit ? '정리하는 중… (살랑살랑)' : '카테고리', 'mu', 8)}
      <g class="${opts.edit ? 'p-wiggle' : ''}">${c.svg}</g>
      ${opts.x ? `${circle(44, 52, 6, 'xbtn')}${text(44, 55, '×', 'on', 8, 'middle', 700)}` : ''}
      ${opts.group ? `
        ${rect(12, 84, 140, 56, 12, 'card-line')}${text(22, 101, '🏃 건강', 'tx', 9, 'start', 700)}
        ${rect(22, 110, 40, 20, 10, 'chip c2')}${text(42, 123.5, '운동', 'tx', 8.5, 'middle')}
        ${rect(68, 110, 58, 20, 10, 'chip c4')}${text(97, 123.5, '물 마시기', 'tx', 8.5, 'middle')}
        <path d="M195 100 C170 100 165 110 150 112" class="p-arrow"/>
        ${rect(190, 88, 58, 20, 10, 'chip c4 lift')}${text(219, 101.5, '물 마시기', 'tx', 8.5, 'middle')}` : ''}
      ${opts.undo ? `${rect(50, 146, 200, 26, 13, 'toast')}${text(64, 163, '카테고리를 지웠어요', 'toast-tx', 8.5)}${circle(232, 159, 9, 'toastbtn')}${text(232, 162.5, '↺', 'toast-tx', 10, 'middle', 700)}` : ''}
      ${hl(c)}`;
  },

  menu: (hl, opts = {}) => `${header()}${monthGrid()}
    <rect x="0" y="0" width="300" height="180" class="p-scrim"/>
    ${rect(0, 0, 176, 180, 14, 'card')}
    ${text(14, 22, '담다', 'tx', 14, 'start', 700)}
    ${opts.settings ? `
      ${text(14, 44, '설정', 'mu', 8)}
      ${rect(10, 50, 156, 34, 10, 'soft')}${text(20, 71, '📳 진동', 'tx', 9.5, 'start', 700)}${rect(132, 59, 26, 16, 8, 'acf')}${circle(150, 67, 6, 'knob')}
      ${rect(10, 88, 156, 34, 10, 'soft')}${text(20, 109, '🔔 알림', 'tx', 9.5, 'start', 700)}${rect(132, 97, 26, 16, 8, 'acf')}${circle(150, 105, 6, 'knob')}` : `
      ${text(14, 44, '화면', 'mu', 8)}
      ${['📅 캘린더', '✅ 할 일', '💰 가계부'].map((s, i) => `${rect(10, 50 + i * 24, 156, 20, 7, i === 0 ? 'acs' : 'card')}${text(20, 64 + i * 24, s, 'tx', 9)}`).join('')}
      ${text(14, 130, '동기화', 'mu', 8)}
      ${rect(10, 136, 156, 28, 9, 'card-line')}${circle(26, 150, 8, 'gmark')}${text(26, 153, 'G', 'on', 9, 'middle', 700)}${text(40, 154, '구글 계정으로 연결', 'tx', 9, 'start', 700)}`}
    ${hl}`,

  account: () => `${header()}${monthGrid()}
    <rect x="0" y="0" width="300" height="180" class="p-scrim"/>
    ${rect(60, 26, 180, 132, 14, 'card shadow')}
    ${text(150, 48, '계정 선택', 'tx', 11, 'middle', 700)}
    ${rect(72, 58, 156, 32, 9, 'acs')}${circle(90, 74, 10, 'acf')}${text(90, 78, '나', 'on', 9, 'middle', 700)}${text(106, 72, '내 이름', 'tx', 9, 'start', 700)}${text(106, 84, 'me@gmail.com', 'mu', 7.5)}
    ${rect(72, 94, 156, 28, 9, 'soft')}${text(84, 112, '＋ 다른 계정', 'mu', 8.5)}
    ${rect(170, 128, 58, 22, 9, 'acf')}${text(199, 143, '계속', 'on', 9, 'middle', 700)}`,

  devices: () => `
    ${rect(30, 30, 120, 84, 8, 'card-line')}${rect(30, 30, 120, 12, 8, 'soft')}${text(90, 82, '💻', 'tx', 26, 'middle')}${rect(70, 114, 40, 8, 2, 'soft')}
    ${rect(206, 26, 56, 100, 12, 'card-line')}${text(234, 84, '📱', 'tx', 24, 'middle')}
    <path d="M156 62 H198" class="p-arrow"/><path d="M198 80 H156" class="p-arrow"/>
    ${text(177, 54, '☁️', 'tx', 18, 'middle')}
    ${rect(80, 140, 140, 24, 12, 'soft')}${circle(96, 152, 3.5, 'dot-ok')}${text(104, 155.5, '동기화됨 · 방금', 'tx', 9)}`,
};

// ---- 주제와 카드 ----
const TOPICS = [
  {
    key: 'start', icon: '🌱', label: '처음이에요',
    cards: [
      { scene: () => SCENES.home(ring(8, 6, 22, 22)), say: () => `<b>☰</b> 를 ${tap()} 캘린더, 할 일, 가계부로 갈 수 있어요.` },
      { scene: () => SCENES.home(ring(32, 8, 90, 20)), say: () => '지금 보고 있는 화면 이름이 여기에 나와요.' },
      { scene: () => SCENES.home(ring(150, 8, 92, 18)), say: () => '여기는 내 기록이 어디에 있는지 알려줘요. <b>이 기기에 저장</b>은 지금 이 기기에만 있다는 뜻이에요.' },
    ],
  },
  {
    key: 'calendar', icon: '📅', label: '캘린더',
    cards: [
      { scene: () => SCENES.home(ring(12, 47, 72, 12)), say: () => '<b>‹ ›</b> 를 누르면 지난달, 다음 달로 가요.' },
      { scene: () => SCENES.home(ring(132, 62, 36, 24)), say: () => '날짜를 누르면 그날 한 일이 나와요. 동그란 숫자는 <b>오늘</b>이에요.' },
      { scene: () => SCENES.dayPanel(), say: () => '여기서 할 일을 <b>✔ 체크</b>하고, 그날 쓴 돈도 볼 수 있어요.' },
      { scene: () => SCENES.home(ring(246, 44, 42, 15)), say: () => '<b>💰 스위치</b>를 끄면 캘린더에서 돈 금액이 숨겨져요. 옆에 다른 사람이 있을 때 좋아요.' },
    ],
  },
  {
    key: 'tasks', icon: '✅', label: '할 일',
    cards: [
      { scene: () => SCENES.tasks(ring(12, 62, 158, 26)), say: () => '여기에 할 일을 적고 <b>추가</b>를 눌러요.' },
      { scene: () => SCENES.tasks(ring(20, 106, 12, 12)), say: () => '동그라미를 누르면 <b>✔ 다 했어요!</b> 한 번 더 누르면 취소돼요.' },
      { scene: () => SCENES.tasks(ring(176, 62, 56, 26)), say: () => '매일 하는 일은 <b>반복</b>을 켜요. 약 먹기처럼요.' },
      { scene: () => SCENES.tasks(ring(112, 139, 82, 11)), say: () => '<b>🔥 5일 연속</b>은 5일 동안 하루도 빠짐없이 했다는 뜻이에요. 멋져요!' },
    ],
  },
  {
    key: 'ledger', icon: '💰', label: '가계부',
    cards: [
      { scene: () => SCENES.ledger(ring(12, 44, 96, 24)), say: () => '쓴 돈은 <b>지출</b>, 받은 돈은 <b>수입</b>을 골라요.' },
      { scene: () => SCENES.ledger(ring(114, 44, 174, 24)), say: () => '얼마인지, 어디에 썼는지 적어요.' },
      { scene: () => SCENES.ledger(ring(12, 74, 276, 44)), say: () => '선을 보면 이번 달에 돈을 얼마나 썼는지 알 수 있어요.' },
      { scene: () => SCENES.ledger(ring(240, 128, 40, 14)), say: () => '용돈, 휴대폰 요금처럼 매달 같은 돈은 <b>고정 수입·지출</b>의 <b>＋ 추가</b>로 한 번만 적어 두면, 그날 <b>저절로</b> 적혀요.' },
    ],
  },
  {
    key: 'category', icon: '🏷️', label: '카테고리',
    cards: [
      { scene: () => SCENES.category(c => ring(c.plusX, 51, 46, 20)), say: () => '카테고리는 <b>이름표</b>예요. <b>＋ 추가</b>로 "공부", "운동" 같은 이름표를 만들어요.' },
      { scene: () => SCENES.category(() => ring(12, 51, 42, 20), { edit: true }), say: () => `${hold()} 정리할 수 있어요. 이름표가 살랑살랑 움직여요.` },
      { scene: () => SCENES.category(() => '', { group: true }), say: () => '이름표를 다른 이름표 <b>위에 올리면</b> 한 묶음이 돼요.' },
      { scene: () => SCENES.category(() => ring(222, 150, 20, 18), { x: true, edit: true, undo: true }), say: () => '<b>×</b> 로 지워요. 실수했으면 바로 <b>↺</b> 를 눌러요.' },
    ],
  },
  {
    key: 'sync', icon: '☁️', label: '같이 쓰기',
    cards: [
      { scene: () => SCENES.menu(ring(10, 136, 156, 28)), say: () => '<b>☰</b> 를 열고 <b>구글 계정으로 연결</b>을 눌러요.' },
      { scene: () => SCENES.account(), say: () => '내 계정을 고르고 <b>계속</b>을 눌러요. 처음 한 번만 하면 돼요.' },
      { scene: () => SCENES.devices(), say: () => '이제 휴대폰과 컴퓨터에 <b>똑같이</b> 보여요! 위에 "동기화됨"이 보이면 잘 되고 있는 거예요.' },
    ],
  },
  {
    key: 'settings', icon: '⚙️', label: '설정',
    cards: [
      { scene: () => SCENES.menu(ring(10, 50, 156, 72), { settings: true }), say: () => isTouchDevice()
          ? '<b>☰</b> 맨 아래 <b>설정</b>에서 진동과 알림을 켜고 끌 수 있어요.'
          : '<b>☰</b> 맨 아래 <b>설정</b>에서 알림을 켜고 끌 수 있어요. 컴퓨터에는 진동과 소리가 없어요.' },
      { scene: () => SCENES.home(ring(272, 7, 20, 20)), say: () => '<b>☀️ / 🌙</b> 버튼을 누르면 밝은 화면과 어두운 화면이 바뀌어요. 밤에는 어두운 화면이 눈이 편해요.' },
    ],
  },
];

let topicIdx = 0;
let cardIdx = 0;

function render() {
  const t = TOPICS[topicIdx];
  const c = t.cards[cardIdx];
  const last = cardIdx === t.cards.length - 1;
  const nextTopic = TOPICS[topicIdx + 1];
  el.innerHTML = `
    <div class="modal-box guide">
      <div class="modal-head">
        <span class="g-badge" aria-hidden="true">?</span>
        <strong>사용 가이드</strong>
        <button type="button" class="icon-btn close-btn" data-close aria-label="닫기">✕</button>
      </div>
      <nav class="g-topics" aria-label="가이드 주제">
        ${TOPICS.map((x, i) => `<button type="button" class="g-topic${i === topicIdx ? ' on' : ''}" data-topic="${i}" aria-pressed="${i === topicIdx}"><span aria-hidden="true">${x.icon}</span>${x.label}</button>`).join('')}
      </nav>
      <figure class="g-card">
        <svg class="g-pic" viewBox="0 0 300 180" role="img" aria-label="${t.label} 화면 그림">${c.scene()}</svg>
        <figcaption class="g-say" aria-live="polite">${c.say()}</figcaption>
      </figure>
      <div class="g-nav">
        <button type="button" class="pill-btn" data-step="-1"${topicIdx === 0 && cardIdx === 0 ? ' disabled' : ''}>‹ 이전</button>
        <span class="g-dots" aria-label="${t.cards.length}장 중 ${cardIdx + 1}번째">
          ${t.cards.map((_, i) => `<i class="${i === cardIdx ? 'on' : ''}"></i>`).join('')}
        </span>
        <button type="button" class="pill-btn g-next" data-step="1">
          ${!last ? '다음 ›' : nextTopic ? `${nextTopic.icon} ${nextTopic.label} ›` : '다 봤어요 ✓'}
        </button>
      </div>
    </div>`;
  el.querySelector('.g-topic.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function step(n) {
  const t = TOPICS[topicIdx];
  cardIdx += n;
  if (cardIdx >= t.cards.length) {
    if (topicIdx === TOPICS.length - 1) return closeOverlay(el);
    topicIdx++;
    cardIdx = 0;
  } else if (cardIdx < 0) {
    if (topicIdx === 0) { cardIdx = 0; return; }
    topicIdx--;
    cardIdx = TOPICS[topicIdx].cards.length - 1;
  }
  render();
}

el.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) return closeOverlay(el);
  const b = e.target.closest('[data-topic]');
  if (b) { topicIdx = Number(b.dataset.topic); cardIdx = 0; return render(); }
  const s = e.target.closest('[data-step]');
  if (s) step(Number(s.dataset.step));
});

// 그림을 옆으로 밀어서 넘기기
let startX = null;
el.addEventListener('pointerdown', e => { if (e.target.closest('.g-pic')) startX = e.clientX; });
el.addEventListener('pointerup', e => {
  if (startX === null) return;
  const dx = e.clientX - startX;
  startX = null;
  if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
});

/** 가이드 열기. topic: 주제 key (지금 화면 이름 calendar/tasks/ledger 등) */
export function openGuide(topic) {
  const i = TOPICS.findIndex(x => x.key === topic);
  if (i >= 0) { topicIdx = i; cardIdx = 0; }
  render();
  openOverlay({ el });
}
