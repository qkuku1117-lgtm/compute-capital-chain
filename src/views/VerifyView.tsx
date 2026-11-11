// 验证：每条变动都指向一个"到时候看什么"。按时间分组，过期没核对的排在最前；点开一行看细节。
import type { CalendarItem, Snapshot } from '../../shared/types.ts';
import { VerifyItem } from '../components.tsx';
import { daysBetween, todayIso } from '../lib.ts';

export function VerifyView({ snap }: { snap: Snapshot }) {
  const today = todayIso();
  const dated = snap.calendar.filter((c) => c.date).sort((a, b) => a.date.localeCompare(b.date));
  const groups: { id: string; title: string; items: CalendarItem[] }[] = [
    { id: 'due', title: '已到期', items: dated.filter((c) => c.date < today) },
    { id: 'today', title: '今天', items: dated.filter((c) => c.date === today) },
    { id: 'week', title: '七天内', items: dated.filter((c) => c.date > today && daysBetween(today, c.date) <= 7) },
    { id: 'later', title: '更晚', items: dated.filter((c) => daysBetween(today, c.date) > 7) },
    { id: 'tbd', title: '日期未定', items: snap.calendar.filter((c) => !c.date) },
  ].filter((g) => g.items.length > 0);

  return (
    <>
      {groups.map((g) => (
        <section key={g.id} className="group" aria-labelledby={`vp-${g.id}`}>
          <div className="group-head">
            <h2 id={`vp-${g.id}`} className="title">{g.title}</h2>
            <span className="count">{g.items.length}</span>
          </div>
          <div className="card list rows">
            {g.items.map((c) => <VerifyItem key={c.id} c={c} snap={snap} view="verify" />)}
          </div>
        </section>
      ))}
    </>
  );
}
