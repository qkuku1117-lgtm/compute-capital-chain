// 账本自检：每次改完 data/ledger 之后跑 `npm run check`。
// 检查的是结构和引用，不检查事实对不对。
import { loadLedger, loadSeries } from '../server/store.ts';

const L = loadLedger();
const S = loadSeries();
const errors: string[] = [];
const warn: string[] = [];
const need = (ok: unknown, msg: string) => { if (!ok) errors.push(msg); };

const entityIds = new Set(L.entities.map((e) => e.id));
const metricIds = new Set(L.metrics.map((m) => m.id));
const calIds = new Set(L.calendar.map((c) => c.id));
const srcIds = new Set(Object.keys(L.sources));
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const unique = (ids: string[], what: string) => {
  const seen = new Set<string>();
  for (const id of ids) { need(!seen.has(id), `${what} id 重复：${id}`); seen.add(id); }
};

unique(L.entities.map((e) => e.id), '主体');
unique(L.relations.map((r) => r.id), '关系');
unique(L.metrics.map((m) => m.id), '指标');
unique(L.changes.map((c) => c.id), '变动');
unique(L.calendar.map((c) => c.id), '验证点');

for (const e of L.entities) {
  if (e.ticker) need(S.has(e.ticker), `主体 ${e.id}：data/series 里没有 ${e.ticker}`);
  for (const p of [...(e.proxies ?? []), ...(e.rates ?? [])]) need(S.has(p), `主体 ${e.id}：data/series 里没有 ${p}`);
  if (e.listed) need(isDate(e.listed), `主体 ${e.id}：上市日格式应为 YYYY-MM-DD`);
  if (e.ipo) {
    need(!e.ticker, `主体 ${e.id}：已经有 ticker 了，就不该再写 ipo`);
    need(e.ipo.ticker && e.ipo.range && e.ipo.steps.length > 0, `主体 ${e.id}：ipo 缺代码、区间或进度`);
    need(srcIds.has(e.ipo.src), `主体 ${e.id}：ipo 信源 ${e.ipo.src} 不存在`);
    let prev = '';
    for (const s of e.ipo.steps) {
      need(isDate(s.date), `主体 ${e.id}：ipo 进度"${s.label}"的日期格式不对`);
      need(s.date >= prev, `主体 ${e.id}：ipo 进度要按日期先后排`);
      if (s.src) need(srcIds.has(s.src), `主体 ${e.id}：ipo 进度信源 ${s.src} 不存在`);
      prev = s.date;
    }
    if (S.has(e.ipo.ticker)) warn.push(`主体 ${e.id}：${e.ipo.ticker} 已经有日线了，可以把 ipo 改成 ticker + listed`);
  }
}
for (const [id, s] of Object.entries(L.sources)) {
  need(s.pub && s.type, `信源 ${id}：缺发布方或类型`);
  if (!s.url && s.type !== 'data') warn.push(`信源 ${id}：没有链接`);
}
for (const r of L.relations) {
  need(entityIds.has(r.from) && entityIds.has(r.to), `关系 ${r.id}：主体不存在`);
  need(srcIds.has(r.src), `关系 ${r.id}：信源 ${r.src} 不存在`);
}
for (const m of L.metrics) {
  need(entityIds.has(m.entity), `指标 ${m.id}：主体不存在`);
  need(m.history.length > 0, `指标 ${m.id}：没有历史`);
  for (const h of m.history) need(srcIds.has(h.src), `指标 ${m.id}：信源 ${h.src} 不存在`);
}
for (const c of L.changes) {
  need(isDate(c.date), `变动 ${c.id}：日期格式应为 YYYY-MM-DD`);
  need(entityIds.has(c.entity), `变动 ${c.id}：主体不存在`);
  need(srcIds.has(c.src), `变动 ${c.id}：信源 ${c.src} 不存在`);
  need(['new', 'expected', 'repeat'].includes(c.novelty), `变动 ${c.id}：新增量取值不对`);
  need(['pre', 'intra', 'post'].includes(c.session), `变动 ${c.id}：时段取值不对`);
  need((c.related ?? []).length <= 2, `变动 ${c.id}：关联主体最多 2 个`);
  for (const r of c.related ?? []) need(entityIds.has(r), `变动 ${c.id}：关联主体 ${r} 不存在`);
  if (c.metric) need(metricIds.has(c.metric), `变动 ${c.id}：指标 ${c.metric} 不存在`);
  if (c.verify) need(calIds.has(c.verify), `变动 ${c.id}：验证点 ${c.verify} 不存在`);
  if (!c.verify) warn.push(`变动 ${c.id}：没有下一个验证点`);
}
for (const o of L.officials) for (const s of o.statements) {
  need(isDate(s.date), `官员 ${o.id}：发言日期格式不对`);
  need(srcIds.has(s.src), `官员 ${o.id}：信源 ${s.src} 不存在`);
}
for (const c of L.calendar) {
  need(c.date === '' || isDate(c.date), `验证点 ${c.id}：日期格式不对`);
  need(c.date !== '' || c.dateNote, `验证点 ${c.id}：没有日期时要写 dateNote`);
  need(entityIds.has(c.entity), `验证点 ${c.id}：主体不存在`);
  if (c.src) need(srcIds.has(c.src), `验证点 ${c.id}：信源 ${c.src} 不存在`);
}
const used = new Set<string>([
  ...L.relations.map((r) => r.src), ...L.changes.map((c) => c.src), ...L.calendar.map((c) => c.src ?? ''),
  ...L.metrics.flatMap((m) => m.history.map((h) => h.src)), ...L.officials.flatMap((o) => o.statements.map((s) => s.src)),
  ...L.entities.flatMap((e) => (e.ipo ? [e.ipo.src, ...e.ipo.steps.map((s) => s.src ?? '')] : [])),
]);
for (const id of srcIds) if (!used.has(id)) warn.push(`信源 ${id}：没有被引用`);

console.log(`主体 ${L.entities.length} · 关系 ${L.relations.length} · 指标 ${L.metrics.length} · 变动 ${L.changes.length} · 验证点 ${L.calendar.length} · 信源 ${srcIds.size} · 行情序列 ${S.size}`);
for (const w of warn) console.log(`  提示  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`  错误  ${e}`);
  process.exit(1);
}
console.log('数据结构检查通过。');
