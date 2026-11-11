// 变动：按日期倒序，一天一张卡，一条一行；点开一行才看到历次读数、前后对照和四个字段。
import { useMemo, useState } from 'react';
import type { ChangeView, Layer, Snapshot } from '../../shared/types.ts';
import { Entry } from '../components.tsx';
import { clock, LAYER_LABEL, longDate } from '../lib.ts';

const LAYERS: Layer[] = ['capital', 'model', 'cloud', 'neocloud', 'hardware'];
const SESSION_ORDER = { pre: 0, intra: 1, post: 2 } as const;
const weight = (c: ChangeView) => Math.max(0, ...c.reactions.map((r) => Math.abs(r.z ?? 0)));

export function LedgerView({ snap }: { snap: Snapshot }) {
  const [layer, setLayer] = useState<Layer | 'all'>('all');
  const [newOnly, setNewOnly] = useState(false);
  const [strongOnly, setStrongOnly] = useState(false);
  const layerOf = useMemo(() => new Map(snap.entities.map((e) => [e.id, e.layer])), [snap.entities]);

  const shown = snap.changes.filter((c) => {
    if (layer !== 'all' && layerOf.get(c.entity) !== layer && !(c.related ?? []).some((r) => layerOf.get(r) === layer)) return false;
    if (newOnly && c.novelty !== 'new') return false;
    if (strongOnly && !c.reactions.some((r) => r.level === 'strong')) return false;
    return true;
  });
  const groups = new Map<string, ChangeView[]>();
  for (const c of shown) groups.set(c.date, [...(groups.get(c.date) ?? []), c]);
  const dates = [...groups.keys()].sort((a, b) => b.localeCompare(a));
  const entityName = (id: string) => snap.entities.find((e) => e.id === id)?.zh ?? id;

  return (
    <>
      <div className="chips filters" role="group" aria-label="筛选">
        <button type="button" className="chip" aria-pressed={layer === 'all'} onClick={() => setLayer('all')}>全部</button>
        {LAYERS.map((l) => <button key={l} type="button" className="chip" aria-pressed={layer === l} onClick={() => setLayer(l)}>{LAYER_LABEL[l]}</button>)}
        <span className="sep" aria-hidden="true" />
        <button type="button" className="chip" aria-pressed={newOnly} onClick={() => setNewOnly((v) => !v)}>新增</button>
        <button type="button" className="chip" aria-pressed={strongOnly} onClick={() => setStrongOnly((v) => !v)}>显著</button>
        <span className="count" aria-live="polite">{shown.length} / {snap.changes.length}</span>
      </div>

      {snap.inbox.length > 0 && (
        <details className="card list inbox">
          <summary><span className="title">待整理</span><span className="count">{snap.inbox.length}</span></summary>
          <ul>
            {snap.inbox.map((n) => (
              <li key={n.id}>
                <span className="num muted">{clock(n.time)}</span>
                <b>{entityName(n.entity)}</b>
                {n.url ? <a href={n.url} target="_blank" rel="noreferrer noopener">{n.title}</a> : <span>{n.title}</span>}
                <span className="muted">{n.pub}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {dates.length === 0 && <p className="empty">没有符合的变动</p>}
      {dates.map((d) => {
        const list = groups.get(d)!.sort((a, b) => SESSION_ORDER[a.session] - SESSION_ORDER[b.session] || weight(b) - weight(a));
        return (
          <section key={d} className="group" aria-labelledby={`day-${d}`}>
            <div className="group-head">
              <h2 id={`day-${d}`} className="title">{longDate(d)}</h2>
              <span className="count">{list.length}</span>
            </div>
            <div className="card list rows">
              {list.map((c) => <Entry key={c.id} change={c} snap={snap} view="ledger" />)}
            </div>
          </section>
        );
      })}
    </>
  );
}
