// 利率：六个读数 → 美债曲线 → 联储官员 → 信用端。官员卡折叠时是最新一次怎么说，展开才是"上一次"和原话，不打鹰鸽分。
import { useState } from 'react';
import type { Metric, Official, Snapshot } from '../../shared/types.ts';
import { LineChart, type Marker } from '../charts.tsx';
import { MetricRow, Reactions, SourceChip } from '../components.tsx';
import { intToIso, shortDate, signed } from '../lib.ts';
import { chartable, MiniBars, numericPoints, Spark } from '../viz.tsx';

const SERIES = [
  { key: 'y5', sym: 'US5Y', name: '5 年', color: 'var(--c-blue)' },
  { key: 'y10', sym: 'US10Y', name: '10 年', color: 'var(--c-orange)' },
  { key: 'y30', sym: 'US30Y', name: '30 年', color: 'var(--c-aqua)' },
] as const;
const CREDIT = ['credit.hyper', 'credit.ai', 'credit.concession', 'credit.cover', 'crwv.cds', 'crwv.bond', 'orcl.cds', 'anthropic.rating', 'meta.outlook'];

function Stat({ label, value, sub, viz }: { label: string; value: string; sub?: string; viz?: React.ReactNode }) {
  return (
    <div className="card stat">
      <p className="stat-label" title={label}>{label}</p>
      <p className="stat-row"><span className="stat-value num">{value}</span>{viz}</p>
      {sub && <p className="stat-sub" title={sub}>{sub}</p>}
    </div>
  );
}

function MetricStat({ m, label, bars = false }: { m: Metric | undefined; label: string; bars?: boolean }) {
  if (!m) return null;
  const last = m.history.at(-1)!;
  const prev = m.history.at(-2);
  // 大字只放数值本身；括号里的说明放到小字，没有说明就放上一次的读数
  const main = (t: string) => t.split('（')[0];
  const aside = last.text.includes('（') ? last.text.slice(last.text.indexOf('（') + 1).replace(/）$/, '') : '';
  const before = prev && main(prev.text) !== main(last.text) ? `此前 ${main(prev.text)}` : shortDate(last.asOf);
  return <Stat label={label} value={main(last.text)} sub={aside || before} viz={bars && chartable(m) ? <MiniBars values={numericPoints(m).map((p) => p.value)} /> : undefined} />;
}

function OfficialCard({ o, snap }: { o: Official; snap: Snapshot }) {
  const now = o.statements.at(-1);
  const before = o.statements.at(-2);
  if (!now) return null;
  const surname = o.name.split(' ').at(-1)!;
  const change = snap.changes.find((c) => c.entity === 'fed' && c.date === now.date && (c.title.includes(surname) || c.title.includes(o.zh)));
  return (
    <details className="card official">
      <summary>
        <span className="official-sum">
          <span className="official-head">
            <b>{o.zh}</b>
            {o.voter2026 && <span className="tag">票委</span>}
            <span className="num muted">{shortDate(now.date)}</span>
          </span>
          <span className="official-text">{now.text}</span>
        </span>
      </summary>
      <div className="official-body">
        {now.quote && <blockquote lang="en">“{now.quote}”</blockquote>}
        <p className="meta"><span className="muted">{now.venue}</span><SourceChip source={snap.sources[now.src]} /></p>
        {before && (
          <div className="official-then">
            <p className="label">上一次 · <span className="num">{shortDate(before.date)}</span> · {before.venue}</p>
            <p>{before.text}</p>
            {before.quote && <blockquote lang="en">“{before.quote}”</blockquote>}
          </div>
        )}
        {change && (
          <div>
            <p className="label">当日收益率</p>
            <Reactions change={change} />
          </div>
        )}
        <p className="label">{o.name} · {o.role}</p>
      </div>
    </details>
  );
}

