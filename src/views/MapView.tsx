// 第一层：资金链地图 + 两个关键数字 + 最新几条变动。点一个主体，右栏换成它的摘要卡（第二层）；再点"档案"才是第三层。
import { useEffect, useRef, useState } from 'react';
import type { ChangeView, Snapshot } from '../../shared/types.ts';
import { Delta, Entry, FlowRow, VerifyItem } from '../components.tsx';
import { hrefFor, LAYER_LABEL, longDate, price, signed, todayIso } from '../lib.ts';
import { IpoSteps, Spark, SplitBar } from '../viz.tsx';
import { ChainMap } from './ChainMap.tsx';

const weight = (c: ChangeView) => Math.max(0, ...c.reactions.map((r) => Math.abs(r.z ?? 0)));
const CAPEX = ['msft', 'googl', 'amzn', 'meta'];

function Overview({ snap }: { snap: Snapshot }) {
  const latest = snap.changes.reduce((a, c) => (c.date > a ? c.date : a), '');
  const all = snap.changes.filter((c) => c.date === latest).sort((a, b) => weight(b) - weight(a));
  // 每个主体先各出一条，再按反应大小补齐，免得一家公司占满整栏
  const seen = new Set<string>();
  const firsts = all.filter((c) => (seen.has(c.entity) ? false : (seen.add(c.entity), true)));
  const list = [...firsts, ...all.filter((c) => !firsts.includes(c))].slice(0, 6);
  const upcoming = snap.calendar.filter((c) => c.date && c.date >= todayIso()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);

  const capex = CAPEX.map((id) => ({
    key: id,
    name: snap.entities.find((e) => e.id === id)?.zh ?? id,
    value: snap.metrics.find((m) => m.id === `${id}.capex26`)?.history.at(-1)?.value ?? 0,
  }));
  const capexSum = capex.reduce((a, p) => a + p.value, 0);
  const live = snap.quotes.US10Y;
  const last = snap.rates.daily.at(-1);
  const prev = snap.rates.daily.at(-2);
  const y10 = live?.price ?? last?.y10;
  const y10chg = live?.chg ?? (last && prev ? (last.y10 - prev.y10) * 100 : 0);
  const y10line = snap.rates.daily.slice(-60).map((r) => r.y10);

  return (
    <>
      <div className="tiles swap">
        <a className="card tile" href={hrefFor('map', 'ust')}>
          <span className="tile-top">
            <span className="tile-main">
              <span className="stat-label">10 年美债</span>
              <span className="stat-value num">{y10 === undefined ? '—' : `${y10.toFixed(2)}%`}</span>
              <span className="stat-sub num">{signed(y10chg, 1)}bp</span>
            </span>
            <Spark values={live ? [...y10line, live.price] : y10line} width={128} height={44} label="10 年期美债收益率，近 60 个交易日" />
          </span>
        </a>
        <div className="card tile">
          <span className="tile-main">
            <span className="stat-label">四大厂 2026 capex 指引</span>
            <span className="stat-value num">${capexSum.toFixed(0)}B</span>
          </span>
          <SplitBar parts={capex} format={(v) => `$${v.toFixed(0)}B`} />
        </div>
      </div>
      <section className="card list swap" aria-labelledby="latest-title">
        <div className="card-head">
          <h2 id="latest-title" className="title">最新</h2>
          <span className="count">{longDate(latest)}</span>
          <a className="more" href={hrefFor('ledger')}>全部 {snap.changes.length} ›</a>
        </div>
        <div className="rows">
          {list.map((c) => <Entry key={c.id} change={c} snap={snap} view="map" />)}
        </div>
      </section>
      <section className="card list swap" aria-labelledby="next-title">
        <div className="card-head">
          <h2 id="next-title" className="title">待验证</h2>
          <a className="more" href={hrefFor('verify')}>全部 {snap.calendar.length} ›</a>
        </div>
        <div className="rows">
          {upcoming.map((c) => <VerifyItem key={c.id} c={c} snap={snap} view="map" />)}
        </div>
      </section>
    </>
  );
}

