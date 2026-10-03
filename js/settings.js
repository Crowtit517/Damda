// 기기별 설정 (동기화하지 않는다): 진동, 알림, 캘린더 금액 보기.
// 소리는 따로 만들지 않는다. 알림이 울릴 때는 폰 기본 알림음을 따른다 (Phase 5, 갤럭시 앱).
// PC에는 진동·소리가 없다.
import { loadPref, savePref } from './utils.js';

const DEFAULTS = { vibrate: true, notify: true, money: true };

export const getSetting = key => loadPref(`ple-set-${key}`, DEFAULTS[key]);
export const setSetting = (key, value) => savePref(`ple-set-${key}`, !!value);

/** 손가락으로 쓰는 기기(폰·태블릿)인지. PC에서는 진동 항목을 보여주지 않는다 */
export const isTouchDevice = () => {
  try { return matchMedia('(pointer: coarse)').matches && 'vibrate' in navigator; } catch { return false; }
};

/** 짧은 손끝 반응. 설정에서 끄면 울리지 않는다 */
export function buzz(pattern) {
  if (!getSetting('vibrate')) return;
  try { navigator.vibrate?.(pattern); } catch {}
}
