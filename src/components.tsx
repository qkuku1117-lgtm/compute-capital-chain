// 反复出现的小部件。原则：折叠时只给名字、数字和一个强弱标记；说明性的东西都在点开之后。
import type { CalendarItem, ChangeView, EntityView, Metric, Reaction, ReactionLevel, Relation, Snapshot, Source } from '../shared/types.ts';
import { bn, countdown, hrefFor, KIND_CAL_LABEL, KIND_LABEL, LEVEL_LABEL, longDate, mainText, NOVELTY_LABEL, SESSION_LABEL, shortDate, signed, SOURCE_LABEL, withUnit, type ViewId } from './lib.ts';
import { chartable, HistoryBars, MiniBars, numericPoints, SigmaTrack, StepChip } from './viz.tsx';

export { Delta } from './viz.tsx';

/** 信源：哪一类 + 谁发的。只标注，不评价。 */
export function SourceChip({ source }: { source: Source | undefined }) {
  if (!source) return null;
  return (
    <span className="src">
      <span className={`tag${source.type === 'filing' ? ' tag-solid' : ''}`}>{SOURCE_LABEL[source.type]}</span>
      {source.url
        ? <a href={source.url} target="_blank" rel="noreferrer noopener">{source.pub}</a>
        : <span>{source.pub}</span>}
      {source.via && <span className="muted">经 {source.via}</span>}
    </span>
  );
}

/** 反应强弱：三格信号条。0 格待收盘，1 格不到日常波动的 1 倍，2 格 1–2 倍，3 格 2 倍以上。 */
export function Meter({ level }: { level: ReactionLevel }) {
  return <span className={`meter meter-${level}`} role="img" aria-label={LEVEL_LABEL[level]}><i /><i /><i /></span>;
}

/** 前 → 后 */
export function Diff({ from, to }: { from?: string; to?: string }) {
  if (!from && !to) return null;
  return (
    <span className="diff">
      {from && <span className="diff-from">{from}</span>}
      {from && to && <span className="diff-arrow" aria-label="变为">→</span>}
      {to && <span className="diff-to">{to}</span>}
    </span>
  );
}

const moveText = (r: Reaction) => `${signed(r.move ?? 0, r.kind === 'rate' ? 1 : 2)}${r.kind === 'rate' ? 'bp' : '%'}`;

function ReactionRow({ r }: { r: Reaction }) {
  const name = r.kind === 'rate' ? r.assetName : r.asset;
  if (r.level === 'pending' || r.move === null) {
    return <div className="rx"><span className="rx-asset">{name}</span><SigmaTrack r={r} /><span className="muted">{LEVEL_LABEL.pending}</span></div>;
  }
  return (
    <div className="rx">
      <span className="rx-asset">{name}</span>
      <SigmaTrack r={r} />
      <span className="num rx-move">{moveText(r)}</span>
      <span className="num muted rx-z" title={r.kind === 'rate' ? '当日变动 ÷ 此前 60 日的日波动' : `扣除 beta×纳指 100 后的超额 ${signed(r.excess ?? 0)}%，再除以此前 60 日的残差波动`}>
        {Math.abs(r.z ?? 0).toFixed(1)}σ
      </span>
      {r.provisional && <span className="tag">暂计</span>}
    </div>
  );
}

export function Reactions({ change }: { change: ChangeView }) {
  if (change.noReaction) return <p className="muted">不计算 · {change.noReaction}</p>;
  if (!change.reactions.length) return <p className="muted">无关联标的</p>;
  return (
    <div className="rx-list">
      {change.reactions.map((r) => <ReactionRow key={r.asset} r={r} />)}
      {change.attribution.map((a) => <p key={a} className="rx-note">† {a}</p>)}
    </div>
  );
}

/** 折叠行上的那一个反应：取波动倍数最大的标的。 */
export function RxBadge({ change }: { change: ChangeView }) {
  const done = change.reactions.filter((r) => r.level !== 'pending' && r.z !== null);
  if (!done.length) return change.reactions.length && !change.noReaction ? <span className="rxb"><Meter level="pending" /><span className="rxb-asset">待收盘</span></span> : null;
  const r = done.reduce((a, b) => (Math.abs(b.z ?? 0) > Math.abs(a.z ?? 0) ? b : a));
  return (
    <span className={`rxb rxb-${r.level}`}>
      <Meter level={r.level} />
      <span className="rxb-asset">{r.kind === 'rate' ? r.assetName : r.asset}</span>
      <span className="num">{moveText(r)}</span>
      {r.provisional && <span className="rxb-asset">暂计</span>}
      {change.attribution.length > 0 && <span className="dagger" title={change.attribution.join(' ')}>†</span>}
    </span>
  );
}

