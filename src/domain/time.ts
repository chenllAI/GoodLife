/**
 * 民用日期运算（日/周/月窗口）
 *
 * 三条实现纪律，每一条都对应一类真实会发生的 bug：
 *
 * 1. **绝不用 `new Date('2026-09-20')`。** 裸日期串会被按 UTC 午夜解析，在负时区
 *    （如 America/New_York）会整体偏移到前一天。一律用显式本地分量构造。
 * 2. **构造在 12:00 而不是 00:00。** 午夜正是夏令时切换的落点，`setDate(+1)` 可能
 *    落在同一天或被跳过的一天。正午对 DST 免疫。中国当前无 DST，但这个技巧零成本。
 * 3. **从不用 Date 对象做区间过滤。** DayKey 是零填充字符串，字典序恰好等于时间序，
 *    所以窗口判断和排序都是纯字符串比较，热路径上不出现 Date。
 */

import type { DayKey, DayRange, MonthKey, Period } from '@/types'

const WEEKDAY_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

/** 以**本地时区**的正午构造 Date —— 见文件头纪律 2 */
function localNoon(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Date → 'YYYY-MM-DD'（取本地民用日期，不做 UTC 转换） */
export function dayKeyOf(d: Date): DayKey {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function makeDayKey(y: number, m: number, d: number): DayKey {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

export function parseDayKey(key: DayKey): { y: number; m: number; d: number } {
  const parts = key.split('-')
  const y = Number(parts[0])
  const m = Number(parts[1])
  const d = Number(parts[2])
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new RangeError(`无法解析的日期键：${JSON.stringify(key)}`)
  }
  return { y, m, d }
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function monthKeyOf(key: DayKey): MonthKey {
  return key.slice(0, 7)
}

export function todayKey(now: Date = new Date()): DayKey {
  return dayKeyOf(now)
}

/** 日期加减天数（跨月跨年自动处理） */
export function addDays(key: DayKey, n: number): DayKey {
  const { y, m, d } = parseDayKey(key)
  const dt = localNoon(y, m, d)
  dt.setDate(dt.getDate() + n)
  return dayKeyOf(dt)
}

export function addMonths(key: DayKey, n: number): DayKey {
  const { y, m, d } = parseDayKey(key)
  // 先落到 1 号再加月，避免 1/31 + 1 个月 落到 3/3 这类溢出
  const dt = localNoon(y, m + n, 1)
  const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0, 12).getDate()
  return makeDayKey(dt.getFullYear(), dt.getMonth() + 1, Math.min(d, lastDay))
}

/** 本周一（中国习惯：周一为一周开始）。周日的返回值是**上一个**周一。 */
export function weekStart(key: DayKey): DayKey {
  const { y, m, d } = parseDayKey(key)
  const dt = localNoon(y, m, d)
  // getDay(): 0=周日 … 6=周六  →  转成 0=周一 … 6=周日
  const dow = (dt.getDay() + 6) % 7
  return addDays(key, -dow)
}

/** 当月 1 号 */
export function monthStart(key: DayKey): DayKey {
  const { y, m } = parseDayKey(key)
  return makeDayKey(y, m, 1)
}

/** 当月最后一天。`new Date(y, m, 0)` 的「第 0 天」即 1-based 第 m 月的最后一天。 */
export function monthEnd(key: DayKey): DayKey {
  const { y, m } = parseDayKey(key)
  const last = new Date(y, m, 0, 12).getDate()
  return makeDayKey(y, m, last)
}

/**
 * 某个周期对应的闭区间 [start, end]。
 * - 日榜：就是当天
 * - 周榜：周一 ~ 周日
 * - 月榜：1 号 ~ 月末
 */
export function rangeOf(period: Period, anchor: DayKey): DayRange {
  switch (period) {
    case 'day':
      return { start: anchor, end: anchor }
    case 'week': {
      const start = weekStart(anchor)
      return { start, end: addDays(start, 6) }
    }
    case 'month':
      return { start: monthStart(anchor), end: monthEnd(anchor) }
  }
}

/**
 * **上一个自然周期**（昨天 / 上周一~周日 / 上月），而不是滚动窗口。
 * 用户对「环比」的预期是「跟上个周期比」，不是「跟前 7 天比」。
 */
export function prevRange(period: Period, anchor: DayKey): DayRange {
  const cur = rangeOf(period, anchor)
  // 当前周期起点的前一天，必然落在上一个周期内
  const dayBefore = addDays(cur.start, -1)
  return rangeOf(period, dayBefore)
}

/** 区间覆盖到的所有月份键（用于决定读哪几个分片） */
export function monthsInRange(range: DayRange): MonthKey[] {
  const out: MonthKey[] = []
  let cur = monthStart(range.start)
  const last = monthKeyOf(range.end)
  // 上限兜底，防止异常输入导致死循环
  for (let guard = 0; guard < 600; guard++) {
    const mk = monthKeyOf(cur)
    out.push(mk)
    if (mk >= last) break
    cur = addMonths(cur, 1)
  }
  return out
}

/** 区间内每一天（用于趋势图与热力图） */
export function daysInRange(range: DayRange): DayKey[] {
  const out: DayKey[] = []
  let cur = range.start
  for (let guard = 0; guard < 1000; guard++) {
    out.push(cur)
    if (cur >= range.end) break
    cur = addDays(cur, 1)
  }
  return out
}

/** 把 anchor 往前推 n 个周期，用于「上一周期」对比与多周期趋势 */
export function shiftPeriod(period: Period, anchor: DayKey, n: number): DayKey {
  switch (period) {
    case 'day':
      return addDays(anchor, n)
    case 'week':
      return addDays(anchor, n * 7)
    case 'month':
      return addMonths(anchor, n)
  }
}

// ---------------------------------------------------------------------------
// 展示格式化
// ---------------------------------------------------------------------------

/** '2026-09-20' → '9月20日' */
export function formatDayLabel(key: DayKey): string {
  const { m, d } = parseDayKey(key)
  return `${m}月${d}日`
}

/** '2026-09-20' → '9/20' */
export function formatDayShort(key: DayKey): string {
  const { m, d } = parseDayKey(key)
  return `${m}/${d}`
}

/** '2026-09-20' → '周六' */
export function formatWeekday(key: DayKey): string {
  const { y, m, d } = parseDayKey(key)
  const dow = (localNoon(y, m, d).getDay() + 6) % 7
  return WEEKDAY_CN[dow] as string
}

/** 周期区间的可读标题 */
export function formatRangeLabel(period: Period, anchor: DayKey): string {
  const r = rangeOf(period, anchor)
  switch (period) {
    case 'day':
      return `${formatDayLabel(anchor)} ${formatWeekday(anchor)}`
    case 'week': {
      const a = parseDayKey(r.start)
      const b = parseDayKey(r.end)
      // 同一月份时不重复写月份
      return a.m === b.m
        ? `${a.m}月${a.d}日 - ${b.d}日`
        : `${a.m}月${a.d}日 - ${b.m}月${b.d}日`
    }
    case 'month': {
      const { y, m } = parseDayKey(anchor)
      return `${y}年${m}月`
    }
  }
}

/** 相对今天的人话描述，用于明细列表 */
export function formatRelativeDay(key: DayKey, today: DayKey): string {
  if (key === today) return '今天'
  if (key === addDays(today, -1)) return '昨天'
  if (key === addDays(today, -2)) return '前天'
  const { m, d } = parseDayKey(key)
  return `${m}月${d}日`
}
