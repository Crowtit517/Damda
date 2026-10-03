// 날짜 키는 항상 로컬 시간 기준 'YYYY-MM-DD'
export const pad = n => String(n).padStart(2, '0');
export const toKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
export const dateToKey = date => toKey(date.getFullYear(), date.getMonth(), date.getDate());
export const todayKey = () => dateToKey(new Date());

export function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const date = keyToDate(key);
  date.setDate(date.getDate() + n);
  return dateToKey(date);
}

export const daysBetween = (a, b) => Math.round((keyToDate(b) - keyToDate(a)) / 86400000);

export const isValidKey = key =>
  typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && dateToKey(keyToDate(key)) === key;

export const DOW_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export function fullDateLabel(key) {
  const date = keyToDate(key);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${DOW_NAMES[date.getDay()]})`;
}

export function formatTime(hhmm) {
  if (!hhmm) return '종일';
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h < 12 ? '오전' : '오후'} ${h12}:${pad(m)}`;
}

export const formatNumber = n => Number(n || 0).toLocaleString('ko-KR');
export const formatWon = n => formatNumber(n) + '원';
export const parseAmount = s => Number(String(s).replace(/\D/g, '').slice(0, 12)) || 0;
export const sumAmounts = list => list.reduce((s, e) => s + Number(e.amount || 0), 0);

export const EVENT_COLORS = [
  { label: '로즈', hex: '#ff8fa8' },
  { label: '민트', hex: '#5fd3a5' },
  { label: '앰버', hex: '#ffb864' },
  { label: '바이올렛', hex: '#b394ff' },
  { label: '문라이트', hex: '#7fa8ff' },
  { label: '그레이', hex: '#9aa0b4' },
];
export const safeColor = c => (/^#[0-9a-f]{6}$/i.test(c) ? c : EVENT_COLORS[4].hex);

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function loadPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function savePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/** 받침에 맞는 조사: josa('공부', '을', '를') → '공부를', josa('월세', '을', '를') → '월세를' */
export function josa(word, withBatchim, withoutBatchim) {
  const s = String(word ?? '');
  const code = s.charCodeAt(s.length - 1) - 0xac00;
  const has = code >= 0 && code <= 11171 && code % 28 !== 0;
  return s + (has ? withBatchim : withoutBatchim);
}
