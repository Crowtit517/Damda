// ✅ 할 일 탭 (참고 이미지 "My Tasks" 레이아웃). 항상 오늘 날짜로 시작한다.
import { dateNavHtml, bindDateNav } from '../parts/dateNav.js';
import { renderTasks, focusTaskInput } from '../parts/taskList.js';
import { todayKey, addDays } from '../utils.js';

const el = document.getElementById('view-tasks');
el.innerHTML = '<div class="nav-slot"></div><div id="tabTasks"></div>';
const navSlot = el.querySelector('.nav-slot');
const body = el.querySelector('#tabTasks');

let key = todayKey();

export function render() {
  navSlot.innerHTML = dateNavHtml(key);
  renderTasks(body, key, { full: true });
}

const setKey = k => { key = k; render(); };
bindDateNav(navSlot, () => key, setKey);

export const shiftDay = n => setKey(addDays(key, n));
export const setDate = k => { key = k; };
export const focusInput = () => focusTaskInput(el);
