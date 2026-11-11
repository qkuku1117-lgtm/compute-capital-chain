// 把数字的变化画出来。全部用中性墨色：最新（或当前这条）的一根最深，方向靠位置和符号表示，不用红绿。
// 柱子一律从零线起画；折线只用在连续的行情上。
import { useState } from 'react';
import type { Ipo, Metric, MetricPoint, Reaction } from '../shared/types.ts';
import { arrow, asOfLabel, LEVEL_LABEL, mainText, pct, shortDate, signed, stepOf, todayIso, withUnit } from './lib.ts';

type NumPoint = MetricPoint & { value: number };
export const numericPoints = (m: Metric) => m.history.filter((p): p is NumPoint => typeof p.value === 'number');
/** 能画成柱子：至少两条记录，而且每一条都有数值。 */
export const chartable = (m: Metric) => m.history.length >= 2 && numericPoints(m).length === m.history.length;

/** 涨跌：同一种墨色，靠方向符号区分，不用红绿。 */
export function Delta({ value, digits = 2, unit = '%' }: { value: number; digits?: number; unit?: string }) {
  return (
    <span className="delta num">
      <span className="delta-arrow" aria-hidden="true">{arrow(value)}</span>
      {value < 0 && <span className="sr-only">下跌</span>}
      {unit === '%' ? pct(Math.abs(value), digits).replace('+', '') : `${signed(Math.abs(value), digits).replace('+', '')}${unit}`}
    </span>
  );
}

/** 这一次比上一次差了多少。 */
export function StepChip({ prev, cur, unit }: { prev: number; cur: number; unit?: string }) {
  const s = stepOf(prev, cur, unit);
  return (
    <span className="chg num">
      {s.dir !== 0 && <span className="delta-arrow" aria-hidden="true">{arrow(s.dir)}</span>}
      {s.dir !== 0 && <span className="sr-only">{s.dir > 0 ? '上升' : '下降'}</span>}
      {s.text}
    </span>
  );
}

