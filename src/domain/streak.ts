/**
 * 连续打卡天数
 *
 * 一个容易忽略的细节：如果今天还没有任何记录，连续天数不应该显示为 0 ——
 * 早上打开应用时看到「连续 0 天」，会让人以为断签了，而其实今天才刚开始。
 * 所以今天无记录时，从**昨天**往前数。
 */

import type { DayKey, PointsRecord } from '@/types'
import { addDays } from './time'

/** 取出一组记录里出现过的所有日期 */
export function activeDays(records: readonly PointsRecord[]): Set<DayKey> {
  const set = new Set<DayKey>()
  for (const r of records) {
    if (r.deleted) continue
    set.add(r.day)
  }
  return set
}

/**
 * 当前连续天数。
 *
 * @param records 该成员（或全家）的记录
 * @param today   今天
 */
export function currentStreak(records: readonly PointsRecord[], today: DayKey): number {
  const days = activeDays(records)
  if (days.size === 0) return 0

  // 今天还没记录时从昨天起算，避免「今天才刚开始」被误判为断签
  let cursor = days.has(today) ? today : addDays(today, -1)
  if (!days.has(cursor)) return 0

  let count = 0
  // 上限兜底：连续天数不可能超过记录总数
  for (let guard = 0; guard <= days.size + 1; guard++) {
    if (!days.has(cursor)) break
    count++
    cursor = addDays(cursor, -1)
  }
  return count
}

/** 历史最长连续天数 */
export function longestStreak(records: readonly PointsRecord[]): number {
  const days = [...activeDays(records)].sort()
  if (days.length === 0) return 0

  let best = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1] as DayKey
    const cur = days[i] as DayKey
    if (addDays(prev, 1) === cur) {
      run++
      if (run > best) best = run
    } else {
      run = 1
    }
  }
  return best
}

/** 某一天做了几件 */
export function countOnDay(records: readonly PointsRecord[], day: DayKey): number {
  let n = 0
  for (const r of records) {
    if (!r.deleted && r.day === day) n++
  }
  return n
}
