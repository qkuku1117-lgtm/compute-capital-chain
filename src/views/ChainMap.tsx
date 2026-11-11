// 资金链地图：四列主体，三种钱的流向。线平时很淡；悬停或点选一个主体，只有和它有关的线亮起来。
import { useMemo, useState } from 'react';
import type { EntityView, Layer, Relation, RelationKind, Snapshot } from '../../shared/types.ts';
import { arrow, KIND_LABEL, pct, price, shortDate, signed, useWidth } from '../lib.ts';

const H = 600;
const TOP = 30;
const NODE_H = 52;
const MIN_W = 720;
const COLS: { title: string; layers: Layer[] }[] = [
  { title: '资金成本', layers: ['capital'] },
  { title: 'AI Lab', layers: ['model'] },
  { title: '云 · Neocloud', layers: ['cloud', 'neocloud'] },
  { title: '硬件', layers: ['hardware'] },
];
const KINDS: RelationKind[] = ['order', 'equity', 'credit'];

interface Box { e: EntityView; x: number; y: number; col: number }

function layout(entities: EntityView[], W: number, nodeW: number): { boxes: Map<string, Box>; colX: number[] } {
  const boxes = new Map<string, Box>();
  // 右边多留一点：最后一列内部的线是从右侧绕出去再回来的
  const step = (W - 8 - 44 - nodeW) / (COLS.length - 1);
  const colX = COLS.map((_, i) => 8 + i * step);
  COLS.forEach((col, ci) => {
    const list = col.layers.flatMap((layer) => entities.filter((e) => e.layer === layer).sort((a, b) => a.order - b.order));
    const groupGap = col.layers.length > 1 ? 0.5 : 0; // 云厂商和 neocloud 之间留一点空
    const slot = Math.min(84, (H - TOP - 8) / (list.length + groupGap));
    const offset = (H - TOP - 8 - slot * (list.length + groupGap)) / 2;
    list.forEach((e, i) => {
      const shift = e.layer === 'neocloud' ? groupGap : 0;
      boxes.set(e.id, { e, x: colX[ci], y: TOP + offset + slot * (i + shift + 0.5) - NODE_H / 2, col: ci });
    });
  });
  return { boxes, colX };
}

interface Drawn { r: Relation; d: string; width: number }

function drawEdges(relations: Relation[], boxes: Map<string, Box>, nodeW: number): Drawn[] {
  type End = { rel: Relation; node: string; side: 'l' | 'r' | 't' | 'b'; otherY: number; isFrom: boolean };
  const ends: End[] = [];
  for (const rel of relations) {
    const a = boxes.get(rel.from);
    const b = boxes.get(rel.to);
    if (!a || !b) continue;
    let sa: End['side'];
    let sb: End['side'];
    if (a.col === b.col) {
      if (a.col === 0) { sa = a.y < b.y ? 'b' : 't'; sb = a.y < b.y ? 't' : 'b'; } else { sa = 'r'; sb = 'r'; }
    } else if (a.col < b.col) { sa = 'r'; sb = 'l'; } else { sa = 'l'; sb = 'r'; }
    ends.push({ rel, node: rel.from, side: sa, otherY: b.y, isFrom: true }, { rel, node: rel.to, side: sb, otherY: a.y, isFrom: false });
  }
  // 同一主体同一侧的多条线，沿边缘错开
  const offset = new Map<string, number>();
  const groups = new Map<string, End[]>();
  for (const e of ends) { const k = `${e.node}|${e.side}`; groups.set(k, [...(groups.get(k) ?? []), e]); }
  for (const list of groups.values()) {
    list.sort((p, q) => p.otherY - q.otherY);
    const step = Math.min(7, (NODE_H - 16) / list.length);
    list.forEach((e, i) => offset.set(`${e.rel.id}|${e.isFrom}`, (i - (list.length - 1) / 2) * step));
  }
  const point = (id: string, side: End['side'], off: number) => {
    const b = boxes.get(id)!;
    if (side === 'l') return [b.x, b.y + NODE_H / 2 + off];
    if (side === 'r') return [b.x + nodeW, b.y + NODE_H / 2 + off];
    if (side === 't') return [b.x + nodeW / 2 + off, b.y];
    return [b.x + nodeW / 2 + off, b.y + NODE_H];
  };
  return relations.flatMap((rel) => {
    const ea = ends.find((e) => e.rel === rel && e.isFrom);
    const eb = ends.find((e) => e.rel === rel && !e.isFrom);
    if (!ea || !eb) return [];
    const [sx, sy] = point(rel.from, ea.side, offset.get(`${rel.id}|true`) ?? 0);
    const [ex, ey] = point(rel.to, eb.side, offset.get(`${rel.id}|false`) ?? 0);
    let d: string;
    if (ea.side === 't' || ea.side === 'b') d = `M${sx},${sy} L${ex},${ey}`;
    else if (ea.side === eb.side) { const bulge = 28 + Math.abs(ey - sy) * 0.1; d = `M${sx},${sy} C${sx + bulge},${sy} ${ex + bulge},${ey} ${ex},${ey}`; }
    else { const dx = (ex - sx) * 0.45; d = `M${sx},${sy} C${sx + dx},${sy} ${ex - dx},${ey} ${ex},${ey}`; }
    return [{ r: rel, d, width: rel.amountBn ? 1 + Math.log10(1 + rel.amountBn) * 0.8 : 1 }];
  });
}

