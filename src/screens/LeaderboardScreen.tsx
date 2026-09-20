/**
 * 榜单页（首屏）
 *
 * 一条纪律：**顶部的日/周/月过滤行统辖本页所有图表**，而不是每张卡片各带一个
 * 切换。手机上多个独立过滤器会让人搞不清「我现在看的是哪个时间段」。
 */

import { useMemo, useState } from 'react'
import type { Period } from '@/types'
import {
  aggregate,
  categoryComparison,
  computeDeltas,
  dailySeries,
  familyTotals,
  rankStandings,
} from '@/domain/aggregate'
import { currentStreak } from '@/domain/streak'
import { addDays, formatRangeLabel, rangeOf, todayKey } from '@/domain/time'
import { useApp } from '@/state/store'
import {
  CategoryBars,
  CategoryTable,
  RaceBar,
  TrendLine,
} from '@/components/charts'
import { HeroTotal, MemberCard } from '@/components/leaderboard'
import { Segmented, TableToggle } from '@/components/ui'

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'day', label: '日榜' },
  { value: 'week', label: '周榜' },
  { value: 'month', label: '月榜' },
]

export function LeaderboardScreen() {
  const doc = useApp((s) => s.doc)
  const period = useApp((s) => s.period)
  const anchor = useApp((s) => s.anchor)
  const setPeriod = useApp((s) => s.setPeriod)

  const [showCategoryTable, setShowCategoryTable] = useState(false)

  const today = todayKey()
  const records = doc.records
  const members = doc.meta.members

  const view = useMemo(() => {
    const range = rangeOf(period, anchor)
    const standings = rankStandings(aggregate(records, members, range))

    // 等级与连续天数看的是**全量历史**，不受当前时间窗口影响 ——
    // 否则切到「日榜」时所有人的等级都会掉回 0
    const lifetime: Record<string, number> = {}
    const streak: Record<string, number> = {}
    for (const m of members) {
      const mine = records.filter((r) => r.memberId === m.id && !r.deleted)
      lifetime[m.id] = mine.reduce((s, r) => s + r.points, 0)
      streak[m.id] = currentStreak(mine, today)
    }

    // 走势图**不能**用当前周期的区间：日榜的区间只有一天，画出来就是孤零零一个点。
    // 所以日榜固定看近 7 天，周榜看本周，月榜看本月。
    const trendRange =
      period === 'day' ? { start: addDays(anchor, -6), end: anchor } : range
    const trendLabel = period === 'day' ? '近 7 天' : period === 'week' ? '本周' : '本月'

    return {
      standings,
      totals: familyTotals(records, range),
      deltas: computeDeltas(records, members, period, anchor),
      lifetime,
      streak,
      trend: dailySeries(records, members, trendRange),
      trendLabel,
      categories: categoryComparison(records, members, range),
    }
  }, [records, members, period, anchor, today])

  const leader = view.standings[0]
  const isTied = view.standings.length > 1 && view.standings.every((s) => s.tied)

  const seriesInfo = members.map((m) => ({
    id: m.id,
    name: m.name,
    seriesSlot: m.seriesSlot,
  }))

  const racePoints: Record<string, number> = {}
  for (const s of view.standings) racePoints[s.memberId] = s.points

  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === period)?.label ?? ''

  return (
    <>
      <Segmented
        options={PERIOD_OPTIONS}
        value={period}
        onChange={setPeriod}
        ariaLabel="选择榜单周期"
      />
      <div className="period-label">{formatRangeLabel(period, anchor)}</div>

      <HeroTotal points={view.totals.points} count={view.totals.count} label={periodLabel} />

      <div className="member-grid">
        {view.standings.map((s) => {
          const member = members.find((m) => m.id === s.memberId)
          if (!member) return null
          return (
            <MemberCard
              key={s.memberId}
              member={member}
              standing={s}
              rank={s.rank}
              tied={s.tied}
              lifetimePoints={view.lifetime[s.memberId] ?? 0}
              delta={view.deltas.find((d) => d.memberId === s.memberId)}
              streak={view.streak[s.memberId] ?? 0}
              isLead={!isTied && leader?.memberId === s.memberId && s.points > 0}
            />
          )
        })}
      </div>

      <section className="card">
        <div className="card__head">
          <h3 className="card__title">⚔️ 本期对决</h3>
          <span className="card__hint">
            {isTied && view.totals.points > 0 ? '不分高下！' : '条形越长分越高'}
          </span>
        </div>
        <RaceBar members={seriesInfo} points={racePoints} />
      </section>

      <section className="card">
        <div className="card__head">
          <h3 className="card__title">📈 {view.trendLabel}积分走势</h3>
          <span className="card__hint">点一下看某天</span>
        </div>
        <TrendLine series={seriesInfo} data={view.trend} />
      </section>

      <section className="card">
        <div className="card__head">
          <h3 className="card__title">🧩 各分类对比</h3>
          <TableToggle showTable={showCategoryTable} onToggle={setShowCategoryTable} />
        </div>
        {showCategoryTable ? (
          <CategoryTable series={seriesInfo} data={view.categories} />
        ) : (
          <>
            <CategoryBars series={seriesInfo} data={view.categories} />
            <div className="chart__legend">
              {seriesInfo.map((s) => (
                <span className="legend-item" key={s.id}>
                  <span
                    className={`legend-swatch legend-swatch--m${s.seriesSlot}`}
                    aria-hidden="true"
                  />
                  {s.name}
                </span>
              ))}
              <span style={{ color: 'var(--text-muted)' }}>单位：分</span>
            </div>
          </>
        )}
      </section>

      <p className="field__hint" style={{ textAlign: 'center', padding: '4px 12px 8px' }}>
        每条记录都在「明细」页，记错了可以去那里删掉 👇
      </p>
    </>
  )
}
