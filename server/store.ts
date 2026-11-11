// 读账本文件。账本就是 data/ 下的 JSON，没有数据库。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CalendarItem, Change, Entity, Metric, Official, Relation, Source } from '../shared/types.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(ROOT, 'data');

/** 日线：[date(yyyymmdd), open, high, low, close, volume] */
export type Bar = [number, number, number, number, number, number];

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

export interface Ledger {
  entities: Entity[];
  relations: Relation[];
  metrics: Metric[];
  changes: Change[];
  officials: Official[];
  calendar: CalendarItem[];
  sources: Record<string, Source>;
}

export function loadLedger(): Ledger {
  const dir = path.join(DATA, 'ledger');
  return {
    entities: readJson(path.join(dir, 'entities.json')),
    relations: readJson(path.join(dir, 'relations.json')),
    metrics: readJson(path.join(dir, 'metrics.json')),
    changes: readJson(path.join(dir, 'changes.json')),
    officials: readJson(path.join(dir, 'officials.json')),
    calendar: readJson(path.join(dir, 'calendar.json')),
    sources: readJson(path.join(dir, 'sources.json')),
  };
}

export function loadSeries(): Map<string, { name: string; zh: string; bars: Bar[] }> {
  const out = new Map<string, { name: string; zh: string; bars: Bar[] }>();
  const dir = path.join(DATA, 'series');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const s = readJson<{ symbol: string; name: string; zh: string; bars: Bar[] }>(path.join(dir, f));
    out.set(s.symbol, { name: s.name, zh: s.zh, bars: s.bars });
  }
  return out;
}

export function loadIntraday(): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  const dir = path.join(DATA, 'intraday');
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const s = readJson<{ symbol: string; bars: [number, number][] }>(path.join(dir, f));
    out.set(s.symbol, s.bars);
  }
  return out;
}

/** 合并写入一条日线序列（实时刷新用）。 */
export function mergeSeries(symbol: string, name: string, zh: string, kind: 'price' | 'yield', bars: Bar[]) {
  const file = path.join(DATA, 'series', `${symbol}.json`);
  let prev: Bar[] = [];
  try { prev = readJson<{ bars: Bar[] }>(file).bars; } catch { /* 新标的 */ }
  const merged = new Map<number, Bar>(prev.map((b) => [b[0], b]));
  for (const b of bars) merged.set(b[0], b);
  const all = [...merged.values()].sort((a, b) => a[0] - b[0]);
  fs.writeFileSync(file, JSON.stringify({ symbol, name, zh, kind, columns: ['date', 'open', 'high', 'low', 'close', 'volume'], bars: all }));
  return all.length;
}
