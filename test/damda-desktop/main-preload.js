// 담다 본 창용: PC 앱에서만 캘린더 위쪽에 [위젯으로 보기] 버튼을 끼워 넣는다.
// (시험판이라 담다 코드는 고치지 않고 바깥에서 붙인다. 정식으로 넣을 땐 담다 쪽에서 window.desk 가 있으면 보이게 하면 된다)
const { ipcRenderer } = require('electron');

function addCalendarButton() {
  const tools = document.querySelector('.cal-tools');
  if (!tools || tools.querySelector('.desk-widget-btn')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pill-btn desk-widget-btn';
  b.title = '바탕화면 위젯으로 열기 (Ctrl+Shift+D: 숨기기/꺼내기)';
  b.textContent = '위젯으로 보기';
  tools.prepend(b);
}

// 지난번 닫을 때 입력칸에 쓰던 글자를 다시 채운다 (한 번만)
function restoreDrafts() {
  let drafts = [];
  try { drafts = JSON.parse(localStorage.getItem('desk-drafts') || '[]'); localStorage.removeItem('desk-drafts'); } catch {}
  for (const d of drafts) {
    const box = document.getElementById(d.box);
    const el = box && [...box.querySelectorAll(d.tag)].filter(x => (x.name || x.className) === d.name)[d.i];
    if (!el || el.value) continue;
    el.value = d.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

window.addEventListener('load', () => setTimeout(restoreDrafts, 800));

window.addEventListener('DOMContentLoaded', () => {
  new MutationObserver(addCalendarButton).observe(document.body, { childList: true, subtree: true });
  addCalendarButton();
  // 버튼 누름 (담다의 다른 처리기보다 먼저 받는다)
  document.addEventListener('click', e => {
    if (!e.target.closest('.desk-widget-btn')) return;
    e.stopPropagation();
    ipcRenderer.send('open-widget');
  }, true);
});
