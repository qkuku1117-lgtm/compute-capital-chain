import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../shared/types.ts';
import { Meter } from './components.tsx';
import { clock, closeTopLayer, hrefFor, intToIso, parseHash, PHASE_LABEL, shortDate, STATIC, toggleScheme, useLive, useRoute, useSchemeSync, useSnapshot, type LiveState, type ViewId } from './lib.ts';
import { SigmaTrack } from './viz.tsx';
import { Dossier } from './views/Dossier.tsx';
import { LedgerView } from './views/LedgerView.tsx';
import { MapView } from './views/MapView.tsx';
import { RatesView } from './views/RatesView.tsx';
import { VerifyView } from './views/VerifyView.tsx';

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'map', label: '全景' },
  { id: 'ledger', label: '变动' },
  { id: 'rates', label: '利率' },
  { id: 'verify', label: '验证' },
];

function LiveBadge({ snap, live }: { snap: Snapshot; live: LiveState }) {
  if (live.connected && snap.meta.live) {
    return (
      <span className="live">
        <span className="live-dot" aria-hidden="true" />
        <span><span className="sr-only">实时，</span>{PHASE_LABEL[snap.meta.phase]}</span>
        {snap.meta.liveAt && <span className="num live-time">{clock(snap.meta.liveAt)}</span>}
      </span>
    );
  }
  return (
    <span className="live">
      <span className="num live-time">{shortDate(intToIso(snap.meta.asOfDate))} 收盘</span>
      {!STATIC && (
        <button type="button" className="btn btn-small" onClick={live.connect} disabled={live.busy}>
          {live.busy ? '连接中' : <><span className="wide-only">接通</span>实时</>}
        </button>
      )}
    </span>
  );
}

/** 第三层：主体档案，从右边滑进来。Esc、点外面、关闭按钮、浏览器后退都走同一条带动画的关闭路径。 */
function DossierSheet({ snap, id, view }: { snap: Snapshot; id: string | null; view: ViewId }) {
  const ref = useRef<HTMLDialogElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  // 关闭之后内容先留着，等抽屉滑出去，不然会滑走一块空白
  const [shown, setShown] = useState(id);
  if (id && id !== shown) setShown(id);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!id) { void closeTopLayer(d); return; }
    d.removeAttribute('data-closing');
    if (!d.open) d.showModal();
    d.scrollTop = 0;
  }, [id]);

  // 关掉之后，把地址里的主体也去掉。不只靠 close 事件：它要等下一帧才派发，页面在后台时会迟到。
  const clearEntity = () => { if (parseHash(location.hash).entity) location.hash = hrefFor(viewRef.current); };
  const dismiss = async () => {
    const d = ref.current;
    if (!d) return;
    await closeTopLayer(d);
    if (!d.open) clearEntity();
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // 迟到的 close 事件到达时档案可能已经重新打开了，那就不要动地址
    const onClose = () => { if (!d.open) clearEntity(); };
    // Esc 和点外面：拦下来，改走带动画的关闭
    const onCancel = (e: Event) => { e.preventDefault(); void dismissRef.current(); };
    d.addEventListener('close', onClose);
    d.addEventListener('cancel', onCancel);
    const off = () => { d.removeEventListener('close', onClose); d.removeEventListener('cancel', onCancel); };
    if ('closedBy' in HTMLDialogElement.prototype) return off;
    // 不支持 closedby 的浏览器：按下和松开都在档案外面才关，避免拖选文字时误关
    const outside = (e: PointerEvent) => {
      const r = d.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    const down = (e: PointerEvent) => { pressedOutside = outside(e); };
    const up = (e: PointerEvent) => { if (pressedOutside && outside(e)) void dismissRef.current(); };
    d.addEventListener('pointerdown', down);
    d.addEventListener('pointerup', up);
    return () => { off(); d.removeEventListener('pointerdown', down); d.removeEventListener('pointerup', up); };
  }, []);

  return (
    <dialog ref={ref} className="sheet" aria-labelledby="dossier-title" {...({ closedby: 'any' } as object)}>
      <div className="sheet-close">
        <button type="button" className="icon-btn" aria-label="关闭档案" onClick={() => void dismiss()}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </div>
      {shown && <Dossier key={shown} snap={snap} id={shown} view={view} />}
    </dialog>
  );
}

