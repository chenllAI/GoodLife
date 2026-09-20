/**
 * 日期运算测试
 *
 * 基准真值已在 Asia/Shanghai 下核对：
 *   - 2026-09-20 是**周日**，本周为 2026-09-14(一) ~ 2026-09-20(日)
 *   - 2026-12-29 所在周为 2026-12-28 ~ 2027-01-03，**同时跨月和跨年**
 *   - 2027-02 有 28 天，2028-02 有 29 天
 */

import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  dayKeyOf,
  daysInRange,
  formatRangeLabel,
  formatRelativeDay,
  formatWeekday,
  makeDayKey,
  monthEnd,
  monthKeyOf,
  monthStart,
  monthsInRange,
  parseDayKey,
  prevRange,
  rangeOf,
  shiftPeriod,
  weekStart,
} from '@/domain/time'

describe('weekStart（周一为一周开始）', () => {
  it('同一周内的七天都归到同一个周一', () => {
    const week = [
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]
    for (const day of week) {
      expect(weekStart(day), `${day} 的周一`).toBe('2026-09-14')
    }
  })

  it('周日归到**上一个**周一，而不是下一个', () => {
    // 这是周起始日实现里最常见的差一周 bug
    expect(weekStart('2026-09-20')).toBe('2026-09-14')
    expect(weekStart('2026-09-21')).toBe('2026-09-21')
  })

  it('周一自己是自己的周一', () => {
    expect(weekStart('2026-09-14')).toBe('2026-09-14')
  })

  it('跨年周：2026-12-29 属于 2026-12-28 ~ 2027-01-03', () => {
    expect(weekStart('2026-12-29')).toBe('2026-12-28')
    expect(addDays(weekStart('2026-12-29'), 6)).toBe('2027-01-03')
  })
})

describe('monthEnd / monthStart', () => {
  it('平年二月 28 天', () => {
    expect(monthEnd('2027-02-10')).toBe('2027-02-28')
  })

  it('闰年二月 29 天', () => {
    expect(monthEnd('2028-02-10')).toBe('2028-02-29')
  })

  it('31 天的月份', () => {
    expect(monthEnd('2026-12-01')).toBe('2026-12-31')
    expect(monthEnd('2026-01-15')).toBe('2026-01-31')
  })

  it('30 天的月份', () => {
    expect(monthEnd('2026-09-05')).toBe('2026-09-30')
  })

  it('monthStart 恒为 1 号', () => {
    expect(monthStart('2026-09-20')).toBe('2026-09-01')
  })
})

describe('addDays / addMonths', () => {
  it('跨月', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30')
  })

  it('跨年', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
  })

  it('闰年 2 月 29 日前后', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
  })

  it('addMonths 不会因为月末溢出（1/31 + 1 个月不应变成 3/3）', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
  })

  it('addMonths 跨年', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
  })
})

describe('rangeOf', () => {
  it('日榜就是当天', () => {
    expect(rangeOf('day', '2026-09-20')).toEqual({
      start: '2026-09-20',
      end: '2026-09-20',
    })
  })

  it('周榜是周一到周日', () => {
    expect(rangeOf('week', '2026-09-20')).toEqual({
      start: '2026-09-14',
      end: '2026-09-20',
    })
  })

  it('月榜是 1 号到月末', () => {
    expect(rangeOf('month', '2026-09-20')).toEqual({
      start: '2026-09-01',
      end: '2026-09-30',
    })
  })
})

describe('prevRange（上一个自然周期，不是滚动窗口）', () => {
  it('昨天', () => {
    expect(prevRange('day', '2026-09-20')).toEqual({
      start: '2026-09-19',
      end: '2026-09-19',
    })
  })

  it('上一周：2026-09-14~20 的前一周是 2026-09-07~13', () => {
    expect(prevRange('week', '2026-09-20')).toEqual({
      start: '2026-09-07',
      end: '2026-09-13',
    })
  })

  it('上一月：9 月的上一月是 8 月，且天数是 8 月的', () => {
    expect(prevRange('month', '2026-09-20')).toEqual({
      start: '2026-08-01',
      end: '2026-08-31',
    })
  })

  it('跨年：1 月的上一月是去年 12 月', () => {
    expect(prevRange('month', '2027-01-05')).toEqual({
      start: '2026-12-01',
      end: '2026-12-31',
    })
  })

  it('跨年周：2026-12-28 那周的上一周落在 12 月内', () => {
    expect(prevRange('week', '2026-12-29')).toEqual({
      start: '2026-12-21',
      end: '2026-12-27',
    })
  })
})

