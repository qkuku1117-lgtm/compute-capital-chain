// 第三层：一个主体的完整档案。头部是名字和几个读数；下面分节，只有"走势"默认展开，其余点开才出现。
import type { EntityView, Snapshot } from '../../shared/types.ts';
import { LineChart, type Marker } from '../charts.tsx';
import { Delta, Entry, FlowRow, MetricRow, Section, SourceChip, VerifyItem } from '../components.tsx';
import { hrefFor, intToIso, LAYER_LABEL, PHASE_LABEL, price, shortDate, useSeries, useSeriesMany, type ViewId } from '../lib.ts';
import { IpoSteps, PeriodBars } from '../viz.tsx';

const COLORS = ['var(--c-blue)', 'var(--c-orange)', 'var(--c-aqua)'];

function PriceChart({ e, snap }: { e: EntityView; snap: Snapshot }) {
  const bars = useSeries(e.ticker);
  if (!bars) return <div className="chart-wait">载入中</div>;
  const index = new Map(bars.map(([d], i) => [d, i]));
  // 坐标轴和标注用同一个小数位数
  const top = Math.max(...bars.map(([, c]) => c));
  const digits = top >= 200 ? 0 : top >= 20 ? 1 : 2;
  const markers: Marker[] = snap.changes
    .filter((c) => c.entity === e.id || c.related?.includes(e.id))
    .flatMap((c) => {
      const i = index.get(Number(c.date.replaceAll('-', '')));
      return i === undefined ? [] : [{ index: i, label: c.title }];
    });
  return (
    <LineChart ariaLabel={`${e.zh} 近 ${bars.length} 个交易日收盘价，菱形是涉及它的变动`} format={(v) => v.toFixed(digits)}
      labels={bars.map(([d]) => shortDate(intToIso(d)))} markers={markers}
      lines={[{ key: e.ticker!, name: e.ticker!, color: 'var(--c-blue)', values: bars.map(([, c]) => c) }]} />
  );
}

function ProxyChart({ e, snap }: { e: EntityView; snap: Snapshot }) {
  const data = useSeriesMany(e.proxies ?? []);
  if (!data) return <div className="chart-wait">载入中</div>;
  const tail = Math.min(120, data.dates.length);
  const dates = data.dates.slice(-tail);
  const name = (sym: string) => snap.entities.find((x) => x.ticker === sym)?.zh ?? sym;
  return (
    <LineChart ariaLabel={`${e.zh} 的关联上市公司走势，起点记为 100`} format={(v) => v.toFixed(0)}
      labels={dates.map((d) => shortDate(intToIso(d)))}
      lines={(e.proxies ?? []).slice(0, 3).map((sym, i) => {
        const v = data.series[sym].slice(-tail);
        return { key: sym, name: name(sym), color: COLORS[i], values: v.map((x) => (x / v[0]) * 100) };
      })} />
  );
}

function RatesChart({ snap }: { snap: Snapshot }) {
  const d = snap.rates.daily;
  return (
    <LineChart ariaLabel="5 年、10 年、30 年期美债收益率" format={(v) => `${v.toFixed(2)}%`} labels={d.map((r) => shortDate(intToIso(r.date)))}
      lines={[
        { key: 'y5', name: '5 年', color: COLORS[0], values: d.map((r) => r.y5) },
        { key: 'y10', name: '10 年', color: COLORS[1], values: d.map((r) => r.y10) },
        { key: 'y30', name: '30 年', color: COLORS[2], values: d.map((r) => r.y30) },
      ]} />
  );
}

