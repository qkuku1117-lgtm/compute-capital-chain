// 账本的数据结构。data/ledger/*.json 按这里的形状写，服务端和前端共用。

export type Layer = 'capital' | 'model' | 'cloud' | 'neocloud' | 'hardware' | 'chain';

/** 信源类型：只说明"谁发的、是哪一类"，不评价真假。 */
export type SourceType = 'filing' | 'media' | 'anon' | 'research' | 'data' | 'aggregate' | 'personal';

export interface Source {
  /** 原始发布方（不是转载方） */
  pub: string;
  type: SourceType;
  url?: string;
  /** 经由谁转述 / 转载 */
  via?: string;
  date?: string;
}

/** IPO 进度上的一步。expected 表示日期是预计的。 */
export interface IpoStep { label: string; date: string; expected?: boolean; src?: string }

/** 已经递交上市申请、代码已定、还没开始交易。 */
export interface Ipo {
  ticker: string;
  exchange: string;
  /** 发行价区间，展示用原文 */
  range: string;
  src: string;
  steps: IpoStep[];
}

export interface Entity {
  id: string;
  name: string;
  zh: string;
  layer: Layer;
  order: number;
  /** data/series 下的代码，未上市则没有 */
  ticker?: string;
  /** 上市日（近一年内上市的才写），用来把"年初至今"换成"上市以来" */
  listed?: string;
  /** IPO 进行中。它的代码一有日线，服务端就自动按已上市处理 */
  ipo?: Ipo;
  /** 还没有自己的股价时：提到它就关联哪些上市公司的股票 */
  proxies?: string[];
  /** 资金成本层：关联的利率序列 */
  rates?: string[];
  mcapBn?: number;
  role: string;
}

/** 钱的流向：from 付钱 / 出资 / 担保，to 收钱 / 被投 / 被担保。 */
export type RelationKind = 'order' | 'equity' | 'credit' | 'rate';

export interface Relation {
  id: string;
  from: string;
  to: string;
  kind: RelationKind;
  label: string;
  /** 十亿美元；没有披露金额就不填 */
  amountBn?: number;
  asOf: string;
  src: string;
  note?: string;
}

export interface MetricPoint {
  asOf: string;
  /** 用于画图的数值，可缺省 */
  value?: number;
  /** 展示用原文，如 "$70–78" */
  text: string;
  src: string;
  note?: string;
}

export interface Metric {
  id: string;
  entity: string;
  name: string;
  unit?: string;
  /** estimates：几条记录是同一件事的不同口径，不是先后变化，不能算涨跌幅 */
  kind?: 'estimates';
  history: MetricPoint[];
}

/** 新增量：new 首次出现；expected 与此前指引 / 共识一致；repeat 已披露信息的重复。 */
export type Novelty = 'new' | 'expected' | 'repeat';

/** 事件相对美股常规时段的位置，决定市场反应从哪根 K 线算起。 */
export type Session = 'pre' | 'intra' | 'post';

export interface Change {
  id: string;
  date: string;
  session: Session;
  entity: string;
  /** 直接受影响的其他主体，最多 2 个 */
  related?: string[];
  metric?: string;
  title: string;
  from?: string;
  to?: string;
  detail: string;
  src: string;
  novelty: Novelty;
  noveltyNote?: string;
  /** 指向 calendar.json 的验证点 */
  verify?: string;
  caveat?: string;
  /** 不计算市场反应的原因（如日期未核实） */
  noReaction?: string;
}

export interface Statement {
  date: string;
  venue: string;
  /** 转述 */
  text: string;
  /** 原话（短引），可缺省 */
  quote?: string;
  src: string;
}

export interface Official {
  id: string;
  name: string;
  zh: string;
  role: string;
  voter2026: boolean;
  statements: Statement[];
}

export interface CalendarItem {
  id: string;
  date: string;
  dateNote?: string;
  entity: string;
  kind: 'data' | 'earnings' | 'fed' | 'deal' | 'other';
  title: string;
  detail?: string;
  src?: string;
}

// ---- 服务端算出来的部分 ----

export interface Stats {
  last: number;
  lastDate: number;
  d1: number;
  d5: number;
  d20: number;
  ytd: number;
  /** 今年才上市：ytd 是从第一个交易日收盘算起的 */
  fromListing: boolean;
  /** 距 250 日最高收盘的回撤 */
  drawdown: number;
  /** 对 QQQ 的 250 日 beta */
  beta: number | null;
  spark: number[];
}

export type ReactionLevel = 'strong' | 'mild' | 'none' | 'pending';

export interface Reaction {
  asset: string;
  assetName: string;
  kind: 'equity' | 'rate';
  day: number | null;
  /** 股票：当日涨跌 %；利率：当日变动 bp */
  move: number | null;
  /** 股票：扣除 beta×QQQ 后的超额 % */
  excess: number | null;
  /** 超额（或 bp 变动）除以此前 60 日的日波动 */
  z: number | null;
  level: ReactionLevel;
  /** 用盘中实时价暂计，收盘后会被正式收盘价替换 */
  provisional?: boolean;
}

export interface ChangeView extends Change {
  reactions: Reaction[];
  /** 归因提示：同日同标的有其他事件，或全市场异常波动 */
  attribution: string[];
}

export interface EntityView extends Entity {
  stats?: Stats;
  changeCount7d: number;
}

export interface RatePoint { date: number; y5: number; y10: number; y30: number }

export type MarketPhase = 'pre' | 'regular' | 'post' | 'overnight' | 'closed';

/** 实时报价。股票的 chg 是相对上一收盘的 %，收益率的 chg 是 bp。 */
export interface LiveQuote { price: number; chg: number; unit: '%' | 'bp'; phase: MarketPhase; at: number }

/** 实时抓到、还没整理进账本的标题。只带信源，不带任何判断。 */
export interface InboxItem { id: string; title: string; pub: string; time: number; url?: string; entity: string }

export interface Snapshot {
  meta: { asOf: string; asOfDate: number; generatedAt: string; live: boolean; liveAt: number | null; phase: MarketPhase; provisional: boolean };
  quotes: Record<string, LiveQuote>;
  inbox: InboxItem[];
  entities: EntityView[];
  relations: Relation[];
  loops: { a: string; b: string; relations: string[] }[];
  metrics: Metric[];
  changes: ChangeView[];
  officials: Official[];
  calendar: CalendarItem[];
  sources: Record<string, Source>;
  rates: { daily: RatePoint[]; intraday: { t: number; y5: number; y10: number; y30: number }[] };
}
