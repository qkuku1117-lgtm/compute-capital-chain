// 账本里所有"算出来"的东西都在这里：区间涨跌、beta、市场反应、回路。
// 原则：这里只做算术，不做判断。反应的强弱只按"相当于几倍日常波动"分档。
import type {
  Change, ChangeView, Entity, EntityView, InboxItem, LiveQuote, MarketPhase, Reaction, ReactionLevel, Relation, Snapshot, Stats,
} from '../shared/types.ts';
import { loadIntraday, loadLedger, loadSeries, type Bar } from './store.ts';

const BENCH = 'QQQ';
const RATE_NAMES: Record<string, string> = { US5Y: '5 年期', US10Y: '10 年期', US30Y: '30 年期' };

const dateInt = (iso: string) => Number(iso.replaceAll('-', '').slice(0, 8));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const std = (xs: number[]) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** 按日期对齐后的日收益（%）。 */
function alignedReturns(a: Bar[], b: Bar[], endDate: number, n: number) {
  const bIdx = new Map(b.map((bar, i) => [bar[0], i]));
  const out: { ra: number; rb: number }[] = [];
  for (let i = a.length - 1; i > 0 && out.length < n; i--) {
    if (a[i][0] >= endDate) continue; // 只用事件日之前的数据
    const j = bIdx.get(a[i][0]);
    if (j === undefined || j === 0 || b[j - 1][0] !== a[i - 1][0]) continue;
    out.push({ ra: (a[i][4] / a[i - 1][4] - 1) * 100, rb: (b[j][4] / b[j - 1][4] - 1) * 100 });
  }
  return out;
}

function betaOf(a: Bar[], bench: Bar[], endDate: number, n = 250): number | null {
  const rs = alignedReturns(a, bench, endDate, n);
  if (rs.length < 60) return null;
  const ma = mean(rs.map((r) => r.ra));
  const mb = mean(rs.map((r) => r.rb));
  let cov = 0;
  let varb = 0;
  for (const r of rs) { cov += (r.ra - ma) * (r.rb - mb); varb += (r.rb - mb) ** 2; }
  return varb ? cov / varb : null;
}

function statsOf(bars: Bar[], bench: Bar[] | undefined, symbol: string): Stats {
  const c = bars.map((b) => b[4]);
  const n = c.length;
  const chg = (k: number) => (n > k ? round((c[n - 1] / c[n - 1 - k] - 1) * 100) : 0);
  const year = Math.floor(bars[n - 1][0] / 10000);
  let ytdBase = c[0];
  let fromListing = true;
  for (let i = n - 1; i >= 0; i--) if (Math.floor(bars[i][0] / 10000) < year) { ytdBase = c[i]; fromListing = false; break; }
  const hi = Math.max(...c.slice(-250));
  return {
    last: c[n - 1],
    lastDate: bars[n - 1][0],
    d1: chg(1), d5: chg(5), d20: chg(20),
    ytd: round((c[n - 1] / ytdBase - 1) * 100),
    fromListing,
    drawdown: round((c[n - 1] / hi - 1) * 100),
    beta: bench && symbol !== BENCH ? (betaOf(bars, bench, Infinity) === null ? null : round(betaOf(bars, bench, Infinity)!, 2)) : null,
    spark: c.slice(-60),
  };
}

const levelOf = (z: number | null): ReactionLevel => (z === null ? 'pending' : Math.abs(z) >= 2 ? 'strong' : Math.abs(z) >= 1 ? 'mild' : 'none');

/** 实时通道给的叠加层：盘中的暂计日线、各时段报价、未入账标题。 */
export interface LiveOverlay {
  connected: boolean;
  phase: MarketPhase;
  at: number | null;
  quotes: Map<string, LiveQuote>;
  bars: Map<string, Bar>;
  inbox: InboxItem[];
}

