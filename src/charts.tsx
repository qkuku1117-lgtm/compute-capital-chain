// 手写的 SVG 折线图：一根纵轴、2px 线、悬停十字线和提示框。
import { useEffect, useId, useRef, useState } from 'react';

export interface Line { key: string; name: string; color: string; values: number[] }
export interface Marker { index: number; label: string }

interface Props {
  lines: Line[];
  labels: string[];
  height?: number;
  format: (v: number) => string;
  markers?: Marker[];
  ariaLabel: string;
  /** 在这些下标处画分隔线（如跨交易日） */
  breaks?: number[];
}

const DEFAULT_W = 720;
const BASE = { top: 14, bottom: 26, left: 50 };

function niceTicks(lo: number, hi: number, count = 4) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

export function LineChart({ lines, labels, height = 240, format, markers = [], ariaLabel, breaks = [] }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  // 按容器的实际宽度画，1 个单位就是 1 像素，字号不会跟着图一起被放大
  const [W, setW] = useState(DEFAULT_W);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(320, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const clip = useId();
  const n = labels.length;
  const single = lines.length === 1;
  // 多条线时右侧要放得下「名称 + 数值」的直接标注
  const M = { ...BASE, right: single ? 60 : 112 };
  if (n < 2) return <div className="chart" ref={wrap} />;
  const all = lines.flatMap((l) => l.values);
  const pad = (Math.max(...all) - Math.min(...all)) * 0.08 || 0.1;
  const lo = Math.min(...all) - pad;
  const hi = Math.max(...all) + pad;
  const x = (i: number) => M.left + (i / (n - 1)) * (W - M.left - M.right);
  const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * (height - M.top - M.bottom);
  const ticks = niceTicks(lo, hi);
  const tickCount = W < 520 ? 3 : 5; // 窄屏少放几个日期，免得挤在一起
  const xTicks = Array.from({ length: tickCount }, (_, k) => Math.round((k / (tickCount - 1)) * (n - 1)));

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left) / box.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  // 末端直接标注：按数值排开，避免重叠
  const ends = lines.map((l) => ({ l, yy: y(l.values[n - 1]) })).sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 15) ends[i].yy = ends[i - 1].yy + 15;
  const marker = hover === null ? undefined : markers.filter((m) => m.index === hover);

  return (
    <div className="chart" ref={wrap}>
      {!single && (
        <ul className="legend" aria-hidden="true">
          {lines.map((l) => <li key={l.key}><span className="swatch" style={{ background: l.color }} />{l.name}</li>)}
        </ul>
      )}
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel}>
        <defs><clipPath id={clip}><rect x={M.left} y={0} width={W - M.left - M.right} height={height} /></clipPath></defs>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
            <text className="axis" x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {xTicks.map((i) => <text key={i} className="axis" x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{labels[i]}</text>)}
        {breaks.map((i) => <line key={i} className="grid grid-break" x1={x(i)} x2={x(i)} y1={M.top} y2={height - M.bottom} />)}
        {markers.map((m) => (
          <g key={`${m.index}-${m.label}`} className="marker">
            <line x1={x(m.index)} x2={x(m.index)} y1={M.top} y2={height - M.bottom} />
            <rect x={x(m.index) - 3} y={M.top - 3} width="6" height="6" transform={`rotate(45 ${x(m.index)} ${M.top})`} />
          </g>
        ))}
        <g clipPath={`url(#${clip})`}>
          {lines.map((l) => (
            <polyline key={l.key} fill="none" style={{ stroke: l.color }} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
              points={l.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
          ))}
        </g>
        {ends.map(({ l, yy }) => (
          <text key={l.key} className="end-label" x={W - M.right + 8} y={yy} dy="0.32em">
            {single ? format(l.values[n - 1]) : `${l.name} ${format(l.values[n - 1])}`}
          </text>
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={M.top} y2={height - M.bottom} />
            {lines.map((l) => <circle key={l.key} cx={x(hover)} cy={y(l.values[hover])} r="4" style={{ fill: l.color }} className="dot" />)}
          </g>
        )}
        <rect x={M.left} y={M.top} width={W - M.left - M.right} height={height - M.top - M.bottom} fill="transparent"
          onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: `${(x(hover) / W) * 100}%` }} data-side={hover > n / 2 ? 'left' : 'right'}>
          <p className="tip-title">{labels[hover]}</p>
          {lines.map((l) => (
            <p key={l.key} className="tip-row">
              <span className="swatch" style={{ background: l.color }} />
              {!single && <span>{l.name}</span>}
              <span className="num">{format(l.values[hover])}</span>
            </p>
          ))}
          {marker?.map((m) => <p key={m.label} className="tip-note">◆ {m.label}</p>)}
        </div>
      )}
    </div>
  );
}
