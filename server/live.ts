// moomoo 实时通道。
// 本地服务自己作为一个 MCP 客户端连 moomoo：第一次需要你在浏览器里点授权，
// 之后令牌存在本机 .local/moomoo-auth.json（已 gitignore），不进仓库，也不发给任何第三方。
// 连上之后：每隔几秒取一次全部标的的快照 → 更新叠加层 → 通过 SSE 通知页面重取账面。
// 这里只调用只读的行情和资讯工具，不碰账户和交易。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { InboxItem, LiveQuote, MarketPhase } from '../shared/types.ts';
import type { LiveOverlay } from './compute.ts';
import { loadLedger, loadSeries, mergeSeries, ROOT, type Bar } from './store.ts';

const MCP_URL = new URL(process.env.MOOMOO_MCP_URL ?? 'https://mcp.moomoo.com/mcp');
const API_ORIGIN = `http://127.0.0.1:${process.env.API_PORT ?? 8790}`;
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
const AUTH_FILE = path.join(ROOT, '.local', 'moomoo-auth.json');
const QUOTE_MS = Number(process.env.LIVE_QUOTE_MS ?? 10_000); // 交易时段的行情间隔
const IDLE_MS = 60_000; // 休市时的间隔
const NEWS_MS = Number(process.env.LIVE_NEWS_MS ?? 30_000); // 每隔这么久查一个主体的资讯
// 只申请"读行情"。moomoo 默认会给包含交易在内的全部权限，这个看板用不到，也不应该拿。
const SCOPE = process.env.MOOMOO_SCOPE ?? 'quote:read';
// 这个服务只允许调用下面三个只读工具；即使将来改代码时写错了名字，也不会碰到账户或下单。
const ALLOWED_TOOLS = new Set(['quote_market_snapshot', 'quote_history_kline', 'news_search']);

// 账本代码 ↔ moomoo 代码
const YIELD_CODES: Record<string, string> = { US5Y: 'US..FVX', US10Y: 'US..TNX', US30Y: 'US..TYX' };
const isYield = (sym: string) => sym in YIELD_CODES;
const moomooCode = (sym: string) => YIELD_CODES[sym] ?? (sym === 'VIX' ? 'US..VIX' : `US.${sym}`);

type Stored = { client?: unknown; tokens?: unknown; verifier?: string; state?: string };
const readStore = (): Stored => { try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch { return {}; } };
const writeStore = (patch: Stored) => {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ ...readStore(), ...patch }, null, 2), { mode: 0o600 });
};

let pendingAuthUrl: string | null = null;
let transport: StreamableHTTPClientTransport | null = null;
let client: Client | null = null;
let lastError: string | null = null;
let lastPersist: { at: string; symbols: number; asOf: number } | null = null;
let tick = 0;
let loopTimer: NodeJS.Timeout | null = null;
let newsTimer: NodeJS.Timeout | null = null;
let lastPhase: MarketPhase = 'closed';

const overlay: LiveOverlay = { connected: false, phase: 'closed', at: null, quotes: new Map(), bars: new Map(), inbox: [] };
export const liveOverlay = () => overlay;

const provider: OAuthClientProvider = {
  get redirectUrl() { return `${API_ORIGIN}/api/live/callback`; },
  get clientMetadata() {
    return {
      client_name: 'Compute Ledger (local)',
      redirect_uris: [`${API_ORIGIN}/api/live/callback`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  },
  clientInformation: () => readStore().client as never,
  saveClientInformation: (info) => writeStore({ client: info }),
  tokens: () => readStore().tokens as never,
  saveTokens: (tokens) => writeStore({ tokens }),
  redirectToAuthorization: (url) => {
    const narrowed = new URL(url);
    narrowed.searchParams.set('scope', SCOPE);
    pendingAuthUrl = narrowed.toString();
  },
  // moomoo 的授权页要求带 state；回调时再核对一遍，确认回来的就是这一次发起的授权。
  state: () => {
    const state = crypto.randomBytes(16).toString('hex');
    writeStore({ state });
    return state;
  },
  saveCodeVerifier: (verifier) => writeStore({ verifier }),
  codeVerifier: () => readStore().verifier ?? '',
};

// ---- 美东时间与交易时段 ----
function eastern(ms = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    dateInt: Number(`${parts.year}${parts.month}${parts.day}`),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekend: parts.weekday === 'Sat' || parts.weekday === 'Sun',
  };
}
function marketPhase(): MarketPhase {
  const { minutes, weekend } = eastern();
  if (weekend) return 'closed';
  if (minutes >= 240 && minutes < 570) return 'pre';
  if (minutes >= 570 && minutes < 960) return 'regular';
  if (minutes >= 960 && minutes < 1200) return 'post';
  return 'overnight';
}

// ---- 调用 moomoo 工具 ----
async function callJson(name: string, args: Record<string, unknown>) {
  if (!ALLOWED_TOOLS.has(name)) throw new Error(`不允许调用 ${name}`);
  const res = await client!.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text?: string }[]).find((p) => p.type === 'text')?.text ?? '';
  return JSON.parse(text);
}