/** 折叠行上的小柱子：最近几次读数，最后一根最深。flat 表示几根是并列的口径，不分先后。 */
export function MiniBars({ values, flat = false }: { values: number[]; flat?: boolean }) {
  const v = values.slice(-6);
  const hi = Math.max(0, ...v);
  const span = hi - Math.min(0, ...v) || 1;
  const H = 18;
  const BW = 5;
  const GAP = 2;
  const W = v.length * BW + (v.length - 1) * GAP;
  const zero = (hi / span) * H;
  return (
    <svg className="minibars" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${flat ? '几个口径' : `近 ${v.length} 次读数`}：${v.join('、')}`}>
      {v.map((x, i) => {
        const h = Math.max(1.5, (Math.abs(x) / span) * H);
        return <rect key={i} className={!flat && i === v.length - 1 ? 'on' : undefined} x={i * (BW + GAP)} y={x >= 0 ? zero - h : zero} width={BW} height={h} rx="1" />;
      })}
    </svg>
  );
}

/** 一个数字的历次读数：一根柱子一次披露。悬停或聚焦某一根，下面那一行换成它的原文、和上一次的差、以及 foot 给出的附注（信源）。 */
export function HistoryBars({ m, mark, foot }: { m: Metric; mark?: number; foot?: (p: MetricPoint) => React.ReactNode }) {
  const [hover, setHover] = useState<number | null>(null);
  const all = numericPoints(m);
  const pts = all.slice(-8);
  const estimates = m.kind === 'estimates';
  const on = (mark ?? all.length - 1) - (all.length - pts.length);
  const hi = Math.max(0, ...pts.map((p) => p.value));
  const span = hi - Math.min(0, ...pts.map((p) => p.value)) || 1;
  const zero = (hi / span) * 100; // 零线离顶部多远
  const sel = Math.max(0, Math.min(pts.length - 1, hover ?? on));
  const p = pts[sel];
  const prev = pts[sel - 1];
  return (
    <div className="hbars" style={{ '--zero': `${zero}%` } as React.CSSProperties}>
      <ol aria-label={`${m.name}的${estimates ? '几个口径' : '历次读数'}`}>
        {pts.map((pt, i) => {
          const h = (Math.abs(pt.value) / span) * 100;
          const short = mainText(pt.text);
          return (
            <li key={pt.asOf + pt.text} className={!estimates && i === on ? 'on' : undefined} tabIndex={0} aria-current={i === sel ? 'true' : undefined}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              <span className="hbar-val num">{short.length <= 10 ? short : withUnit(pt.value, m.unit)}</span>
              <span className="hbar-plot" aria-hidden="true">
                <i className={pt.value < 0 ? 'neg' : undefined} style={pt.value >= 0 ? { bottom: `${100 - zero}%`, height: `${h}%` } : { top: `${zero}%`, height: `${h}%` }} />
              </span>
              <span className="hbar-date num">{asOfLabel(pt.asOf)}</span>
            </li>
          );
        })}
      </ol>
      <div className="hbar-read">
        <p className="meta">
          <span className="num muted">{asOfLabel(p.asOf)}</span>
          <b>{p.text}</b>
          {!estimates && prev && <StepChip prev={prev.value} cur={p.value} unit={m.unit} />}
        </p>
        {foot && <p className="meta">{foot(p)}</p>}
        {p.note && <p>{p.note}</p>}
      </div>
    </div>
  );
}

/** 市场反应在尺子上的位置：中线是 0，灰带是 ±1 倍日常波动，两端是 ±3 倍。圆点在右是向上，在左是向下。 */
export function SigmaTrack({ r }: { r: Pick<Reaction, 'z' | 'level'> }) {
  const z = r.level === 'pending' || r.z === null ? null : Math.max(-3, Math.min(3, r.z));
  const label = z === null || r.z === null ? LEVEL_LABEL.pending : `${r.z > 0 ? '向上' : r.z < 0 ? '向下' : ''}，相当于日常波动的 ${Math.abs(r.z).toFixed(1)} 倍`;
  return (
    <span className="sigma" role="img" aria-label={label}>
      <span className="sigma-band" />
      <span className="sigma-zero" />
      {z !== null && <span className="sigma-dot" style={{ left: `${50 + z * 15.33}%` }} />}
    </span>
  );
}

/** 几个区间的涨跌，共用一把尺子，从同一条零线向两边画。 */
export function PeriodBars({ rows }: { rows: { label: string; value: number; digits?: number }[] }) {
  const lo = Math.min(0, ...rows.map((r) => r.value));
  const span = Math.max(0, ...rows.map((r) => r.value)) - lo || 1;
  const zero = (-lo / span) * 100;
  return (
    <dl className="pbars" style={{ '--zero': `${zero}%` } as React.CSSProperties}>
      {rows.map((r) => (
        <div key={r.label}>
          <dt>{r.label}</dt>
          <dd className="pbar-track" aria-hidden="true">
            <i className={r.value < 0 ? 'neg' : undefined}
              style={r.value >= 0 ? { left: `${zero}%`, width: `${(r.value / span) * 100}%` } : { right: `${100 - zero}%`, width: `${(-r.value / span) * 100}%` }} />
          </dd>
          <dd className="pbar-val"><Delta value={r.value} digits={r.digits ?? 1} /></dd>
        </div>
      ))}
    </dl>
  );
}

/** 走势小线：只看形状，末端一个点。 */
export function Spark({ values, width = 88, height = 28, label }: { values: number[]; width?: number; height?: number; label: string }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo || 1;
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 6);
  const y = (v: number) => 3 + (1 - (v - lo) / span) * (height - 6);
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <polyline points={values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.5" />
    </svg>
  );
}

/** 一个总数由哪几块组成：一根横条按比例切开，名字和数值直接写在每一段下面。 */
export function SplitBar({ parts, format }: { parts: { key: string; name: string; value: number }[]; format: (v: number) => string }) {
  return (
    <ul className="split">
      {parts.map((p) => (
        <li key={p.key} style={{ flexGrow: p.value }}>
          <i aria-hidden="true" />
          <span>{p.name}</span>
          <span className="num">{format(p.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** IPO 走到哪一步：已经过去的日子是实心点，当前这一步加粗，后面是空心点。 */
export function IpoSteps({ ipo }: { ipo: Ipo }) {
  const today = todayIso();
  const now = ipo.steps.filter((s) => s.date <= today).length - 1;
  return (
    <ol className="steps" aria-label={`${ipo.ticker} 的 IPO 进度`}>
      {ipo.steps.map((s, i) => (
        <li key={s.label} className={i < now ? 'done' : i === now ? 'now' : undefined} aria-current={i === now ? 'step' : undefined}>
          <i aria-hidden="true" />
          <span className="steps-label">{s.label}</span>
          <span className="steps-date num">{s.expected && i > now ? '预计 ' : ''}{shortDate(s.date)}</span>
        </li>
      ))}
    </ol>
  );
}