/** 这条变动对应指标历史里的哪一根柱子：日期对得上的那一条；对不上时，只有它是这个指标最近的一条变动才算最后一根。 */
function markOf(change: ChangeView, m: Metric | undefined, snap: Snapshot) {
  if (!m || !chartable(m)) return -1;
  const i = m.history.findIndex((p) => p.asOf === change.date);
  if (i >= 0) return i;
  return snap.changes.find((c) => c.metric === m.id)?.id === change.id ? m.history.length - 1 : -1;
}

/** 一条变动。折叠时一行；展开后是这个数字的历次读数、前后对照、一句说明和四个字段。 */
export function Entry({ change, snap, view, open = false, by = 'entity' }: { change: ChangeView; snap: Snapshot; view: ViewId; open?: boolean; by?: 'entity' | 'date' }) {
  const ent = snap.entities.find((e) => e.id === change.entity);
  const verify = snap.calendar.find((c) => c.id === change.verify);
  const metric = change.metric ? snap.metrics.find((m) => m.id === change.metric) : undefined;
  const mark = markOf(change, metric, snap);
  return (
    <details className={`entry entry-by-${by}`} open={open}>
      <summary>
        <span className="entry-who">{by === 'date' ? shortDate(change.date) : ent?.zh}</span>
        <span className="entry-title">{change.title}</span>
        <RxBadge change={change} />
        {change.novelty !== 'new' && <span className="tag">{NOVELTY_LABEL[change.novelty]}</span>}
      </summary>
      <div className="entry-body">
        {metric && mark >= 0 && (
          <div className="entry-chart">
            <p className="label">{metric.name}</p>
            <HistoryBars m={metric} mark={mark} />
          </div>
        )}
        {(change.from || change.to) && <p><Diff from={change.from} to={change.to} /></p>}
        <p className="entry-detail">{change.detail}</p>
        {change.caveat && <p className="callout">{change.caveat}</p>}
        <dl className="facts">
          <div><dt>信源</dt><dd><SourceChip source={snap.sources[change.src]} /></dd></div>
          <div>
            <dt>新增量</dt>
            <dd><span className={`tag${change.novelty === 'new' ? ' tag-solid' : ''}`}>{NOVELTY_LABEL[change.novelty]}</span>{change.noveltyNote && <p className="fact-note">{change.noveltyNote}</p>}</dd>
          </div>
          <div><dt>反应</dt><dd><Reactions change={change} /></dd></div>
          <div>
            <dt>验证</dt>
            <dd>{verify
              ? <a href={hrefFor('verify')}><span className="num">{verify.date ? shortDate(verify.date) : verify.dateNote ?? '未定'}</span> {verify.title}</a>
              : <span className="muted">—</span>}</dd>
          </div>
        </dl>
        <p className="meta">
          <span className="muted">{longDate(change.date)} · {SESSION_LABEL[change.session]}</span>
          <EntityLink entity={ent} view={view} />
          {change.related?.map((id) => <EntityLink key={id} entity={snap.entities.find((e) => e.id === id)} view={view} />)}
        </p>
      </div>
    </details>
  );
}

/** 主体名字：点了打开它的档案。 */
export function EntityLink({ entity, view }: { entity: EntityView | undefined; view: ViewId }) {
  if (!entity) return null;
  return <a className="pill" href={hrefFor(view, entity.id)}>{entity.zh} ›</a>;
}

/** 一个数字。有数值的：折叠时是历次读数的小柱子、最新值和这一次的变化，展开是放大的柱子，逐根可看原文和信源。
    只有文字的：折叠时是"上一次 → 最新"，展开是日期、信源和更早的记录。 */
