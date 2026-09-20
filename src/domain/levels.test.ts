/**
 * 等级与连续打卡测试
 */

import { describe, expect, it } from 'vitest'
import { LEVELS, levelOf } from '@/domain/levels'
import { activeDays, countOnDay, currentStreak, longestStreak } from '@/domain/streak'
import { makeRecord } from '@/tests/factories'

describe('levelOf', () => {
  it('0 分是第一个等级', () => {
    const s = levelOf(0)
    expect(s.level.title).toBe('家务小白')
    expect(s.index).toBe(0)
    expect(s.next?.title).toBe('家务学徒')
    expect(s.toNext).toBe(100)
    expect(s.progress).toBe(0)
  })

  it('刚好踩到边界值即进入该等级', () => {
    expect(levelOf(99).level.title).toBe('家务小白')
    expect(levelOf(100).level.title).toBe('家务学徒')
    expect(levelOf(299).level.title).toBe('家务学徒')
    expect(levelOf(300).level.title).toBe('家务能手')
  })

  it('进度按等级区间线性推进', () => {
    // 学徒区间 100–300，跨度 200
    expect(levelOf(200).progress).toBeCloseTo(0.5)
    expect(levelOf(150).toNext).toBe(150)
    expect(levelOf(299).progress).toBeCloseTo(0.995)
  })

  it('满级后没有下一级，进度恒为 1', () => {
    const top = LEVELS[LEVELS.length - 1]!
    const s = levelOf(top.min + 10_000)
    expect(s.level.title).toBe('家务之神')
    expect(s.next).toBeNull()
    expect(s.toNext).toBe(0)
    expect(s.progress).toBe(1)
  })

  it('负分不越界', () => {
    expect(() => levelOf(-50)).not.toThrow()
    expect(levelOf(-50).index).toBe(0)
    expect(levelOf(-50).progress).toBe(0)
  })

  it('小数输入被安全处理', () => {
    expect(levelOf(150.7).level.title).toBe('家务学徒')
  })

  it('等级门槛严格递增（防止配置写错）', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i]!.min).toBeGreaterThan(LEVELS[i - 1]!.min)
    }
  })
})

describe('currentStreak', () => {
  const TODAY = '2026-09-20'

  it('没有记录时为 0', () => {
    expect(currentStreak([], TODAY)).toBe(0)
  })

  it('连续三天（含今天）', () => {
    const records = [
      makeRecord({ id: 'a', day: '2026-09-20' }),
      makeRecord({ id: 'b', day: '2026-09-19' }),
      makeRecord({ id: 'c', day: '2026-09-18' }),
    ]
    expect(currentStreak(records, TODAY)).toBe(3)
  })

  it('今天还没记录时从昨天起算 —— 早上打开不该显示「断签」', () => {
    const records = [
      makeRecord({ id: 'a', day: '2026-09-19' }),
      makeRecord({ id: 'b', day: '2026-09-18' }),
    ]
    expect(currentStreak(records, TODAY)).toBe(2)
  })

  it('昨天也没记录就算断了', () => {
    const records = [
      makeRecord({ id: 'a', day: '2026-09-18' }),
      makeRecord({ id: 'b', day: '2026-09-17' }),
    ]
    expect(currentStreak(records, TODAY)).toBe(0)
  })

  it('中间有缺口时只数到缺口为止', () => {
    const records = [
      makeRecord({ id: 'a', day: '2026-09-20' }),
      makeRecord({ id: 'b', day: '2026-09-19' }),
      // 09-18 缺失
      makeRecord({ id: 'c', day: '2026-09-17' }),
      makeRecord({ id: 'd', day: '2026-09-16' }),
    ]
    expect(currentStreak(records, TODAY)).toBe(2)
  })

  it('同一天多条记录只算一天', () => {
    const records = [
      makeRecord({ id: 'a', day: '2026-09-20' }),
      makeRecord({ id: 'b', day: '2026-09-20' }),
      makeRecord({ id: 'c', day: '2026-09-19' }),
    ]
    expect(currentStreak(records, TODAY)).toBe(2)
  })

  it('墓碑记录不计入连续天数', () => {
    const records = [
      makeRecord({ id: 'a', day: '2026-09-20' }),
      makeRecord({ id: 'b', day: '2026-09-19', deleted: true, deletedAt: '2026-09-19T00:00:00Z' }),
      makeRecord({ id: 'c', day: '2026-09-18' }),
    ]
    expect(currentStreak(records, TODAY)).toBe(1)
  })

  it('跨月连续', () => {
    const records = [
      makeRecord({ id: 'a', day: '2026-10-01' }),
      makeRecord({ id: 'b', day: '2026-09-30' }),
      makeRecord({ id: 'c', day: '2026-09-29' }),
    ]
    expect(currentStreak(records, '2026-10-01')).toBe(3)
  })
})

describe('longestStreak', () => {
  it('取历史最长的一段', () => {
    const records = [
      makeRecord({ id: 'a', day: '2026-09-01' }),
      makeRecord({ id: 'b', day: '2026-09-02' }),
      makeRecord({ id: 'c', day: '2026-09-03' }),
      makeRecord({ id: 'd', day: '2026-09-04' }),
      // 断开
      makeRecord({ id: 'e', day: '2026-09-10' }),
      makeRecord({ id: 'f', day: '2026-09-11' }),
    ]
    expect(longestStreak(records)).toBe(4)
  })

  it('空集合为 0，单天为 1', () => {
    expect(longestStreak([])).toBe(0)
    expect(longestStreak([makeRecord({ day: '2026-09-20' })])).toBe(1)
  })

  it('相隔一天不算连续', () => {
    const records = [
      makeRecord({ id: 'a', day: '2026-09-01' }),
      makeRecord({ id: 'b', day: '2026-09-03' }),
    ]
    expect(longestStreak(records)).toBe(1)
  })
})

describe('activeDays / countOnDay', () => {
  it('activeDays 去重并排除墓碑', () => {
    const records = [
      makeRecord({ id: 'a', day: '2026-09-20' }),
      makeRecord({ id: 'b', day: '2026-09-20' }),
      makeRecord({ id: 'c', day: '2026-09-19', deleted: true, deletedAt: '2026-09-19T00:00:00Z' }),
    ]
    const days = activeDays(records)
    expect(days.size).toBe(1)
    expect(days.has('2026-09-20')).toBe(true)
  })

  it('countOnDay 统计当天件数', () => {
    const records = [
      makeRecord({ id: 'a', day: '2026-09-20' }),
      makeRecord({ id: 'b', day: '2026-09-20' }),
      makeRecord({ id: 'c', day: '2026-09-19' }),
    ]
    expect(countOnDay(records, '2026-09-20')).toBe(2)
    expect(countOnDay(records, '2026-09-18')).toBe(0)
  })
})