function trackedSymbols() {
  const symbols = new Set<string>(['QQQ', 'SOXX', 'HYG']);
  for (const e of loadLedger().entities) {
    if (e.ticker) symbols.add(e.ticker);
    // IPO 中的代码也一起问：开始交易之前快照是空的，开始交易那一刻报价就自己出现了
    if (e.ipo) symbols.add(e.ipo.ticker);
    for (const r of e.rates ?? []) symbols.add(r);
  }
  return [...symbols];
}

interface Snap {
  code: string; last_price: number; prev_close_price: number; open_price: number; high_price: number; low_price: number; volume: number; update_time: number;
  pre_price?: number; pre_change_rate?: number; after_price?: number; after_change_rate?: number; overnight_price?: number; overnight_change_rate?: number;
}

const round = (x: number, digits: number) => Number(x.toFixed(digits));

function applySnapshot(list: Snap[], phase: MarketPhase) {
  const series = loadSeries();
  const today = eastern().dateInt;
  const byCode = new Map(trackedSymbols().map((s) => [moomooCode(s), s]));
  for (const q of list) {
    const sym = byCode.get(q.code);
    if (!sym || !q.last_price) continue;
    if (isYield(sym)) {
      overlay.quotes.set(sym, { price: round(q.last_price / 10, 3), chg: round((q.last_price - q.prev_close_price) * 10, 1), unit: 'bp', phase, at: q.update_time });
    } else {
      // 上市第一天没有"昨收"
      const regular = { price: q.last_price, chg: q.prev_close_price ? (q.last_price / q.prev_close_price - 1) * 100 : 0 };
      const ext =
        phase === 'pre' && q.pre_price ? { price: q.pre_price, chg: q.pre_change_rate ?? 0 }
        : phase === 'post' && q.after_price ? { price: q.after_price, chg: q.after_change_rate ?? 0 }
        : (phase === 'overnight' || phase === 'closed') && q.overnight_price ? { price: q.overnight_price, chg: q.overnight_change_rate ?? 0 }
        : regular;
      overlay.quotes.set(sym, { price: ext.price, chg: round(ext.chg, 3), unit: '%', phase, at: q.update_time });
    }
    // 暂计日线：常规时段已经开始、而且快照里的"昨收"对得上账本里最后一根收盘，才接上去。
    const bars = series.get(sym)?.bars;
    const lastBar = bars?.[bars.length - 1];
    const k = isYield(sym) ? 0.1 : 1;
    const started = (phase === 'regular' || phase === 'post') && eastern(q.update_time).dateInt === today;
    if (lastBar && started && today > lastBar[0] && Math.abs(q.prev_close_price * k - lastBar[4]) / lastBar[4] < 0.002) {
      overlay.bars.set(sym, [today, q.open_price * k, q.high_price * k, q.low_price * k, q.last_price * k, q.volume]);
    } else {
      overlay.bars.delete(sym);
    }
  }
}