export function Dossier({ snap, id, view }: { snap: Snapshot; id: string; view: ViewId }) {
  const e = snap.entities.find((x) => x.id === id);
  if (!e) return <p className="empty">没有这个主体</p>;
  const q = e.ticker ? snap.quotes[e.ticker] : undefined;
  // IPO 进行中：代码已定，还没有自己的股价
  const ipo = e.ticker ? undefined : e.ipo;
  const ipoSources = ipo ? [...new Set([ipo.src, ...ipo.steps.flatMap((s) => (s.src ? [s.src] : []))])] : [];
  const metrics = snap.metrics.filter((m) => m.entity === id);
  const out = snap.relations.filter((r) => r.from === id);
  const inn = snap.relations.filter((r) => r.to === id);
  const changes = snap.changes.filter((c) => c.entity === id || c.related?.includes(id));
  const pending = snap.calendar.filter((c) => c.entity === id).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const loops = snap.loops.filter((l) => l.a === id || l.b === id).map((l) => snap.entities.find((x) => x.id === (l.a === id ? l.b : l.a)));
  const unlisted = !e.ticker && Boolean(e.proxies?.length);
  const flowMax = Math.max(0, ...[...out, ...inn].map((r) => r.amountBn ?? 0));

  return (
    <article className="dossier">
      <header className="dossier-head">
        <p className="label">{LAYER_LABEL[e.layer]}{e.ticker ? ` · ${e.ticker}` : ipo ? ` · ${ipo.ticker} · IPO` : unlisted ? ' · 未上市' : ''}</p>
        <h2 id="dossier-title" className="title-xl">{e.zh}{e.zh !== e.name && <span className="dossier-en">{e.name}</span>}</h2>
        <p className="dossier-role">{e.role}</p>
        {loops.length > 0 && (
          <p className="meta">
            <span className="tag tag-solid">回路</span>
            {loops.map((x) => x && <a key={x.id} className="pill" href={hrefFor(view, x.id)}>{x.zh} ›</a>)}
          </p>
        )}
      </header>

      {ipo && (
        <section className="card quote" aria-label="IPO 进度">
          <div className="quote-head">
            <div>
              <p className="label">发行区间</p>
              <p className="title-xl num">{ipo.range}</p>
            </div>
            <p className="label">{ipo.exchange} · {ipo.ticker}</p>
          </div>
          <IpoSteps ipo={ipo} />
          <p className="meta">{ipoSources.map((id) => <SourceChip key={id} source={snap.sources[id]} />)}</p>
        </section>
      )}

      {e.stats && e.ticker && (
        <section className="card quote" aria-label="行情">
          <div className="quote-head">
            <div>
              <p className="label">{q && q.phase !== 'regular' ? PHASE_LABEL[q.phase] : q ? '实时' : '收盘'}</p>
              <p className="quote-price"><span className="title-xl num">{price(q?.price ?? e.stats.last)}</span><Delta value={q?.chg ?? e.stats.d1} /></p>
            </div>
            {e.stats.beta !== null && <p className="label">beta <b className="num">{e.stats.beta.toFixed(2)}</b></p>}
          </div>
          <PeriodBars rows={[
            { label: '当日', value: q?.chg ?? e.stats.d1, digits: 2 },
            { label: '5 日', value: e.stats.d5 },
            { label: '20 日', value: e.stats.d20 },
            { label: e.stats.fromListing ? '上市以来' : '年初至今', value: e.stats.ytd },
            { label: '距高点', value: e.stats.drawdown },
          ]} />
        </section>
      )}

      {(e.ticker || unlisted || e.rates?.length) && (
        <Section title={unlisted ? '关联股票走势' : '走势'} open>
          <div className="pad">
            {e.ticker ? <PriceChart e={e} snap={snap} /> : unlisted ? <ProxyChart e={e} snap={snap} /> : <RatesChart snap={snap} />}
          </div>
        </Section>
      )}

      {changes.length > 0 && (
        <Section title="变动" count={changes.length}>
          <div className="rows">{changes.map((c) => <Entry key={c.id} change={c} snap={snap} view={view} by="date" />)}</div>
        </Section>
      )}

      {metrics.length > 0 && (
        <Section title="数字" count={metrics.length}>
          <div className="rows">{metrics.map((m) => <MetricRow key={m.id} m={m} snap={snap} />)}</div>
        </Section>
      )}

      {(out.length > 0 || inn.length > 0) && (
        <Section title="资金" count={out.length + inn.length}>
          {out.length > 0 && (
            <>
              <p className="sub-label">流出 {out.length}</p>
              <div className="rows">{out.map((r) => <FlowRow key={r.id} r={r} dir="out" snap={snap} view={view} max={flowMax} />)}</div>
            </>
          )}
          {inn.length > 0 && (
            <>
              <p className="sub-label">流入 {inn.length}</p>
              <div className="rows">{inn.map((r) => <FlowRow key={r.id} r={r} dir="in" snap={snap} view={view} max={flowMax} />)}</div>
            </>
          )}
        </Section>
      )}

      {pending.length > 0 && (
        <Section title="待验证" count={pending.length}>
          <div className="rows">{pending.map((c) => <VerifyItem key={c.id} c={c} snap={snap} view={view} />)}</div>
        </Section>
      )}
    </article>
  );
}
