/**
 * 榜单聚合
 *
 * 全部基于 `PointsRecord.day`（记录时冻结的民用日期）做**字符串**区间比较，
 * 分数一律取自记录里的**快照** `points`，绝不回查家务表。这两条保证了：
 *   - 结果不受设备时区、时区数据库版本、时钟漂移影响
 *   - 调整家务分值不会改写历史榜单
 */

import type {
  ChoreCategory,
  DayKey,
  DayRange,
  Member,
  Period,
  PointsRecord,
} from '@/types'
import { CHORE_CATEGORIES } from '@/types'
import { daysInRange, prevRange, rangeOf } from './time'

export interface ChoreTally {
  choreId: string | null
  name: string
  emoji: string
  points: number
  count: number
}

export interface MemberStanding {
  memberId: string
  points: number
  count: number
  byCategory: Record<ChoreCategory, number>
  byChore: Record<string, ChoreTally>
  /**
   * 该成员「首次达到最终总分」的那一刻。
   * 用于并列打破 —— 字面意义上的「谁先到」。
   */
  reachedAt: string | null
}

function emptyCategoryMap(): Record<ChoreCategory, number> {
  const out = {} as Record<ChoreCategory, number>
  for (const c of CHORE_CATEGORIES) out[c] = 0
  return out
}

/** 取区间内的有效记录（墓碑排除，两端闭区间） */
export function recordsInRange(
  records: readonly PointsRecord[],
  range: DayRange,
): PointsRecord[] {
  return records.filter(
    (r) => !r.deleted && r.day >= range.start && r.day <= range.end,
  )
}

/**
 * 计算每位成员在区间内的战绩。
 *
 * @param records 全量记录（内部自行过滤，调用方无需预筛）
 * @param members 成员列表 —— **顺序即并列打破的最后一层**，保证渲染顺序稳定
 */
export function aggregate(
  records: readonly PointsRecord[],
  members: readonly Member[],
  range: DayRange,
): MemberStanding[] {
  const inRange = recordsInRange(records, range)

  return members.map((m) => {
    const mine = inRange.filter((r) => r.memberId === m.id)

    let points = 0
    const byCategory = emptyCategoryMap()
    const byChore: Record<string, ChoreTally> = {}

    for (const r of mine) {
      points += r.points
      byCategory[r.category] += r.points

      const key = r.choreId ?? `name:${r.choreName}`
      const tally = byChore[key]
      if (tally) {
        tally.points += r.points
        tally.count += 1
      } else {
        byChore[key] = {
          choreId: r.choreId,
          name: r.choreName,
          emoji: r.choreEmoji,
          points: r.points,
          count: 1,
        }
      }
    }

    return {
      memberId: m.id,
      points,
      count: mine.length,
      byCategory,
      byChore,
      reachedAt: computeReachedAt(mine, points),
    }
  })
}

/**
 * 「首次达到最终总分」的时刻。
 *
 * 注意是**首次**到达，不是最后一次 —— 如果小影中途被反超又追平，那「先到的人」
 * 应该是她第一次拿到这个分数的时候。
 */
function computeReachedAt(records: readonly PointsRecord[], total: number): string | null {
  if (records.length === 0 || total <= 0) return null

  const sorted = [...records].sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  let sum = 0
  for (const r of sorted) {
    sum += r.points
    if (sum >= total) return r.at
  }
  return sorted[sorted.length - 1]?.at ?? null
}

export interface RankedStanding extends MemberStanding {
  rank: number
  /** 与他人并列同一名次 */
  tied: boolean
}

/**
 * 排名 + 并列判定。
 *
 * 四层打破，逐层确定性，绝不出现「顺序随渲染闪烁」：
 *   1. 积分降序
 *   2. 件数降序 —— 同分时做得多的人赢，奖励勤快而不是单笔大活
 *   3. reachedAt 升序 —— 谁先到
 *   4. 成员原始顺序 —— 最后的稳定兜底
 *
 * 四层全平 → 共享名次并标记 `tied`。
 * 名次采用「标准竞技排名」：1, 1, 3。
 */