export function MetricRow({ m, snap, owner }: { m: Metric; snap: Snapshot; owner?: string }) {
  const now = m.history.at(-1)!;
  const before = m.history.at(-2);
  const older = m.history.slice(0, -2).reverse();
  const nums = numericPoints(m).map((p) => p.value);
  const bars = chartable(m);
  const estimates = m.kind === 'estimates';
  return (
    <details className="row row-metric">
      <summary>
        <span className="row-name">{owner && <b>{owner} </b>}{m.name}</span>
        {bars && <span className="row-viz"><MiniBars values={nums} flat={estimates} /></span>}
        {bars && estimates && (
          <span className="row-now"><b className="num">{withUnit(Math.min(...nums), m.unit)} – {withUnit(Math.max(...nums), m.unit)}</b><span className="chg">{nums.length} 个口径</span></span>
        )}
        {bars && !estimates && (
          <span className="row-now"><b className="num">{mainText(now.text)}</b><StepChip prev={nums.at(-2)!} cur={nums.at(-1)!} unit={m.unit} /></span>
        )}
        {!bars && <Diff from={before?.text} to={now.text} />}
      </summary>
      <div className="row-body">
        {bars ? <HistoryBars m={m} foot={(p) => <SourceChip source={snap.sources[p.src]} />} /> : (
          <>
            <p className="meta"><span className="num muted">{shortDate(now.asOf)}</span><SourceChip source={snap.sources[now.src]} /></p>
            {now.note && <p>{now.note}</p>}
            {older.length > 0 && (
              <ul className="older">
                {older.map((p) => <li key={p.asOf + p.text}><span className="num muted">{shortDate(p.asOf)}</span>{p.text}</li>)}
              </ul>
            )}
          </>
        )}
      </div>
    </details>
  );
}

/** 一笔钱：折叠时是方向、对方和金额，金额前面的短条是它在这一组里的相对大小；展开是这笔钱的说明和信源。 */
export function FlowRow({ r, dir, snap, view, max }: { r: Relation; dir: 'out' | 'in'; snap: Snapshot; view: ViewId; max?: number }) {
  const other = snap.entities.find((e) => e.id === (dir === 'out' ? r.to : r.from));
  return (
    <details className="row">
      <summary>
        <span className="kind"><i className={`sw sw-${r.kind}`} />{KIND_LABEL[r.kind]}</span>
        <span className="row-name"><span aria-hidden="true">{dir === 'out' ? '→' : '←'}</span><span className="sr-only">{dir === 'out' ? '流向' : '来自'}</span> {other?.zh}</span>
        {r.amountBn !== undefined && max ? <span className="row-bar" aria-hidden="true"><i className={`bar-${r.kind}`} style={{ width: `${(r.amountBn / max) * 100}%` }} /></span> : null}
        {r.amountBn !== undefined && <span className="row-end num">{bn(r.amountBn)}</span>}
      </summary>
      <div className="row-body">
        <p>{r.label}</p>
        {r.note && <p>{r.note}</p>}
        <p className="meta"><span className="num muted">{r.asOf}</span><SourceChip source={snap.sources[r.src]} /><EntityLink entity={other} view={view} /></p>
      </div>
    </details>
  );
}

/** 一个验证点：折叠时是日子和要看什么，展开是细节和它要验证的那几条变动。 */
export function VerifyItem({ c, snap, view }: { c: CalendarItem; snap: Snapshot; view: ViewId }) {
  const linked = snap.changes.filter((x) => x.verify === c.id);
  return (
    <details className="row">
      <summary>
        <span className="row-date num">{c.date ? shortDate(c.date) : '未定'}</span>
        <span className="row-name">{c.title}</span>
        <span className="row-end">{c.date ? countdown(c.date) : c.dateNote}</span>
      </summary>
      <div className="row-body">
        {c.detail && <p>{c.detail}</p>}
        {linked.length > 0 && (
          <ul className="older">
            {linked.map((x) => <li key={x.id}><span className="num muted">{shortDate(x.date)}</span>{x.title}</li>)}
          </ul>
        )}
        <p className="meta">
          <span className="tag">{KIND_CAL_LABEL[c.kind]}</span>
          <EntityLink entity={snap.entities.find((e) => e.id === c.entity)} view={view} />
          {c.src && <SourceChip source={snap.sources[c.src]} />}
        </p>
      </div>
    </details>
  );
}

/** 档案里的一节：标题一行，内容点开才出现。 */
export function Section({ title, count, open = false, children }: { title: string; count?: number; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="card section" open={open}>
      <summary><span className="title">{title}</span>{count !== undefined && <span className="count">{count}</span>}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
