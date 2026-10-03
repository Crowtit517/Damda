// SVG 차트 (라이브러리 없음). dataviz 규칙: 선 2px, 면 10% 농도, 끝점 r4 + 2px 바탕색 테두리,
// 막대 ≤ 24px·윗면 4px 둥글게, 가는 실선 격자, 마우스/터치 시 가이드선 + 툴팁.
import { escapeHtml } from '../utils.js';

const H = 190;
const PAD = { top: 16, right: 12, bottom: 26, left: 46 };

/** 4만, 1.2억 같은 짧은 금액 */
export function shortWon(n) {
  if (n >= 1e8) return `${+(n / 1e8).toFixed(1)}억`;
  if (n >= 1e4) return `${+(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)}만`;
  return n.toLocaleString('ko-KR');
}

function niceMax(v) {
  if (v <= 0) return 10000;
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

function gridHtml(w, max, y) {
  return [0, 0.5, 1].map(f => {
    const yy = y(max * f);
    return `<line class="grid-line" x1="${PAD.left}" x2="${w - PAD.right}" y1="${yy}" y2="${yy}" />
      <text class="axis-label" x="${PAD.left - 8}" y="${yy + 4}" text-anchor="end">${shortWon(max * f)}</text>`;
  }).join('');
}

function setupTooltip(wrap) {
  let tip = wrap.querySelector('.chart-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; wrap.appendChild(tip); }
  return {
    show(html, x, w) {
      tip.innerHTML = html;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.min(Math.max(x - tw / 2, 0), w - tw)}px`;
    },
    hide() { tip.hidden = true; },
  };
}

/**
 * 누적 선 그래프. series[0]이 주인공(진한 색 + 면), 나머지는 비교선(흐린 색).
 * series: [{ label, values: number[] }], days: x축 칸 수, dayLabel(i) → 툴팁 제목
 */
const EMPTY = '<p class="chart-empty">기록이 쌓이면 여기에 그래프가 그려져요</p>';

export function lineChart(wrap, { series, days, dayLabel, xTicks, ariaLabel }) {
  if (!series.some(s => s.values.some(v => v > 0))) { wrap.innerHTML = EMPTY; return; } // 기록이 없으면 빈 눈금 대신 안내
  const w = Math.max(wrap.clientWidth, 260);
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)));
  const x = i => PAD.left + (days > 1 ? (i / (days - 1)) * (w - PAD.left - PAD.right) : 0);
  const y = v => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const pathOf = vals => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

  const [main, ...others] = series;
  const last = main.values.length - 1;
  const area = last >= 0
    ? `${pathOf(main.values)}L${x(last).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`
    : '';

  wrap.innerHTML = `
    <svg class="chart-svg" width="${w}" height="${H}" role="img" aria-label="${escapeHtml(ariaLabel)}">
      ${gridHtml(w, max, y)}
      ${xTicks.map(i => `<text class="axis-label" x="${x(i)}" y="${H - 6}" text-anchor="middle">${i + 1}일</text>`).join('')}
      ${others.map(s => `<path class="line-compare" d="${pathOf(s.values)}" />`).join('')}
      ${area ? `<path class="line-area" d="${area}" />` : ''}
      ${last >= 0 ? `<path class="line-main" d="${pathOf(main.values)}" />` : ''}
      ${last >= 0 ? `<circle class="end-dot" cx="${x(last)}" cy="${y(main.values[last])}" r="4" />` : ''}
      <line class="guide" y1="${PAD.top}" y2="${H - PAD.bottom}" visibility="hidden" />
      <circle class="hover-dot main" r="4" visibility="hidden" />
      <circle class="hover-dot compare" r="4" visibility="hidden" />
      <rect class="hit" x="${PAD.left}" y="0" width="${w - PAD.left - PAD.right}" height="${H}" />
    </svg>`;

  const svg = wrap.querySelector('svg');
  const guide = svg.querySelector('.guide');
  const dotMain = svg.querySelector('.hover-dot.main');
  const dotCmp = svg.querySelector('.hover-dot.compare');
  const tip = setupTooltip(wrap);

  const move = e => {
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - PAD.left) / (w - PAD.left - PAD.right)) * (days - 1));
    const idx = Math.max(0, Math.min(days - 1, i));
    guide.setAttribute('x1', x(idx)); guide.setAttribute('x2', x(idx)); guide.setAttribute('visibility', 'visible');
    const place = (dot, s) => {
      if (s && idx < s.values.length) {
        dot.setAttribute('cx', x(idx)); dot.setAttribute('cy', y(s.values[idx])); dot.setAttribute('visibility', 'visible');
      } else dot.setAttribute('visibility', 'hidden');
    };
    place(dotMain, main);
    place(dotCmp, others[0]);
    const rows = series.map((s, k) => idx < s.values.length
      ? `<div><i class="key ${k ? 'compare' : 'main'}"></i>${escapeHtml(s.label)} <strong>${s.values[idx].toLocaleString('ko-KR')}원</strong></div>`
      : '').join('');
    tip.show(`<div class="tip-title">${escapeHtml(dayLabel(idx))}</div>${rows}`, x(idx), w);
  };
  const leave = () => {
    [guide, dotMain, dotCmp].forEach(n => n.setAttribute('visibility', 'hidden'));
    tip.hide();
  };
  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
}

/** 월별 막대 (올해 진하게 + 작년 흐리게). onPick(monthIndex) */
export function barChart(wrap, { current, compare, labels, activeIdx, onPick, ariaLabel, currentLabel, compareLabel }) {
  if (![...current, ...compare].some(v => v > 0)) { wrap.innerHTML = EMPTY; return; }
  const w = Math.max(wrap.clientWidth, 260);
  const n = current.length;
  const max = niceMax(Math.max(1, ...current, ...compare));
  const y = v => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const gw = (w - PAD.left - PAD.right) / n;
  const bw = Math.min(12, Math.max(4, (gw - 6) / 2));
  const base = y(0);

  const bar = (x0, v, cls) => {
    const top = y(v);
    const h = base - top;
    if (h <= 0.5) return '';
    const r = Math.min(4, h, bw / 2);
    return `<path class="${cls}" d="M${x0},${base}L${x0},${top + r}Q${x0},${top} ${x0 + r},${top}L${x0 + bw - r},${top}Q${x0 + bw},${top} ${x0 + bw},${top + r}L${x0 + bw},${base}Z" />`;
  };

  wrap.innerHTML = `
    <svg class="chart-svg" width="${w}" height="${H}" role="img" aria-label="${escapeHtml(ariaLabel)}">
      ${gridHtml(w, max, y)}
      ${current.map((v, i) => {
        const cx = PAD.left + gw * i + gw / 2;
        return `
          <g class="bar-group${i === activeIdx ? ' active' : ''}" data-i="${i}">
            <rect class="bar-hit" x="${PAD.left + gw * i}" y="0" width="${gw}" height="${H}" />
            ${bar(cx - bw - 1, compare[i], 'bar-compare')}
            ${bar(cx + 1, v, 'bar-main')}
            <text class="axis-label${i === activeIdx ? ' strong' : ''}" x="${cx}" y="${H - 6}" text-anchor="middle">${labels[i]}</text>
          </g>`;
      }).join('')}
    </svg>`;

  const tip = setupTooltip(wrap);
  wrap.querySelectorAll('.bar-group').forEach(g => {
    const i = Number(g.dataset.i);
    const cx = PAD.left + gw * i + gw / 2;
    g.addEventListener('pointerenter', () => tip.show(
      `<div class="tip-title">${labels[i]}</div>
       <div><i class="key main"></i>${escapeHtml(currentLabel)} <strong>${current[i].toLocaleString('ko-KR')}원</strong></div>
       <div><i class="key compare"></i>${escapeHtml(compareLabel)} <strong>${compare[i].toLocaleString('ko-KR')}원</strong></div>`, cx, w));
    g.addEventListener('pointerleave', () => tip.hide());
    g.addEventListener('click', () => onPick(i));
  });
}