async function pollQuotes() {
  if (!client) return;
  const phase = marketPhase();
  overlay.phase = phase;
  const symbols = trackedSymbols();
  try {
    const eq = await callJson('quote_market_snapshot', { code_list: symbols.filter((s) => !isYield(s)).map(moomooCode) });
    applySnapshot(eq.data?.snapshot_list ?? [], phase);
    try {
      const ys = await callJson('quote_market_snapshot', { code_list: symbols.filter(isYield).map(moomooCode) });
      applySnapshot(ys.data?.snapshot_list ?? [], phase);
    } catch { /* 收益率指数取不到快照时，只影响利率的实时显示 */ }
    overlay.at = Date.now();
    lastError = null;
    tick++;
    // 收盘那一刻把正式日线落盘，暂计数字随之被替换。
    if (lastPhase === 'regular' && phase === 'post') void persistDaily();
    lastPhase = phase;
  } catch (err) {
    lastError = String(err);
    if (err instanceof UnauthorizedError) { client = null; overlay.connected = false; stopLoops(); }
  }
}

// ---- 未入账标题：轮流按主体名搜最新资讯，只取标题 / 发布方 / 时间 / 链接 ----
let newsCursor = 0;
function pickList(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.length && typeof node[0] === 'object' && node[0] && 'title' in (node[0] as object) ? (node as Record<string, unknown>[]) : [];
  if (node && typeof node === 'object') for (const v of Object.values(node)) { const found = pickList(v); if (found.length) return found; }
  return [];
}
const firstOf = (o: Record<string, unknown>, keys: string[]) => { for (const k of keys) if (o[k]) return o[k]; return undefined; };

async function pollNews() {
  if (!client) return;
  const entities = loadLedger().entities.filter((e) => e.layer !== 'chain' && e.id !== 'ust' && e.id !== 'credit');
  const e = entities[newsCursor++ % entities.length];
  try {
    const res = await callJson('news_search', { keyword: e.id === 'fed' ? 'Federal Reserve' : e.name, page_size: 5, sort_type: 'TIME', lang: 'en' });
    for (const it of pickList(res)) {
      const title = String(it.title ?? '').trim();
      if (!title || overlay.inbox.some((x) => x.title === title)) continue;
      const rawTime = Number(firstOf(it, ['publish_time', 'time', 'create_time', 'timestamp']) ?? 0);
      overlay.inbox.push({
        id: `${e.id}-${rawTime || title.length}-${overlay.inbox.length}`,
        title,
        pub: String(firstOf(it, ['source', 'source_name', 'media', 'author']) ?? 'moomoo 资讯'),
        time: rawTime < 1e12 ? rawTime * 1000 : rawTime,
        url: firstOf(it, ['url', 'detail_url', 'share_url', 'link']) as string | undefined,
        entity: e.id,
      });
    }
    overlay.inbox.sort((a, b) => b.time - a.time);
    overlay.inbox.length = Math.min(overlay.inbox.length, 60);
    tick++;
  } catch { /* 资讯是尽力而为，不影响行情 */ }
}

function startLoops() {
  stopLoops();
  const loop = async () => {
    await pollQuotes();
    if (client) loopTimer = setTimeout(loop, overlay.phase === 'closed' || overlay.phase === 'overnight' ? IDLE_MS : QUOTE_MS);
  };
  void loop();
  newsTimer = setInterval(() => void pollNews(), NEWS_MS);
  void pollNews();
}
function stopLoops() {
  if (loopTimer) clearTimeout(loopTimer);
  if (newsTimer) clearInterval(newsTimer);
  loopTimer = null;
  newsTimer = null;
}

async function connect(): Promise<'connected' | 'needs-auth'> {
  transport = new StreamableHTTPClientTransport(MCP_URL, { authProvider: provider });
  const c = new Client({ name: 'compute-ledger', version: '0.1.0' });
  try {
    await c.connect(transport);
    client = c;
    overlay.connected = true;
    lastError = null;
    startLoops();
    void persistDaily(); // 补上离线期间缺的日线
    return 'connected';
  } catch (err) {
    client = null;
    overlay.connected = false;
    if (err instanceof UnauthorizedError && pendingAuthUrl) return 'needs-auth';
    lastError = String(err);
    throw err;
  }
}