export function App() {
  const route = useRoute();
  const { data: snap, error, reload } = useSnapshot();
  const live = useLive(reload);
  useSchemeSync();
  const current = VIEWS.find((v) => v.id === route.view)!;

  // 顶栏往下滚时收起、往上滚时回来。支持 scroll-state 查询的浏览器由 CSS 完成，这里只给其他浏览器补上。
  useEffect(() => {
    if (CSS.supports('container-type', 'scroll-state')) return;
    const bar = document.querySelector('.bar');
    let lastY = scrollY;
    const onScroll = () => {
      const y = Math.max(0, Math.min(scrollY, document.documentElement.scrollHeight - innerHeight));
      if (y === lastY) return;
      bar?.classList.toggle('is-hidden', y > lastY && y > (bar as HTMLElement).offsetHeight);
      lastY = y;
    };
    addEventListener('scroll', onScroll, { passive: true });
    return () => removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <header className="bar">
        <div className="bar-in">
          <a className="brand" href={hrefFor('map')} aria-label="算力资金链">
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <rect width="22" height="22" rx="6" fill="currentColor" />
              <g style={{ stroke: 'var(--bg)', fill: 'var(--bg)' }}>
                <path d="M6 14.5L11 7.5L16 14.5" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="6" cy="14.5" r="2" stroke="none" />
                <circle cx="11" cy="7.5" r="2" stroke="none" />
                <circle cx="16" cy="14.5" r="2" stroke="none" />
              </g>
            </svg>
            <span className="brand-name">算力资金链</span>
          </a>
          <nav className="seg nav" aria-label="视图">
            {VIEWS.map((v) => <a key={v.id} href={hrefFor(v.id)} aria-current={route.view === v.id ? 'page' : undefined}>{v.label}</a>)}
          </nav>
          <div className="bar-end">
            {snap && <LiveBadge snap={snap} live={live} />}
            <button type="button" className="icon-btn theme-toggle" onClick={toggleScheme}>
              <span className="to-dark">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.6 9.7A6 6 0 0 1 6.3 2.4a6 6 0 1 0 7.3 7.3z" fill="currentColor" /></svg>
                <span className="sr-only">切换到深色</span>
              </span>
              <span className="to-light">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="3.2" fill="currentColor" />
                  <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.2 1.2M11.8 11.8L13 13M3 13l1.2-1.2M11.8 4.2L13 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="sr-only">切换到浅色</span>
              </span>
            </button>
          </div>
        </div>
      </header>

      <div className="page">
        {live.authUrl && !live.connected && (
          <p className="banner" role="status">
            需要你本人授权一次
            <a className="btn btn-small" href={live.authUrl} target="_blank" rel="noreferrer noopener">打开 moomoo 授权页 ↗</a>
          </p>
        )}
        {live.error && <p className="banner" role="alert">实时没连上：{live.error}</p>}

        <main>
          <h1 id="view-heading" className="sr-only" tabIndex={-1}>{current.label}</h1>
          {!snap && !error && <p className="empty">载入中</p>}
          {!snap && error && (STATIC
            ? <p className="empty">数据没有载入（{error}），稍后会自动重试。</p>
            : <p className="empty">数据服务没有响应（{error}）。运行 <code>npm run dev</code> 后会自动重连。</p>)}
          {snap && route.view === 'map' && <MapView snap={snap} />}
          {snap && route.view === 'ledger' && <LedgerView snap={snap} />}
          {snap && route.view === 'rates' && <RatesView snap={snap} />}
          {snap && route.view === 'verify' && <VerifyView snap={snap} />}
        </main>

        <footer className="foot">
          <details>
            <summary>读法</summary>
            <div className="foot-body">
              <p className="foot-row">
                <Meter level="strong" />日常波动的 2 倍以上
                <Meter level="mild" />1–2 倍
                <Meter level="none" />不到 1 倍
                <Meter level="pending" />待收盘
              </p>
              <p className="foot-row">
                <SigmaTrack r={{ z: 1.6, level: 'mild' }} />圆点是当天的位置：中线为 0，灰带是 ±1 倍日常波动，两端是 ±3 倍；在右是向上，在左是向下
              </p>
              <p>反应 = 事件当天的涨跌（盘后的事件取下一个交易日）扣掉 beta × 纳指 100，再除以此前 60 个交易日的日常波动；利率用基点。† 表示当天同一标的还有别的记录，或大盘大幅波动，这段涨跌不能单独归因。</p>
              <p>柱子是一个数字的历次读数，都从零线起画，最深的一根是当前这一条；并列的几个口径不分深浅，也不算涨跌幅。</p>
              <p>全景图上箭头是钱的方向，线越粗金额越大；主体右上角的数字是近 7 天的变动条数；虚线框是 IPO 进行中。信源只标谁发的、哪一类。</p>
            </div>
          </details>
          <p className="foot-line">
            <span>{STATIC ? '行情是收盘数据，来自 moomoo；内容整理自公开报道，不构成投资建议。' : '行情来自 moomoo，仅供个人使用，不构成投资建议。'}</span>
            {live.connected && <button type="button" className="link" onClick={live.disconnect}>断开实时</button>}
          </p>
        </footer>
      </div>

      {snap && <DossierSheet snap={snap} id={route.entity} view={route.view} />}
    </>
  );
}