interface Props {
  snap: Snapshot;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

export function ChainMap({ snap, selected, onSelect }: Props) {
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<{ r: Relation; x: number; y: number } | null>(null);
  const [kinds, setKinds] = useState<Set<RelationKind>>(new Set(KINDS));
  const [loopsOnly, setLoopsOnly] = useState(false);
  const [canvas, measured] = useWidth<HTMLDivElement>(900);

  // 按容器的实际宽度排版：1 个单位就是 1 像素，字号固定是 14 和 12
  const W = Math.max(MIN_W, measured);
  const nodeW = Math.round(Math.min(168, Math.max(132, W * 0.165)));
  const { boxes, colX } = useMemo(() => layout(snap.entities, W, nodeW), [snap.entities, W, nodeW]);
  const loopIds = useMemo(() => new Set(snap.loops.flatMap((l) => l.relations)), [snap.loops]);
  const visible = useMemo(
    () => snap.relations.filter((r) => (r.kind === 'rate' ? !loopsOnly : kinds.has(r.kind)) && (!loopsOnly || loopIds.has(r.id))),
    [snap.relations, kinds, loopsOnly, loopIds],
  );
  const edges = useMemo(() => drawEdges(visible, boxes, nodeW), [visible, boxes, nodeW]);
  const focus = hoverNode ?? selected;
  const linked = useMemo(() => {
    if (!focus) return null;
    const ids = new Set<string>([focus]);
    for (const r of visible) { if (r.from === focus) ids.add(r.to); if (r.to === focus) ids.add(r.from); }
    return ids;
  }, [focus, visible]);

  const toggleKind = (k: RelationKind) => setKinds((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
  const name = (id: string) => snap.entities.find((e) => e.id === id)?.zh ?? id;

  const quoteLine = (e: EntityView) => {
    if (e.id === 'fed') return snap.metrics.find((m) => m.id === 'fed.range')?.history.at(-1)?.text.split('（')[0] ?? '';
    if (e.id === 'ust') {
      const live = snap.quotes.US10Y;
      const last = snap.rates.daily.at(-1);
      const prev = snap.rates.daily.at(-2);
      if (live) return `10y ${live.price.toFixed(2)}% ${signed(live.chg, 1)}bp`;
      return last && prev ? `10y ${last.y10.toFixed(2)}% ${signed((last.y10 - prev.y10) * 100, 1)}bp` : '';
    }
    // IPO 进行中：写代码和预计开始交易的日子；开始交易那天报价一到就直接显示价格
    if (!e.ticker && e.ipo) {
      const first = snap.quotes[e.ipo.ticker];
      if (first) return `${e.ipo.ticker} ${price(first.price)} ${arrow(first.chg)}${pct(Math.abs(first.chg), 1).replace('+', '')}`;
      const trading = e.ipo.steps.at(-1);
      return `${e.ipo.ticker} · IPO${trading ? ` ${shortDate(trading.date)}` : ''}`;
    }
    if (!e.ticker || !e.stats) return '未上市';
    const q = snap.quotes[e.ticker];
    const c = q?.chg ?? e.stats.d1;
    return `${e.ticker} ${price(q?.price ?? e.stats.last)} ${arrow(c)}${pct(Math.abs(c), 1).replace('+', '')}`;
  };

  return (
    <div className="card map">
      <div className="chips map-tools" role="group" aria-label="显示哪些关系">
        {KINDS.map((k) => (
          <button key={k} type="button" className="chip chip-soft" aria-pressed={kinds.has(k)} onClick={() => toggleKind(k)}>
            <i className={`sw sw-${k}`} />{KIND_LABEL[k]}
          </button>
        ))}
        <button type="button" className="chip chip-soft" aria-pressed={loopsOnly} onClick={() => setLoopsOnly((v) => !v)}>
          回路 <span className="num">{snap.loops.length}</span>
        </button>
      </div>
      <div className="map-canvas" ref={canvas}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} onClick={() => onSelect(null)}>
          <defs>
            {(['order', 'equity', 'credit', 'rate'] as const).map((k) => (
              <marker key={k} id={`arrow-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0,0.5 L7.5,4 L0,7.5 Z" className={`arrowhead arrowhead-${k}`} />
              </marker>
            ))}
          </defs>
          {COLS.map((c, i) => <text key={c.title} className="col-title" x={colX[i] + 2} y={14}>{c.title}</text>)}
          <g className="edges">
            {edges.map(({ r, d, width }) => {
              const on = !focus || r.from === focus || r.to === focus;
              return (
                <g key={r.id} className={on ? (focus ? 'edge-on' : '') : 'edge-off'}>
                  <path d={d} className={`edge edge-${r.kind}`} strokeWidth={width} markerEnd={`url(#arrow-${r.kind})`} />
                  <path d={d} className="edge-hit"
                    onPointerMove={(ev) => { const box = ev.currentTarget.ownerSVGElement!.getBoundingClientRect(); setHoverEdge({ r, x: ev.clientX - box.left, y: ev.clientY - box.top }); }}
                    onPointerLeave={() => setHoverEdge(null)} />
                </g>
              );
            })}
          </g>
          {[...boxes.values()].map(({ e, x, y }) => {
            const dim = linked && !linked.has(e.id) && e.id !== selected;
            const quote = quoteLine(e);
            return (
              <g key={e.id} className={`node${selected === e.id ? ' node-selected' : ''}${dim ? ' node-dim' : ''}${!e.ticker && e.ipo ? ' node-ipo' : ''}`} transform={`translate(${x},${y})`}
                role="button" tabIndex={0} aria-label={`${e.zh}，${quote}`} aria-pressed={selected === e.id}
                onClick={(ev) => { ev.stopPropagation(); onSelect(selected === e.id ? null : e.id); }}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(selected === e.id ? null : e.id); } }}
                onPointerEnter={() => setHoverNode(e.id)} onPointerLeave={() => setHoverNode(null)}
                onFocus={() => setHoverNode(e.id)} onBlur={() => setHoverNode(null)}>
                <rect width={nodeW} height={NODE_H} rx="10" />
                <text className="node-name" x="12" y="22">{e.zh}</text>
                {/* 报价一变就换一个新节点，让它闪一下 */}
                <text key={quote} className="node-quote" x="12" y="40">{quote}</text>
                {e.changeCount7d > 0 && (
                  <g className="badge" transform={`translate(${nodeW - 5},5)`}>
                    <circle r="10" />
                    <text y="4" textAnchor="middle">{e.changeCount7d}</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
        {hoverEdge && (
          <div className="tip" style={{
            left: hoverEdge.x, top: hoverEdge.y,
            // 靠右、靠下时翻到另一侧，免得被画布边缘裁掉
            transform: `translate(${hoverEdge.x > W * 0.55 ? 'calc(-100% - 14px)' : '14px'}, ${hoverEdge.y > H - 130 ? 'calc(-100% - 14px)' : '14px'})`,
          }}>
            <p className="tip-title">{name(hoverEdge.r.from)} → {name(hoverEdge.r.to)} · {KIND_LABEL[hoverEdge.r.kind]}</p>
            <p>{hoverEdge.r.label}</p>
            {hoverEdge.r.note && <p className="tip-note">{hoverEdge.r.note}</p>}
            <p className="muted">{snap.sources[hoverEdge.r.src]?.pub} · {hoverEdge.r.asOf}</p>
          </div>
        )}
      </div>
    </div>
  );
}