export function rankStandings(standings: readonly MemberStanding[]): RankedStanding[] {
  const indexed = standings.map((s, i) => ({ s, i }))

  indexed.sort((a, b) => {
    if (b.s.points !== a.s.points) return b.s.points - a.s.points
    if (b.s.count !== a.s.count) return b.s.count - a.s.count

    const ra = a.s.reachedAt
    const rb = b.s.reachedAt
    if (ra !== rb) {
      if (ra === null) return 1 // 没到达过的排后面
      if (rb === null) return -1
      return ra < rb ? -1 : 1
    }
    return a.i - b.i
  })

  const out: RankedStanding[] = []
  for (let k = 0; k < indexed.length; k++) {
    const entry = indexed[k]
    if (!entry) continue
    const prev = indexed[k - 1]

    const isTieWithPrev =
      prev !== undefined &&
      prev.s.points === entry.s.points &&
      prev.s.count === entry.s.count &&
      prev.s.reachedAt === entry.s.reachedAt

    const rank = isTieWithPrev ? (out[k - 1]?.rank ?? k + 1) : k + 1

    out.push({ ...entry.s, rank, tied: false })
  }

  // 第二遍标记并列：同一名次出现多次即并列
  const rankCount = new Map<number, number>()
  for (const r of out) rankCount.set(r.rank, (rankCount.get(r.rank) ?? 0) + 1)
  return out.map((r) => ({ ...r, tied: (rankCount.get(r.rank) ?? 0) > 1 }))
}

// ---------------------------------------------------------------------------
// 环比
// ---------------------------------------------------------------------------

export interface MemberDelta {
  memberId: string
  points: number
  /** 上一周期为零时返回 null —— UI 应显示「新增」而不是「∞」 */
  pointsPct: number | null
  count: number
  rankNow: number
  rankPrev: number
  /** 正数表示名次上升（数字变小） */
  rankDelta: number
}

export function computeDeltas(
  records: readonly PointsRecord[],
  members: readonly Member[],
  period: Period,
  anchor: DayKey,
): MemberDelta[] {
  const now = rankStandings(aggregate(records, members, rangeOf(period, anchor)))
  const prevRangeObj = prevRange(period, anchor)
  const prev = rankStandings(aggregate(records, members, prevRangeObj))

  const prevById = new Map(prev.map((p) => [p.memberId, p]))

  return now.map((n) => {
    const p = prevById.get(n.memberId)
    const prevPoints = p?.points ?? 0
    const prevRank = p?.rank ?? members.length
    return {
      memberId: n.memberId,
      points: n.points,
      pointsPct:
        prevPoints > 0
          ? Math.round(((n.points - prevPoints) / prevPoints) * 100)
          : null,
      count: n.count,
      rankNow: n.rank,
      rankPrev: prevRank,
      rankDelta: prevRank - n.rank,
    }
  })
}

// ---------------------------------------------------------------------------
// 图表数据
// ---------------------------------------------------------------------------

export interface FamilyTotals {
  points: number
  count: number
}

export function familyTotals(
  records: readonly PointsRecord[],
  range: DayRange,
): FamilyTotals {
  const inRange = recordsInRange(records, range)
  let points = 0
  for (const r of inRange) points += r.points
  return { points, count: inRange.length }
}

export interface DailyPoint {
  day: DayKey
  /** memberId → 当天积分 */
  byMember: Record<string, number>
  total: number
}

/** 逐日积分，用于趋势折线与热力图 */
export function dailySeries(
  records: readonly PointsRecord[],
  members: readonly Member[],
  range: DayRange,
): DailyPoint[] {
  const inRange = recordsInRange(records, range)
  const index = new Map<DayKey, Map<string, number>>()

  for (const r of inRange) {
    let m = index.get(r.day)
    if (!m) {
      m = new Map()
      index.set(r.day, m)
    }
    m.set(r.memberId, (m.get(r.memberId) ?? 0) + r.points)
  }

  return daysInRange(range).map((day) => {
    const m = index.get(day)
    const byMember: Record<string, number> = {}
    let total = 0
    for (const member of members) {
      const v = m?.get(member.id) ?? 0
      byMember[member.id] = v
      total += v
    }
    return { day, byMember, total }
  })
}

export interface CategoryComparison {
  category: ChoreCategory
  byMember: Record<string, number>
  max: number
}

/** 分类对比，用于分组横向条形图（替代雷达图 —— 雷达会扭曲面积，且轴序任意） */
export function categoryComparison(
  records: readonly PointsRecord[],
  members: readonly Member[],
  range: DayRange,
): CategoryComparison[] {
  const standings = aggregate(records, members, range)
  const byMemberId = new Map(standings.map((s) => [s.memberId, s]))

  return CHORE_CATEGORIES.map((category) => {
    const byMember: Record<string, number> = {}
    let max = 0
    for (const m of members) {
      const v = byMemberId.get(m.id)?.byCategory[category] ?? 0
      byMember[m.id] = v
      if (v > max) max = v
    }
    return { category, byMember, max }
  })
}