describe('monthsInRange —— 决定读哪几个数据分片', () => {
  it('单月区间只要一个分片', () => {
    expect(monthsInRange(rangeOf('month', '2026-09-20'))).toEqual(['2026-09'])
  })

  it('日榜通常只要一个分片', () => {
    expect(monthsInRange(rangeOf('day', '2026-09-20'))).toEqual(['2026-09'])
  })

  it('跨月的那一周需要两个分片', () => {
    expect(monthsInRange(rangeOf('week', '2026-12-29'))).toEqual(['2026-12', '2027-01'])
  })

  it('跨年的长区间按顺序列出所有月份', () => {
    expect(monthsInRange({ start: '2026-11-15', end: '2027-02-03' })).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ])
  })
})

describe('daysInRange', () => {
  it('单日区间有一天', () => {
    expect(daysInRange({ start: '2026-09-20', end: '2026-09-20' })).toEqual(['2026-09-20'])
  })

  it('整周有七天', () => {
    const days = daysInRange({ start: '2026-09-14', end: '2026-09-20' })
    expect(days).toHaveLength(7)
    expect(days[0]).toBe('2026-09-14')
    expect(days[6]).toBe('2026-09-20')
  })

  it('跨月连续无断点', () => {
    const days = daysInRange({ start: '2026-09-28', end: '2026-10-03' })
    expect(days).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ])
  })

  it('闰年 2 月有 29 天', () => {
    expect(daysInRange({ start: '2028-02-01', end: '2028-02-29' })).toHaveLength(29)
  })
})

describe('shiftPeriod', () => {
  it('往前推一个周期', () => {
    expect(shiftPeriod('day', '2026-09-20', -1)).toBe('2026-09-19')
    expect(shiftPeriod('week', '2026-09-20', -1)).toBe('2026-09-13')
    expect(shiftPeriod('month', '2026-09-20', -1)).toBe('2026-08-20')
  })
})

describe('基础工具函数', () => {
  it('parseDayKey / makeDayKey 往返一致', () => {
    const k = '2026-09-05'
    const { y, m, d } = parseDayKey(k)
    expect(makeDayKey(y, m, d)).toBe(k)
  })

  it('parseDayKey 对非法输入抛错', () => {
    expect(() => parseDayKey('not-a-date')).toThrow()
  })

  it('monthKeyOf 取前 7 位', () => {
    expect(monthKeyOf('2026-09-20')).toBe('2026-09')
  })

  it('dayKeyOf 用本地分量而非 UTC', () => {
    // 本地时间 2026-09-20 23:30 —— 在 UTC+8 下 UTC 仍是同一天，
    // 但若实现误用 UTC 取值，在负时区就会差一天
    const d = new Date(2026, 8, 20, 23, 30, 0)
    expect(dayKeyOf(d)).toBe('2026-09-20')
  })

  it('formatWeekday 正确', () => {
    expect(formatWeekday('2026-09-20')).toBe('周日')
    expect(formatWeekday('2026-09-14')).toBe('周一')
  })

  it('formatRangeLabel 三种周期都不抛错且含关键信息', () => {
    expect(formatRangeLabel('day', '2026-09-20')).toContain('9月20日')
    expect(formatRangeLabel('week', '2026-09-20')).toContain('9月14日')
    expect(formatRangeLabel('month', '2026-09-20')).toContain('2026年9月')
  })

  it('formatRelativeDay 用「今天/昨天/前天」而不是日期', () => {
    const today = '2026-09-20'
    expect(formatRelativeDay('2026-09-20', today)).toBe('今天')
    expect(formatRelativeDay('2026-09-19', today)).toBe('昨天')
    expect(formatRelativeDay('2026-09-18', today)).toBe('前天')
    expect(formatRelativeDay('2026-09-10', today)).toBe('9月10日')
  })
})