function Focus({ snap, id, onClear }: { snap: Snapshot; id: string; onClear: () => void }) {
  const e = snap.entities.find((x) => x.id === id);
  if (!e) return null;
  const out = snap.relations.filter((r) => r.from === id && r.kind !== 'rate');
  const inn = snap.relations.filter((r) => r.to === id && r.kind !== 'rate');
  const recent = snap.changes.filter((c) => c.entity === id || c.related?.includes(id)).slice(0, 3);
  const q = e.ticker ? snap.quotes[e.ticker] : undefined;
  const ipo = e.ticker ? undefined : e.ipo;
  const flowMax = Math.max(0, ...[...out, ...inn].map((r) => r.amountBn ?? 0));
  return (
    <section className="card list swap" aria-labelledby="focus-title">
      <div className="focus-head">
        <div className="focus-top">
          <span className="label">{LAYER_LABEL[e.layer]}{e.ticker ? ` · ${e.ticker}` : ipo ? ` · ${ipo.ticker} · IPO` : e.proxies?.length ? ' · 未上市' : ''}</span>
          <button type="button" className="icon-btn" aria-label="取消选中" onClick={onClear}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
        <h2 id="focus-title" className="title">{e.zh}</h2>
        {e.stats && e.ticker && (
          <div className="focus-quote">
            <div>
              <p className="quote-price"><span className="title-xl num">{price(q?.price ?? e.stats.last)}</span><Delta value={q?.chg ?? e.stats.d1} /></p>
              <p className="label">20 日 <Delta value={e.stats.d20} digits={1} /></p>
            </div>
            <Spark values={e.stats.spark} width={104} height={40} label={`${e.zh} 近 ${e.stats.spark.length} 个交易日收盘价`} />
          </div>
        )}
        {ipo && (
          <>
            <p className="quote-price"><span className="title-xl num">{ipo.range}</span><span className="label">发行区间</span></p>
            <IpoSteps ipo={ipo} />
          </>
        )}
        <p className="focus-role">{e.role}</p>
      </div>
      {out.length > 0 && (
        <div>
          <p className="sub-label">流出 {out.length}</p>
          <div className="rows">{out.map((r) => <FlowRow key={r.id} r={r} dir="out" snap={snap} view="map" max={flowMax} />)}</div>
        </div>
      )}
      {inn.length > 0 && (
        <div>
          <p className="sub-label">流入 {inn.length}</p>
          <div className="rows">{inn.map((r) => <FlowRow key={r.id} r={r} dir="in" snap={snap} view="map" max={flowMax} />)}</div>
        </div>
      )}
      {recent.length > 0 && (
        <div>
          <p className="sub-label">变动</p>
          <div className="rows">{recent.map((c) => <Entry key={c.id} change={c} snap={snap} view="map" by="date" />)}</div>
        </div>
      )}
      <p className="focus-actions"><a className="btn" href={hrefFor('map', id)}>档案 ›</a></p>
    </section>
  );
}

export function MapView({ snap }: { snap: Snapshot }) {
  const [selected, setSelected] = useState<string | null>(null);
  const rail = useRef<HTMLElement>(null);
  // 窄屏时右栏排在地图下面：选中主体后把摘要卡带进视野
  useEffect(() => {
    const el = rail.current;
    if (!selected || !el || el.getBoundingClientRect().top < innerHeight * 0.7) return;
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  }, [selected]);
  return (
    <div className="home">
      <section aria-label="资金链地图">
        <ChainMap snap={snap} selected={selected} onSelect={setSelected} />
      </section>
      <aside className="rail" ref={rail}>
        {selected ? <Focus key={selected} snap={snap} id={selected} onClear={() => setSelected(null)} /> : <Overview snap={snap} />}
      </aside>
    </div>
  );
}
