// 账本 API。用 Hono 写，本地跑在 Node 上；路由本身不依赖 Node，之后可以搬到 Workers。
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { buildSnapshot, seriesFor } from './compute.ts';
import { liveOverlay, liveRoutes } from './live.ts';
import { ROOT } from './store.ts';

const app = new Hono();

app.get('/api/snapshot', (c) => {
  try {
    return c.json(buildSnapshot(liveOverlay()));
  } catch (err) {
    console.error(err);
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/series/:symbol', (c) => {
  const s = seriesFor(c.req.param('symbol').toUpperCase(), Number(c.req.query('n') ?? 250));
  return s ? c.json(s) : c.json({ error: 'unknown symbol' }, 404);
});

app.route('/api/live', liveRoutes);

// 生产模式下顺带托管打包后的前端。
if (process.env.NODE_ENV === 'production' && fs.existsSync(path.join(ROOT, 'dist'))) {
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), path.join(ROOT, 'dist')) }));
}

const port = Number(process.env.API_PORT ?? 8790);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`[ledger] API on http://127.0.0.1:${port}`);
});
