// 云端只读版的数据：本机服务会现算的两种响应，在打包时提前算好，写成静态文件放进 dist-cloud/api/。
// 只用收盘数据，不带实时报价和待整理的标题；moomoo 的授权信息不会离开本机。
import fs from 'node:fs';
import path from 'node:path';
import { buildSnapshot, seriesFor } from '../server/compute.ts';
import { loadSeries, ROOT } from '../server/store.ts';

const out = path.join(ROOT, 'dist-cloud', 'api');
if (!fs.existsSync(path.join(ROOT, 'dist-cloud', 'index.html'))) {
  console.error('dist-cloud/ 里还没有打包好的前端，先跑 vite build --mode cloud（或直接 npm run build:cloud）。');
  process.exit(1);
}
fs.mkdirSync(path.join(out, 'series'), { recursive: true });

const snap = buildSnapshot();
fs.writeFileSync(path.join(out, 'snapshot.json'), JSON.stringify(snap));

let n = 0;
for (const symbol of loadSeries().keys()) {
  fs.writeFileSync(path.join(out, 'series', `${symbol}.json`), JSON.stringify(seriesFor(symbol, 250)));
  n++;
}
console.log(`静态数据：截至 ${snap.meta.asOf} 收盘 · 变动 ${snap.changes.length} · 关系 ${snap.relations.length} · 行情序列 ${n} → dist-cloud/api/`);
