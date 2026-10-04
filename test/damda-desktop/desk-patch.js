// PC 앱이 담다 파일을 받을 때만 고쳐서 보내는 부분 (레포 파일은 그대로).
// 정식으로 넣을 때는 이 내용을 "PC 앱일 때만" 조건으로 담다 코드에 옮기면 된다.
// [찾을 글, 바꿀 글] — 찾을 글이 없으면(담다 코드가 바뀌었으면) 고치지 않고 원래 파일을 보낸다.

module.exports = {
  // ---- 하루 패널: 겹치는 창(overlay) 대신 오른쪽 구역에 늘 붙어 있게 ----
  '/js/views/dayPanel.js': [
    [`export function openDayPanel(k) {
  key = k;
  render();
`, `export function openDayPanel(k) {
  key = k;
  render();
  // PC 앱: 오른쪽 구역의 [이 날] 탭으로 늘 붙어 있다 (메뉴를 열어도 닫히지 않게 겹치는 창 목록에 넣지 않는다)
  el.hidden = false; el.classList.add('open'); notifyChange(); return;
`],
    [`export const isPanelOpen = () => isOpen(el);`, `export const isPanelOpen = () => !el.hidden; // PC 앱`],
  ],

  // ---- 화면: 캘린더는 늘 왼쪽, 오른쪽 구역은 [이 날 | 할 일 | 가계부] 탭 ----
  '/js/app.js': [
    [`function showTab(next) {
  tab = next;
  savePref('ple-tab', tab);
  for (const name of Object.keys(SCREENS)) document.getElementById(\`view-\${name}\`).hidden = name !== tab;
  const s = SCREENS[tab];
  titleEl.textContent = s.label;
  document.title = \`\${s.label} · 담다\`;
  if (tab !== 'calendar' && dayPanel.isPanelOpen()) closeOverlay(document.getElementById('dayPanel'));
  s.view.render();
}`, `// PC 앱: 캘린더는 늘 왼쪽에 보이고, tab 은 오른쪽 구역에 무엇을 보일지 (calendar = 이 날)
function showTab(next) {
  tab = next;
  savePref('ple-tab', tab);
  document.getElementById('view-calendar').hidden = false;
  for (const name of ['tasks', 'ledger']) document.getElementById(\`view-\${name}\`).hidden = name !== tab;
  const panel = document.getElementById('dayPanel');
  if (tab === 'calendar') dayPanel.openDayPanel(dayPanel.currentPanelKey() || todayKey());
  else { panel.hidden = true; panel.classList.remove('open'); }
  document.querySelectorAll('.desk-tabs [data-screen]').forEach(b => b.classList.toggle('on', b.dataset.screen === tab));
  titleEl.textContent = '캘린더';
  document.title = '담다';
  calendar.render();
  if (tab !== 'calendar') SCREENS[tab].view.render();
}`],
    [`store.subscribe(() => {
  SCREENS[tab].view.render();
  dayPanel.render();
});`, `store.subscribe(() => {
  SCREENS[tab].view.render();
  if (tab !== 'calendar') calendar.render(); // PC 앱: 캘린더는 늘 보인다
  dayPanel.render();
});`],
    // 할 일·가계부 탭을 보다가 달력 날짜를 누르면 [이 날] 탭으로
    [`window.addEventListener('ple:panelchange', () => { if (tab === 'calendar') calendar.render(); });`,
     `window.addEventListener('ple:panelchange', () => { if (tab !== 'calendar' && dayPanel.isPanelOpen()) showTab('calendar'); else calendar.render(); });`],
    // 오른쪽 구역 탭 + 경계 끌어서 넓이 조절
    [`\nshowTab(tab);\n`, `
{
  const root = document.documentElement;
  try { const w = localStorage.getItem('desk-side-w'); if (w) root.style.setProperty('--desk-side-w', w + 'px'); } catch {}
  const nav = document.createElement('nav');
  nav.className = 'desk-tabs';
  nav.setAttribute('role', 'tablist');
  nav.innerHTML = [['calendar', '이 날'], ['tasks', '할 일'], ['ledger', '가계부']]
    .map(([k, label]) => \`<button type="button" role="tab" data-screen="\${k}">\${label}</button>\`).join('');
  nav.addEventListener('click', e => { const b = e.target.closest('[data-screen]'); if (b) showTab(b.dataset.screen); });
  const bar = document.createElement('div');
  bar.className = 'desk-resizer';
  bar.title = '끌어서 넓이 조절';
  bar.addEventListener('pointerdown', e => {
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const move = ev => {
      const w = Math.round(Math.min(Math.max(innerWidth - ev.clientX, 300), innerWidth / 3)); // 창의 1/3까지만
      root.style.setProperty('--desk-side-w', w + 'px');
      try { localStorage.setItem('desk-side-w', w); } catch {}
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', () => bar.removeEventListener('pointermove', move), { once: true });
  });
  document.body.append(nav, bar);
}
showTab(tab);
`],
  ],
};