export function RatesView({ snap }: { snap: Snapshot }) {
  const [range, setRange] = useState<'daily' | 'intraday'>('daily');
  const metric = (id: string) => snap.metrics.find((m) => m.id === id);
  const daily = snap.rates.daily;
  const last = daily.at(-1);
  const prev = daily.at(-2);

  // 报价是 20 分钟内的才叫"实时"；债市休市时拿到的是上一个交易日的读数，就写那一天
  const when = (at: number | undefined) => {
    if (at === undefined) return last ? shortDate(intToIso(last.date)) : '';
    if (Date.now() - at < 20 * 60_000) return '实时';
    return shortDate(new Date(at).toLocaleDateString('sv', { timeZone: 'America/New_York' }));
  };

  const fedDates = new Map<number, string>();
  for (const c of snap.changes) if (c.entity === 'fed') { const d = Number(c.date.replaceAll('-', '')); if (!fedDates.has(d)) fedDates.set(d, c.title); }
  const markers: Marker[] = daily.flatMap((r, i) => (fedDates.has(r.date) ? [{ index: i, label: fedDates.get(r.date)! }] : []));

  const intraday = snap.rates.intraday;
  const fmtTime = (t: number) => new Date(t).toLocaleString('zh-CN', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const dayOf = (t: number) => new Date(t).toLocaleDateString('sv', { timeZone: 'America/New_York' });
  const breaks = intraday.flatMap((p, i) => (i > 0 && dayOf(p.t) !== dayOf(intraday[i - 1].t) ? [i] : []));

  return (
    <>
      <div className="stats">
        <MetricStat m={metric('fed.range')} label="政策利率" />
        {SERIES.map((s) => {
          const q = snap.quotes[s.sym];
          const v = q?.price ?? last?.[s.key];
          const chg = q?.chg ?? (last && prev ? (last[s.key] - prev[s.key]) * 100 : 0);
          const line = daily.slice(-60).map((r) => r[s.key]);
          return v === undefined ? null : (
            <Stat key={s.key} label={`${s.name}美债`} value={`${v.toFixed(3)}%`} sub={`${signed(chg, 1)}bp · ${when(q?.at)}`}
              viz={<Spark values={q ? [...line, q.price] : line} width={56} height={28} label={`${s.name}期美债收益率，近 60 个交易日`} />} />
          );
        })}
        <MetricStat m={metric('fed.dec25')} label="12 月加息概率" bars />
        <MetricStat m={metric('fed.corecpi')} label="核心 CPI 环比" bars />
      </div>

      <section className="group" aria-labelledby="yields-title">
        <div className="card chart-card">
          <div className="chart-head">
            <h2 id="yields-title" className="title">美债收益率</h2>
            <div className="seg seg-small" role="group" aria-label="时间范围">
              <button type="button" aria-pressed={range === 'daily'} onClick={() => setRange('daily')}>日线</button>
              <button type="button" aria-pressed={range === 'intraday'} onClick={() => setRange('intraday')}>5 分钟</button>
            </div>
          </div>
          {range === 'daily' ? (
            <LineChart ariaLabel="5 年、10 年、30 年期美债收益率日线，菱形是记了联储变动的日子" height={280} format={(v) => `${v.toFixed(2)}%`}
              labels={daily.map((r) => shortDate(intToIso(r.date)))} markers={markers}
              lines={SERIES.map((s) => ({ key: s.key, name: s.name, color: s.color, values: daily.map((r) => r[s.key]) }))} />
          ) : (
            <LineChart ariaLabel="5 年、10 年、30 年期美债收益率 5 分钟线，只含常规交易时段，竖线是换日" height={280} format={(v) => `${v.toFixed(2)}%`}
              labels={intraday.map((p) => fmtTime(p.t))} breaks={breaks}
              lines={SERIES.map((s) => ({ key: s.key, name: s.name, color: s.color, values: intraday.map((p) => p[s.key]) }))} />
          )}
        </div>
      </section>

      <section className="group" aria-labelledby="officials-title">
        <div className="group-head">
          <h2 id="officials-title" className="title">联储官员</h2>
          <span className="count">{snap.officials.length}</span>
        </div>
        <div className="officials">
          {snap.officials.map((o) => <OfficialCard key={o.id} o={o} snap={snap} />)}
        </div>
      </section>

      <section className="group" aria-labelledby="credit-title">
        <div className="group-head">
          <h2 id="credit-title" className="title">信用端</h2>
        </div>
        <div className="card list rows">
          {CREDIT.map((id) => {
            const m = metric(id);
            return m ? <MetricRow key={id} m={m} snap={snap} owner={snap.entities.find((e) => e.id === m.entity)?.zh} /> : null;
          })}
        </div>
      </section>
    </>
  );
}
