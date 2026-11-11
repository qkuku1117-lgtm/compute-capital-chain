// 把 moomoo MCP 的 K 线原始返回（quote_history_kline 的 JSON 文本）转成账本用的紧凑序列。
// 用法：node scripts/import-klines.mjs <目录或文件> [<目录或文件> ...]
// 日线写到 data/series/<代码>.json，5 分钟线写到 data/intraday/<代码>.json。
// 同一代码多次导入会按日期合并，新数据覆盖旧数据。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 返回里没有代码字段，只能按名称认。新增标的时在这里加一行。
const NAMES = [
  ['NVIDIA', 'NVDA'], ['Broadcom', 'AVGO'], ['Advanced Micro Devices', 'AMD'], ['Micron Technology', 'MU'],
  ['Taiwan Semiconductor', 'TSM'], ['Microsoft', 'MSFT'], ['Alphabet-A', 'GOOGL'], ['Amazon', 'AMZN'],
  ['Meta Platforms', 'META'], ['Oracle', 'ORCL'], ['CoreWeave', 'CRWV'], ['NEBIUS', 'NBIS'], ['SpaceX', 'SPCX'], ['Anthropic', 'ANT'],
  ['Invesco QQQ', 'QQQ'], ['iShares Semiconductor', 'SOXX'], ['SPDR S&P 500', 'SPY'],
  ['Iboxx $ High Yield', 'HYG'], ['20+ Year Treasury', 'TLT'], ['CBOE Volatility', 'VIX'],
  ['Interest Rate 10 Year', 'US10Y'], ['Treasury Yield 5 Years', 'US5Y'], ['Treasury Yield 30 Years', 'US30Y'],
];
const YIELDS = new Set(['US5Y', 'US10Y', 'US30Y']);
const symbolOf = (name) => NAMES.find(([frag]) => name.includes(frag))?.[1];

const files = [];
for (const arg of process.argv.slice(2)) {
  const st = fs.statSync(arg);
  if (st.isDirectory()) for (const f of fs.readdirSync(arg)) { if (f.includes('kline')) files.push(path.join(arg, f)); }
  else files.push(arg);
}
if (!files.length) { console.error('没有输入文件'); process.exit(1); }

const daily = new Map();
const intraday = new Map();
let skipped = 0;
for (const f of files) {
  let list;
  try { list = JSON.parse(fs.readFileSync(f, 'utf8')).data.kline_list; } catch { skipped++; continue; }
  if (!list?.length) { skipped++; continue; }
  const sym = symbolOf(list[0].name);
  if (!sym) { skipped++; continue; }
  const scale = YIELDS.has(sym) ? 0.1 : 1; // 收益率指数的报价是收益率 ×10
  const r = (x) => Math.round(x * scale * 10000) / 10000;
  const isIntraday = new Set(list.map((b) => b.date)).size < list.length;
  const target = isIntraday ? intraday : daily;
  const bucket = target.get(sym) ?? { name: list[0].name, zh: list[0].sc_name, rows: new Map() };
  for (const b of list) {
    if (isIntraday) bucket.rows.set(b.time_key, [b.time_key, r(b.close)]);
    else bucket.rows.set(b.date, [b.date, r(b.open), r(b.high), r(b.low), r(b.close), b.volume]);
  }
  target.set(sym, bucket);
}

const write = (dir, sym, bucket, extra) => {
  const out = path.join(ROOT, 'data', dir, `${sym}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let prev = [];
  try { prev = JSON.parse(fs.readFileSync(out, 'utf8')).bars; } catch { /* 首次导入 */ }
  const merged = new Map(prev.map((row) => [row[0], row]));
  for (const [k, row] of bucket.rows) merged.set(k, row);
  const bars = [...merged.values()].sort((a, b) => a[0] - b[0]);
  fs.writeFileSync(out, JSON.stringify({ symbol: sym, name: bucket.name, zh: bucket.zh, ...extra, bars }));
  return bars;
};

for (const [sym, bucket] of daily) {
  const bars = write('series', sym, bucket, { kind: YIELDS.has(sym) ? 'yield' : 'price', columns: ['date', 'open', 'high', 'low', 'close', 'volume'] });
  console.log(`日线 ${sym.padEnd(6)} ${bars.length} 根  ${bars[0][0]} → ${bars.at(-1)[0]}  收 ${bars.at(-1)[4]}`);
}
for (const [sym, bucket] of intraday) {
  const bars = write('intraday', sym, bucket, { kind: YIELDS.has(sym) ? 'yield' : 'price', columns: ['timeMs', 'close'] });
  console.log(`5分钟 ${sym.padEnd(6)} ${bars.length} 根`);
}
if (skipped) console.log(`跳过 ${skipped} 个无法识别的文件`);
