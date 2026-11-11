import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Layer, MarketPhase, Novelty, ReactionLevel, RelationKind, Session, Snapshot, SourceType } from '../shared/types.ts';

export const PHASE_LABEL: Record<MarketPhase, string> = { pre: '盘前', regular: '盘中', post: '盘后', overnight: '夜盘', closed: '休市' };
export const KIND_CAL_LABEL = { data: '数据', earnings: '财报', fed: '联储', deal: '交易', other: '其他' } as const;
export const clock = (ms: number) => new Date(ms).toLocaleTimeString('zh-CN', { hour12: false });

// ---- 文案 ----
export const LAYER_LABEL: Record<Layer, string> = {
  capital: '资金成本', model: 'AI Lab', cloud: '云与超大厂', neocloud: 'Neocloud', hardware: '硬件', chain: '全链条',
};
export const SOURCE_LABEL: Record<SourceType, string> = {
  filing: '一手披露', media: '媒体报道', anon: '匿名消息', research: '机构研究', data: '行情数据', aggregate: '二手汇总', personal: '个人账号',
};
export const NOVELTY_LABEL: Record<Novelty, string> = { new: '新增', expected: '符合预期', repeat: '重复' };
export const SESSION_LABEL: Record<Session, string> = { pre: '盘前', intra: '盘中', post: '盘后' };
export const LEVEL_LABEL: Record<ReactionLevel, string> = { strong: '显著', mild: '轻微', none: '无明显反应', pending: '待收盘' };
export const KIND_LABEL: Record<RelationKind, string> = { order: '订单', equity: '股权', credit: '信贷', rate: '利率' };

// ---- 格式 ----
const MINUS = '−';
export const signed = (x: number, digits = 2) => `${x > 0 ? '+' : x < 0 ? MINUS : ''}${Math.abs(x).toFixed(digits)}`;
export const pct = (x: number, digits = 2) => `${signed(x, digits)}%`;
export const arrow = (x: number) => (x > 0 ? '▲' : x < 0 ? '▼' : '–');
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
export const parseIso = (iso: string) => new Date(`${iso}T00:00:00`);
export const longDate = (iso: string) => {
  const d = parseIso(iso);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${WEEK[d.getDay()]}`;
};
export const shortDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : iso);
export const intToIso = (d: number) => `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6, 8)}`;
export const daysBetween = (fromIso: string, toIso: string) => Math.round((parseIso(toIso).getTime() - parseIso(fromIso).getTime()) / 864e5);
export const price = (x: number) => (x >= 1000 ? x.toFixed(0) : x >= 100 ? x.toFixed(1) : x.toFixed(2));
/** 十亿美元 → $40B / $1.2T */
export const bn = (x: number) => (x >= 1000 ? `$${Number((x / 1000).toFixed(2))}T` : `$${Number(x.toFixed(1))}B`);
const trim = (x: number) => String(Number(x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2)));
/** 带单位的数值：$B 自动进到 $T，其余直接拼上单位 */
export const withUnit = (v: number, unit?: string) => {
  const a = Math.abs(v);
  const sign = v < 0 ? MINUS : '';
  if (unit === '$B') return `${sign}${a >= 1000 ? `$${Number((a / 1000).toFixed(2))}T` : `$${trim(a)}B`}`;
  if (unit === 'NT$B') return `${sign}NT$${trim(a)}B`;
  return `${sign}${trim(a)}${unit ?? ''}`;
};
/** 两次读数之间差了多少，只做算术：百分比和基点给差值，其余给百分比，跨过零的给差值。 */
export function stepOf(prev: number, cur: number, unit?: string): { dir: number; text: string } {
  const diff = cur - prev;
  if (diff === 0) return { dir: 0, text: '持平' };
  const a = Math.abs(diff);
  if (unit === '%') return { dir: diff, text: `${Number(a.toFixed(1))} 百分点` };
  if (unit === 'bp') return { dir: diff, text: `${Number(a.toFixed(1))}bp` };
  if (prev > 0 && cur > 0) {
    const p = Math.abs(cur / prev - 1) * 100;
    return { dir: diff, text: `${p >= 10 ? p.toFixed(0) : p.toFixed(1)}%` };
  }
  return { dir: diff, text: withUnit(a, unit) };
}
/** 读数原文里括号前面的那一段 */
export const mainText = (t: string) => t.split('（')[0];
/** 记录的时点：今年的不带年份 */
export const asOfLabel = (asOf: string) => {
  const thisYear = String(new Date().getFullYear());
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf);
  if (day) return `${day[1] === thisYear ? '' : `${day[1]}/`}${Number(day[2])}/${Number(day[3])}`;
  const month = /^(\d{4})-(\d{2})$/.exec(asOf);
  if (month) return month[1] === thisYear ? `${Number(month[2])} 月` : `${month[1]}/${Number(month[2])}`;
  const quarter = /^(\d{4})-(Q\d)$/.exec(asOf);
  if (quarter) return quarter[1] === thisYear ? quarter[2] : `${quarter[1]} ${quarter[2]}`;
  return asOf;
};
export const todayIso = () => new Date().toLocaleDateString('sv');
export const countdown = (iso: string) => {
  const d = daysBetween(todayIso(), iso);
  return d === 0 ? '今天' : d === 1 ? '明天' : d > 0 ? `${d} 天后` : `已过 ${-d} 天`;
};

// ---- 路由：#/视图?e=主体 ----
export type ViewId = 'map' | 'ledger' | 'rates' | 'verify';
export interface Route { view: ViewId; entity: string | null }
const VIEWS: ViewId[] = ['map', 'ledger', 'rates', 'verify'];

export function parseHash(hash: string): Route {
  const [pathPart, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const view = (VIEWS as string[]).includes(pathPart) ? (pathPart as ViewId) : 'map';
  return { view, entity: new URLSearchParams(query).get('e') };
}
export const hrefFor = (view: ViewId, entity?: string | null) => `#/${view}${entity ? `?e=${entity}` : ''}`;