/** 拉最近 40 根正式日线合并进 data/series；本地还没有或很短的新标的，第一次拉满一年。逐个标的拉，中间停一下，不并发。 */
async function persistDaily() {
  if (!client) return null;
  const end = new Date().toISOString().slice(0, 10);
  const failed: string[] = [];
  let asOf = 0;
  const symbols = trackedSymbols();
  const local = loadSeries();
  for (const sym of symbols) {
    try {
      const j = await callJson('quote_history_kline', { symbol: moomooCode(sym), end, num: (local.get(sym)?.bars.length ?? 0) < 60 ? 370 : 40 });
      const list = (j.data?.kline_list ?? []) as { date: number; open: number; high: number; low: number; close: number; volume: number; name: string; sc_name: string }[];
      const k = isYield(sym) ? 0.1 : 1;
      const r = (x: number) => Math.round(x * k * 10000) / 10000;
      if (list.length) {
        mergeSeries(sym, list[0].name, list[0].sc_name, isYield(sym) ? 'yield' : 'price', list.map((b) => [b.date, r(b.open), r(b.high), r(b.low), r(b.close), b.volume] as Bar));
        asOf = Math.max(asOf, list[list.length - 1].date);
      }
    } catch (err) {
      failed.push(`${sym}: ${String(err).slice(0, 80)}`);
    }
    await new Promise((res) => setTimeout(res, 400));
  }
  lastPersist = { at: new Date().toISOString(), symbols: symbols.length - failed.length, asOf };
  tick++;
  return { ...lastPersist, failed };
}

export const liveStatus = () => ({
  connected: client !== null,
  hasTokens: Boolean(readStore().tokens),
  phase: overlay.phase,
  at: overlay.at,
  quoteIntervalMs: QUOTE_MS,
  lastPersist,
  error: lastError,
});

export const liveRoutes = new Hono();

liveRoutes.get('/status', (c) => c.json(liveStatus()));

liveRoutes.post('/connect', async (c) => {
  try {
    const state = await connect();
    return c.json(state === 'connected' ? { connected: true } : { connected: false, authUrl: pendingAuthUrl });
  } catch (err) {
    return c.json({ connected: false, error: String(err) }, 502);
  }
});

// moomoo 授权完成后，浏览器会带着 code 回到这里。
liveRoutes.get('/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.text(`授权没有完成：${c.req.query('error_description') ?? c.req.query('error') ?? '缺少授权码'}`, 400);
  const expected = readStore().state;
  if (!expected || c.req.query('state') !== expected) return c.text('授权回调和本次发起的请求对不上，请回到看板重新点"接通实时"。', 400);
  try {
    if (!transport) transport = new StreamableHTTPClientTransport(MCP_URL, { authProvider: provider });
    await transport.finishAuth(code);
    pendingAuthUrl = null;
    await connect();
    return c.redirect(`${WEB_ORIGIN}/#/map`);
  } catch (err) {
    lastError = String(err);
    return c.text(`授权没有完成：${String(err)}`, 502);
  }
});

// 页面订阅这个流；每次叠加层有更新就发一个 tick，页面收到后重取账面。
liveRoutes.get('/stream', (c) => streamSSE(c, async (stream) => {
  let alive = true;
  stream.onAbort(() => { alive = false; });
  let seen = -1;
  while (alive) {
    if (tick !== seen) {
      seen = tick;
      await stream.writeSSE({ event: 'tick', data: JSON.stringify({ tick, at: overlay.at, phase: overlay.phase, connected: overlay.connected }) });
    } else {
      await stream.writeSSE({ event: 'ping', data: '' });
    }
    await stream.sleep(1000);
  }
}));

liveRoutes.post('/persist', async (c) => {
  if (!client) return c.json({ error: 'not-connected' }, 409);
  return c.json(await persistDaily());
});

liveRoutes.post('/disconnect', async (c) => {
  stopLoops();
  try { await client?.close(); } catch { /* 已断开 */ }
  client = null;
  transport = null;
  overlay.connected = false;
  overlay.quotes.clear();
  overlay.bars.clear();
  try { fs.rmSync(AUTH_FILE); } catch { /* 本来就没有 */ }
  tick++;
  return c.json({ connected: false });
});

// 本机已经授权过的话，服务一启动就自动连上。
if (readStore().tokens) connect().catch(() => { /* 令牌失效时等用户重新点连接 */ });
