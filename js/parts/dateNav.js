// ‹ 10월 3일 (토) › 날짜 이동. 할 일 탭, 가계부 탭, 하루 패널이 같이 쓴다.
import { todayKey, addDays, fullDateLabel, isValidKey } from '../utils.js';

export function dateNavHtml(key) {
  const isToday = key === todayKey();
  return `
    <div class="date-nav">
      <button type="button" class="icon-btn" data-nav="-1" aria-label="이전 날">‹</button>
      <button type="button" class="date-title" data-nav="pick" aria-label="날짜 선택">
        ${fullDateLabel(key)}${isToday ? '<span class="today-badge">오늘</span>' : ''}
      </button>
      <button type="button" class="icon-btn" data-nav="1" aria-label="다음 날">›</button>
      ${isToday ? '' : '<button type="button" class="pill-btn small" data-nav="today">오늘</button>'}
      <input type="date" class="date-native" value="${key}" tabindex="-1" aria-hidden="true" />
    </div>`;
}

/** container 안의 날짜 이동 버튼을 연결한다. getKey/setKey로 현재 날짜를 주고받는다 */
export function bindDateNav(container, getKey, setKey) {
  container.addEventListener('click', e => {
    const btn = e.target.closest('[data-nav]');
    if (!btn || !container.contains(btn)) return;
    const v = btn.dataset.nav;
    if (v === 'pick') {
      const input = btn.parentElement.querySelector('.date-native');
      try { input.showPicker(); } catch { input.focus(); input.click(); }
    } else if (v === 'today') {
      setKey(todayKey());
    } else {
      setKey(addDays(getKey(), Number(v)));
    }
  });
  container.addEventListener('change', e => {
    if (e.target.matches('.date-native') && isValidKey(e.target.value)) setKey(e.target.value);
  });
}