/** 换视图时用 View Transition 过渡，结束后把焦点交给新视图的标题；只开关档案时不做过渡。 */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    let current = parseHash(location.hash).view;
    const focusHeading = () => document.getElementById('view-heading')?.focus({ preventScroll: true });
    const on = () => {
      const next = parseHash(location.hash);
      const viewChanged = next.view !== current;
      current = next.view;
      if (!viewChanged) { setRoute(next); return; }
      const swap = () => { flushSync(() => setRoute(next)); window.scrollTo(0, 0); };
      if (!document.startViewTransition) {
        swap();
        focusHeading();
        return;
      }
      const transition = document.startViewTransition(swap);
      // 页面在后台、或连续快速换页时，过渡会被跳过并让这两个 promise 报错；视图本身照常切换，所以两种结果都只做同一件事
      transition.ready.catch(() => {});
      transition.finished.then(focusHeading, focusHeading);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

// ---- 数据 ----
/** 云端只读版（npm run build:cloud）：没有本机服务，数据是打包时算好的静态文件，也没有实时通道。 */
export const STATIC = import.meta.env.VITE_STATIC === '1';
const snapshotUrl = STATIC ? '/api/snapshot.json' : '/api/snapshot';
const seriesUrl = (symbol: string) => (STATIC ? `/api/series/${symbol}.json` : `/api/series/${symbol}?n=250`);

export function useSnapshot() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await fetch(snapshotUrl);
      if (!res.ok) throw new Error(`数据服务返回 ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  // 服务还没起来或正在重启时，隔几秒再试，不需要手动刷新
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => { void reload(); }, 3000);
    return () => clearTimeout(t);
  }, [error, reload]);
  return { data, error, reload };
}

export function useSeries(symbol: string | undefined) {
  const [bars, setBars] = useState<[number, number][] | null>(null);
  useEffect(() => {
    setBars(null);
    if (!symbol) return;
    let alive = true;
    fetch(seriesUrl(symbol)).then((r) => r.json()).then((j) => { if (alive && j.bars) setBars(j.bars); }).catch(() => {});
    return () => { alive = false; };
  }, [symbol]);
  return bars;
}

/** 多个标的的收盘价，按共同交易日对齐。 */
export function useSeriesMany(symbols: string[]) {
  const key = symbols.join(',');
  const [out, setOut] = useState<{ dates: number[]; series: Record<string, number[]> } | null>(null);
  useEffect(() => {
    setOut(null);
    if (!key) return;
    let alive = true;
    const list = key.split(',');
    Promise.all(list.map((s) => fetch(seriesUrl(s)).then((r) => r.json()))).then((all) => {
      if (!alive) return;
      const maps = all.map((j) => new Map<number, number>(j.bars ?? []));
      const dates = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).sort((a, b) => a - b);
      setOut({ dates, series: Object.fromEntries(list.map((s, i) => [s, dates.map((d) => maps[i].get(d)!)])) });
    }).catch(() => {});
    return () => { alive = false; };
  }, [key]);
  return out;
}

// ---- 实时通道 ----
export interface LiveState {
  connected: boolean;
  /** 需要用户本人去点的 moomoo 授权页 */
  authUrl: string | null;
  busy: boolean;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
}

/** 订阅服务端的 SSE：行情或未入账标题有更新就重取账面。授权由用户自己在 moomoo 页面完成。 */
export function useLive(reload: () => void): LiveState {
  const [connected, setConnected] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    // 电脑睡眠或标签页切回来之后，马上取一次最新数据
    const onVisible = () => { if (!document.hidden) reloadRef.current(); };
    document.addEventListener('visibilitychange', onVisible);
    // 云端只读版没有实时通道：只在切回页面时重取一次，这样重新发布之后不用手动刷新
    if (STATIC) return () => document.removeEventListener('visibilitychange', onVisible);
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    let lastSeen = Date.now();
    const open = () => {
      clearTimeout(retry);
      es?.close();
      lastSeen = Date.now();
      const stream = new EventSource('/api/live/stream');
      es = stream;
      stream.addEventListener('ping', () => { lastSeen = Date.now(); });
      stream.addEventListener('tick', (ev) => {
        lastSeen = Date.now();
        try {
          const msg = JSON.parse((ev as MessageEvent).data);
          setConnected(Boolean(msg.connected));
          if (msg.connected) setAuthUrl(null);
        } catch { /* 忽略坏包 */ }
        if (!first) reloadRef.current();
        first = false;
      });
      // 服务重启时浏览器会放弃这条流（收到非 200 就不再自动重连），这里自己隔几秒重开
      stream.addEventListener('error', () => {
        if (stream.readyState !== EventSource.CLOSED) return;
        setConnected(false);
        retry = setTimeout(open, 3000);
      });
    };
    open();
    // 断流自检：服务端每秒都会发一次心跳。连接还"开着"却收不到任何东西（比如服务重启后代理把连接挂住），就关掉重开。
    const watchdog = setInterval(() => { if (Date.now() - lastSeen > 8000) open(); }, 4000);
    return () => { clearInterval(watchdog); clearTimeout(retry); document.removeEventListener('visibilitychange', onVisible); es?.close(); };
  }, []);

  const connect = useCallback(() => {
    setBusy(true);
    setError(null);
    fetch('/api/live/connect', { method: 'POST' }).then((r) => r.json()).then((j) => {
      if (j.connected) { setConnected(true); setAuthUrl(null); reloadRef.current(); }
      else if (j.authUrl) setAuthUrl(j.authUrl);
      else setError(j.error ?? '没有连上');
    }).catch((err) => setError(String(err))).finally(() => setBusy(false));
  }, []);

  const disconnect = useCallback(() => {
    fetch('/api/live/disconnect', { method: 'POST' }).then(() => { setConnected(false); reloadRef.current(); }).catch(() => {});
  }, []);

  return { connected, authUrl, busy, error, connect, disconnect };
}

// ---- 量宽度：图按容器的实际像素画，字号不跟着缩放 ----
export function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// ---- 关掉档案抽屉：能用 CSS 做退场动画的浏览器直接关；不能的先打标记、等动画播完再关 ----
let displayTransition: boolean | undefined;
function canTransitionDisplay() {
  if (displayTransition !== undefined) return displayTransition;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) return false;
  const probe = document.createElement('div');
  // 这里故意用简写：不认识 allow-discrete 的浏览器会丢掉整条声明，探测结果自然是 false
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  void getComputedStyle(probe).display;
  probe.style.display = 'none';
  displayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return displayTransition;
}
const supportsTopLayerExit = () => Boolean(window.CSS?.supports?.('overlay', 'auto')) && canTransitionDisplay();

export async function closeTopLayer(el: HTMLDialogElement) {
  if (!el.open) return;
  if (!supportsTopLayerExit()) {
    el.setAttribute('data-closing', '');
    const animations = el.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
    }
    if (!el.hasAttribute('data-closing')) return; // 等待期间又被重新打开了
    el.removeAttribute('data-closing');
  }
  el.close();
}

// ---- 明暗切换：只存"和系统不一样"的那一次选择 ----
export function toggleScheme() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!meta) return;
  const system = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const rendered = meta.content === 'light' || meta.content === 'dark' ? meta.content : system;
  const target = rendered === 'dark' ? 'light' : 'dark';
  try {
    if (target !== system) localStorage.setItem('color-scheme', target);
    else localStorage.removeItem('color-scheme');
  } catch { /* 存不了也照样切换 */ }
  meta.content = target !== system ? target : 'light dark';
}

export function useSchemeSync() {
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key !== 'color-scheme') return;
      const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
      if (meta) meta.content = e.newValue ?? 'light dark';
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
}

export const std = (xs: number[]) => {
  if (xs.length < 2) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