export function buildSnapshot(live?: LiveOverlay): Snapshot {
  const L = loadLedger();
  const S = loadSeries();
  // 盘中：把实时价当作"今天这根还没收的日线"接在序列后面，后面的计算不用区分。
  const provisional = new Set<string>();
  let provisionalDay = 0;
  for (const [sym, bar] of live?.bars ?? []) {
    const s = S.get(sym);
    if (!s || bar[0] <= s.bars[s.bars.length - 1][0]) continue;
    s.bars = [...s.bars, bar];
    provisional.add(sym);
    provisionalDay = Math.max(provisionalDay, bar[0]);
  }
  const I = loadIntraday();
  const bench = S.get(BENCH)?.bars;
  // IPO 中的主体：它的代码一有日线（第一个交易日收盘之后），就按已上市处理，不用再改数据。
  const all: Entity[] = L.entities.map((e) => (!e.ticker && e.ipo && S.has(e.ipo.ticker) ? { ...e, ticker: e.ipo.ticker } : e));
  const entityById = new Map(all.map((e) => [e.id, e]));
  const asOfDate = bench ? bench[bench.length - 1][0] : 0;
  const asOf = `${String(asOfDate).slice(0, 4)}-${String(asOfDate).slice(4, 6)}-${String(asOfDate).slice(6, 8)}`;

  // 事件的反应日：盘前 / 盘中事件算当天，盘后事件算下一个交易日。
  const reactionIndex = (bars: Bar[], c: Change) => {
    const d = dateInt(c.date);
    const i = bars.findIndex((b) => (c.session === 'post' ? b[0] > d : b[0] >= d));
    return i > 0 ? i : -1;
  };

  const assetsOf = (c: Change): { symbol: string; kind: 'equity' | 'rate' }[] => {
    const e = entityById.get(c.entity)!;
    const out: { symbol: string; kind: 'equity' | 'rate' }[] = [];
    if (e.rates) for (const r of e.rates) out.push({ symbol: r, kind: 'rate' });
    else if (e.ticker) out.push({ symbol: e.ticker, kind: 'equity' });
    for (const id of c.related ?? []) {
      const r = entityById.get(id);
      if (r?.ticker && !out.some((o) => o.symbol === r.ticker)) out.push({ symbol: r.ticker, kind: 'equity' });
    }
    if (!out.length && e.proxies) for (const p of e.proxies) out.push({ symbol: p, kind: 'equity' });
    return out.slice(0, 3);
  };

  const isProvisional = (symbol: string, day: number) => (provisional.has(symbol) && day === provisionalDay) || undefined;

  const reactionOf = (c: Change, symbol: string, kind: 'equity' | 'rate'): Reaction => {
    const s = S.get(symbol);
    const assetName = kind === 'rate' ? RATE_NAMES[symbol] ?? symbol : s?.zh || symbol;
    const pending: Reaction = { asset: symbol, assetName, kind, day: null, move: null, excess: null, z: null, level: 'pending' };
    if (!s) return pending;
    const bars = s.bars;
    const i = reactionIndex(bars, c);
    if (i < 0) return pending;
    const day = bars[i][0];
    if (kind === 'rate') {
      const bp = (bars[i][4] - bars[i - 1][4]) * 100;
      const hist: number[] = [];
      for (let k = i - 1; k > 0 && hist.length < 60; k--) hist.push((bars[k][4] - bars[k - 1][4]) * 100);
      const sd = std(hist);
      const z = sd ? bp / sd : null;
      return { asset: symbol, assetName, kind, day, move: round(bp, 1), excess: null, z: z === null ? null : round(z, 1), level: levelOf(z), provisional: isProvisional(symbol, day) };
    }
    const move = (bars[i][4] / bars[i - 1][4] - 1) * 100;
    let excess = move;
    let sd: number;
    const bj = bench?.findIndex((b) => b[0] === day) ?? -1;
    const beta = bench && symbol !== BENCH ? betaOf(bars, bench, day) : null;
    if (bench && beta !== null && bj > 0) {
      const m = (bench[bj][4] / bench[bj - 1][4] - 1) * 100;
      excess = move - beta * m;
      sd = std(alignedReturns(bars, bench, day, 60).map((r) => r.ra - beta * r.rb));
    } else {
      const hist: number[] = [];
      for (let k = i - 1; k > 0 && hist.length < 60; k--) hist.push((bars[k][4] / bars[k - 1][4] - 1) * 100);
      sd = std(hist);
    }
    const z = sd ? excess / sd : null;
    return { asset: symbol, assetName, kind, day, move: round(move), excess: round(excess), z: z === null ? null : round(z, 1), level: levelOf(z), provisional: isProvisional(symbol, day) };
  };

  // 当日大盘是否异常：纳指 100 当日涨跌相当于此前 60 日波动的几倍。
  const benchZ = (day: number) => {
    if (!bench) return null;
    const j = bench.findIndex((b) => b[0] === day);
    if (j < 61) return null;
    const m = (bench[j][4] / bench[j - 1][4] - 1) * 100;
    const hist: number[] = [];
    for (let k = j - 1; k > j - 61; k--) hist.push((bench[k][4] / bench[k - 1][4] - 1) * 100);
    return { move: m, z: m / std(hist) };
  };

  const views: ChangeView[] = L.changes.map((c) => ({
    ...c,
    reactions: c.noReaction ? [] : assetsOf(c).map((a) => reactionOf(c, a.symbol, a.kind)),
    attribution: [],
  }));
  for (const v of views) {
    const seen = new Set<string>();
    for (const r of v.reactions) {
      if (r.day === null) continue;
      const others = views.filter((o) => o.id !== v.id && o.reactions.some((x) => x.asset === r.asset && x.day === r.day));
      if (others.length && !seen.has('same')) {
        seen.add('same');
        v.attribution.push(`同一交易日、同一标的另有 ${others.length} 条记录，这段波动不能单独归到本条。`);
      }
      if (r.kind === 'equity' && !seen.has('mkt')) {
        const bz = benchZ(r.day);
        if (bz && Math.abs(bz.z) >= 2) {
          seen.add('mkt');
          v.attribution.push(`当日纳指 100 ${bz.move > 0 ? '+' : '−'}${Math.abs(bz.move).toFixed(1)}%，约为其日常波动的 ${Math.abs(bz.z).toFixed(1)} 倍，属于全市场行情。`);
        }
      }
    }
  }
  views.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const weekAgo = new Date(`${asOf}T00:00:00Z`).getTime() - 7 * 864e5;
  const entities: EntityView[] = all.map((e: Entity) => {
    const s = e.ticker ? S.get(e.ticker) : undefined;
    return {
      ...e,
      stats: s ? statsOf(s.bars, bench, e.ticker!) : undefined,
      changeCount7d: L.changes.filter((c) => (c.entity === e.id || c.related?.includes(e.id)) && new Date(`${c.date}T00:00:00Z`).getTime() > weekAgo).length,
    };
  });

  // 回路：A 给 B 钱（订单 / 股权 / 担保），B 也以另一种方式给 A 钱。
  const real = L.relations.filter((r: Relation) => r.kind !== 'rate');
  const loops: Snapshot['loops'] = [];
  const pairSeen = new Set<string>();
  for (const r of real) {
    const key = [r.from, r.to].sort().join('|');
    if (pairSeen.has(key)) continue;
    const back = real.filter((x) => x.from === r.to && x.to === r.from);
    if (!back.length) continue;
    pairSeen.add(key);
    const fwd = real.filter((x) => x.from === r.from && x.to === r.to);
    loops.push({ a: r.from, b: r.to, relations: [...fwd, ...back].map((x) => x.id) });
  }

  // 收益率：三条曲线按日期对齐，只取最近一段连续的日线。
  const y5 = S.get('US5Y')?.bars ?? [];
  const y10 = S.get('US10Y')?.bars ?? [];
  const y30 = S.get('US30Y')?.bars ?? [];
  const m5 = new Map(y5.map((b) => [b[0], b[4]]));
  const m30 = new Map(y30.map((b) => [b[0], b[4]]));
  const daily = y10.filter((b) => m5.has(b[0]) && m30.has(b[0])).slice(-130)
    .map((b) => ({ date: b[0], y5: m5.get(b[0])!, y10: b[4], y30: m30.get(b[0])! }));
  const i5 = new Map(I.get('US5Y') ?? []);
  const i30 = new Map(I.get('US30Y') ?? []);
  const intraday = (I.get('US10Y') ?? []).filter(([t]) => i5.has(t) && i30.has(t))
    .map(([t, c]) => ({ t, y5: i5.get(t)!, y10: c, y30: i30.get(t)! }));

  return {
    meta: {
      asOf, asOfDate, generatedAt: new Date().toISOString(),
      live: Boolean(live?.connected), liveAt: live?.at ?? null, phase: live?.phase ?? 'closed', provisional: provisional.size > 0,
    },
    quotes: Object.fromEntries(live?.quotes ?? []),
    inbox: live?.inbox ?? [],
    entities, relations: L.relations, loops, metrics: L.metrics, changes: views,
    officials: L.officials, calendar: L.calendar, sources: L.sources,
    rates: { daily, intraday },
  };
}

export function seriesFor(symbol: string, n = 250) {
  const s = loadSeries().get(symbol);
  if (!s) return null;
  return { symbol, name: s.name, zh: s.zh, bars: s.bars.slice(-n).map((b) => [b[0], b[4]] as [number, number]) };
}
