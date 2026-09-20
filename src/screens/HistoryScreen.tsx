/**
 * 积分明细页
 *
 * 需求里的「积分明细」和「明细可删除」都落在这一页。默认显示全部历史，
 * 因为「翻回去看看上周做了什么」是这一页最常见的用途；要找某一天用上面的筛选。
 */

import { useMemo, useState } from 'react'
import { recordsInRange } from '@/domain/aggregate'
import { formatRangeLabel, rangeOf, todayKey } from '@/domain/time'
import { useApp } from '@/state/store'
import { RecordList } from '@/components/leaderboard'
import { Segmented, TableToggle } from '@/components/ui'

type Scope = 'all' | 'today' | 'week' | 'month'

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
]

export function HistoryScreen() {
  const doc = useApp((s) => s.doc)
  const deleteRecord = useApp((s) => s.deleteRecord)

  const [scope, setScope] = useState<Scope>('all')
  const [memberFilter, setMemberFilter] = useState<string | null>(null)
  const [showStats, setShowStats] = useState(false)

  const today = todayKey()
  const records = doc.records
  const members = doc.meta.members

  const filtered = useMemo(() => {
    const base =
      scope === 'all'
        ? records
        : recordsInRange(records, rangeOf(scope === 'today' ? 'day' : scope, today))
    const live = base.filter((r) => !r.deleted)
    const byMember = memberFilter ? live.filter((r) => r.memberId === memberFilter) : live
    return [...byMember].sort((a, b) => (a.at < b.at ? 1 : -1))
  }, [records, scope, memberFilter, today])

  const perMember = useMemo(
    () =>
      members.map((m) => {
        const mine = filtered.filter((r) => r.memberId === m.id)
        return {
          member: m,
          points: mine.reduce((s, r) => s + r.points, 0),
          count: mine.length,
        }
      }),
    [filtered, members],
  )

  const totals = useMemo(() => {
    let points = 0
    for (const r of filtered) points += r.points
    return { points, count: filtered.length }
  }, [filtered])

  const scopeLabel =
    scope === 'all' ? '全部历史' : formatRangeLabel(scope === 'today' ? 'day' : scope, today)

  return (
    <>
      <Segmented
        options={SCOPE_OPTIONS}
        value={scope}
        onChange={setScope}
        ariaLabel="选择明细的时间范围"
      />
      <div className="period-label">{scopeLabel}</div>

      <div className="filter-row">
        <button
          type="button"
          className="chip"
          aria-pressed={memberFilter === null}
          onClick={() => setMemberFilter(null)}
        >
          两人都看
        </button>
        {members.map((m) => (
          <button
            key={m.id}
            type="button"
            className="chip"
            aria-pressed={memberFilter === m.id}
            onClick={() => setMemberFilter(memberFilter === m.id ? null : m.id)}
          >
            {m.avatarEmoji} {m.name}
          </button>
        ))}
      </div>

      <section className="card">
        <div className="card__head">
          <h3 className="card__title">📊 小计</h3>
          <TableToggle showTable={showStats} onToggle={setShowStats} />
        </div>

        {showStats ? (
          <table className="datatable">
            <thead>
              <tr>
                <th>成员</th>
                <th>积分</th>
                <th>件数</th>
              </tr>
            </thead>
            <tbody>
              {perMember.map((p) => (
                <tr key={p.member.id}>
                  <td>
                    {p.member.avatarEmoji} {p.member.name}
                  </td>
                  <td className="tnum">{p.points}</td>
                  <td className="tnum">{p.count}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>合计</strong>
                </td>
                <td className="tnum">
                  <strong>{totals.points}</strong>
                </td>
                <td className="tnum">
                  <strong>{totals.count}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="stat-row">
            {perMember.map((p) => (
              <div className="stat" key={p.member.id}>
                <div className="stat__value tnum" style={{ color: `var(--series-${p.member.seriesSlot}-deep)` }}>
                  {p.points}
                </div>
                <div className="stat__label">
                  {p.member.avatarEmoji} {p.member.name}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card card--flush">
        <RecordList
          records={filtered}
          members={members}
          today={today}
          onDelete={deleteRecord}
        />
      </section>

      <p className="field__hint" style={{ textAlign: 'center', padding: '0 12px 8px' }}>
        点记录右边的 ✕ 可以删掉记错的那一条，积分会跟着扣回去。
      </p>
    </>
  )
}
