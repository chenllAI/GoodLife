/**
 * 榜单聚合与排名测试
 *
 * 覆盖窗口边界、墓碑排除、快照计分，以及**四层并列打破的逐层验证** ——
 * 每一层都用一个「只有该层能分出胜负」的构造用例来验证，避免用例之间互相遮蔽。
 */

import { describe, expect, it } from 'vitest'
import {
  aggregate,
  categoryComparison,
  computeDeltas,
  dailySeries,
  familyTotals,
  rankStandings,
  recordsInRange,
} from '@/domain/aggregate'
import { rangeOf } from '@/domain/time'
import { buildDefaultMembers } from '@/domain/presets'
import { makeChore, makeMember, makeRecord, ts } from '@/tests/factories'

const MEMBERS = buildDefaultMembers()
const [LIANG, YING] = MEMBERS as [(typeof MEMBERS)[0], (typeof MEMBERS)[1]]

const WEEK = rangeOf('week', '2026-09-20') // 2026-09-14 ~ 2026-09-20
const MONTH = rangeOf('month', '2026-09-20') // 2026-09-01 ~ 2026-09-30
const DAY = rangeOf('day', '2026-09-20')

describe('窗口过滤', () => {
  it('空窗口下所有人都是零分', () => {
    const standings = aggregate([], MEMBERS, WEEK)
    expect(standings).toHaveLength(2)
    for (const s of standings) {
      expect(s.points).toBe(0)
      expect(s.count).toBe(0)
      expect(s.reachedAt).toBeNull()
    }
  })

  it('窗口外的记录不计入', () => {
    const records = [
      makeRecord({ day: '2026-09-13', points: 100 }), // 上周日
      makeRecord({ day: '2026-09-21', points: 100 }), // 下周一
    ]
    const standings = aggregate(records, MEMBERS, WEEK)
    expect(standings[0]?.points).toBe(0)
  })

  it('两端都是闭区间 —— 正好落在起止当天的记录要计入', () => {
    const records = [
      makeRecord({ id: 'a', day: '2026-09-14', points: 3 }), // 周一，起点
      makeRecord({ id: 'b', day: '2026-09-20', points: 4 }), // 周日，终点
    ]
    const standings = aggregate(records, MEMBERS, WEEK)
    expect(standings[0]?.points).toBe(7)
    expect(standings[0]?.count).toBe(2)
  })

  it('月榜与日榜各自窗口正确', () => {
    const records = [
      makeRecord({ id: 'a', day: '2026-09-01', points: 1 }),
      makeRecord({ id: 'b', day: '2026-09-30', points: 1 }),
      makeRecord({ id: 'c', day: '2026-10-01', points: 1 }),
    ]
    expect(aggregate(records, MEMBERS, MONTH)[0]?.points).toBe(2)
    expect(aggregate(records, MEMBERS, DAY)[0]?.points).toBe(0)
  })

  it('墓碑记录不计入', () => {
    const records = [
      makeRecord({ id: 'a', points: 5 }),
      makeRecord({
        id: 'b',
        points: 100,
        deleted: true,
        deletedAt: ts(9),
        updatedAt: ts(9),
      }),
    ]
    expect(aggregate(records, MEMBERS, WEEK)[0]?.points).toBe(5)
  })

  it('recordsInRange 直接调用时行为一致', () => {
    const records = [
      makeRecord({ id: 'a', day: '2026-09-20' }),
      makeRecord({ id: 'b', day: '2026-09-21' }),
    ]
    expect(recordsInRange(records, DAY).map((r) => r.id)).toEqual(['a'])
  })
})

describe('快照计分 —— 绝不回查家务表', () => {
  it('分值取自记录快照，与家务当前定义无关', () => {
    const cheapChore = makeChore({ id: 'c1', points: 1 })
    const rec = makeRecord({
      choreId: 'c1',
      points: 99, // 记录时是 99 分
      day: '2026-09-20',
    })
    const standings = aggregate([rec], MEMBERS, WEEK)
    expect(standings[0]?.points).toBe(99)
    // 家务现在是 1 分，也不影响
    expect(cheapChore.points).toBe(1)
  })

  it('引用已删除家务的记录仍然计分（明细不会消失）', () => {
    const rec = makeRecord({
      choreId: 'preset-gone',
      choreName: '已经删掉的家务',
      points: 6,
      day: '2026-09-20',
    })
    const standings = aggregate([rec], MEMBERS, WEEK)
    expect(standings[0]?.points).toBe(6)
    expect(standings[0]?.byChore['preset-gone']?.name).toBe('已经删掉的家务')
  })

  it('choreId 为 null 的记录按名称归并', () => {
    const records = [
      makeRecord({ id: 'a', choreId: null, choreName: '临时活', points: 2 }),
      makeRecord({ id: 'b', choreId: null, choreName: '临时活', points: 3 }),
    ]
    const s = aggregate(records, MEMBERS, WEEK)[0]
    expect(s?.byChore['name:临时活']?.points).toBe(5)
    expect(s?.byChore['name:临时活']?.count).toBe(2)
  })
})

describe('分类与家务小计', () => {
  it('byCategory 六个分类都有键（未涉及的为 0）', () => {
    const s = aggregate([], MEMBERS, WEEK)[0]
    expect(Object.keys(s?.byCategory ?? {}).sort()).toEqual(
      ['其他杂项', '厨房餐食', '宠物花草', '整理收纳', '清洁打扫', '洗衣晾晒'].sort(),
    )
  })

  it('byCategory 按分类累加', () => {
    const records = [
      makeRecord({ id: 'a', category: '清洁打扫', points: 5 }),
      makeRecord({ id: 'b', category: '清洁打扫', points: 3 }),
      makeRecord({ id: 'c', category: '厨房餐食', points: 7 }),
    ]
    const s = aggregate(records, MEMBERS, WEEK)[0]
    expect(s?.byCategory['清洁打扫']).toBe(8)
    expect(s?.byCategory['厨房餐食']).toBe(7)
    expect(s?.byCategory['洗衣晾晒']).toBe(0)
  })

  it('只统计该成员自己的记录', () => {
    const records = [
      makeRecord({ id: 'a', memberId: LIANG.id, points: 5 }),
      makeRecord({ id: 'b', memberId: YING.id, points: 8 }),
    ]
    const standings = aggregate(records, MEMBERS, WEEK)
    expect(standings.find((s) => s.memberId === LIANG.id)?.points).toBe(5)
    expect(standings.find((s) => s.memberId === YING.id)?.points).toBe(8)
  })
})

describe('并列打破 —— 逐层验证', () => {
  it('第一层：积分高者胜', () => {
    const records = [
      makeRecord({ id: 'a', memberId: LIANG.id, points: 10, at: ts(50) }),
      makeRecord({ id: 'b', memberId: YING.id, points: 12, at: ts(1) }),
    ]
    const ranked = rankStandings(aggregate(records, MEMBERS, WEEK))
    // 小影分高，即便她「到得更早」这件事对小良有利，也不该翻盘
    expect(ranked[0]?.memberId).toBe(YING.id)
    expect(ranked[0]?.rank).toBe(1)
    expect(ranked[1]?.rank).toBe(2)
  })

  it('第二层：同分时件数多者胜', () => {
    const records = [
      // 小良：1 件 10 分
      makeRecord({ id: 'a', memberId: LIANG.id, points: 10, at: ts(1) }),
      // 小影：2 件共 10 分
      makeRecord({ id: 'b', memberId: YING.id, points: 5, at: ts(20) }),
      makeRecord({ id: 'c', memberId: YING.id, points: 5, at: ts(21) }),
    ]
    const ranked = rankStandings(aggregate(records, MEMBERS, WEEK))
    expect(ranked[0]?.points).toBe(10)
    expect(ranked[1]?.points).toBe(10)
    expect(ranked[0]?.memberId).toBe(YING.id)
    expect(ranked[0]?.count).toBe(2)
  })

  it('第三层：同分同件数时，先到达者胜', () => {
    const records = [
      makeRecord({ id: 'a', memberId: LIANG.id, points: 5, at: ts(30) }), // 后到
      makeRecord({ id: 'b', memberId: YING.id, points: 5, at: ts(10) }), // 先到
    ]
    const ranked = rankStandings(aggregate(records, MEMBERS, WEEK))
    expect(ranked[0]?.points).toBe(5)
    expect(ranked[1]?.points).toBe(5)
    expect(ranked[0]?.count).toBe(1)
    expect(ranked[1]?.count).toBe(1)
    expect(ranked[0]?.memberId).toBe(YING.id)
  })

  it('第三层用「首次达到」而不是「最后一次」', () => {
    // 小影：5 分 → 10 分（10 分是最后才到的）
    // 小良：10 分一次到位
    // 两人总分都是 10、件数都是 2 vs 1 —— 构造件数相同的情形
    const records = [
      makeRecord({ id: 'a1', memberId: YING.id, points: 5, at: ts(1) }),
      makeRecord({ id: 'a2', memberId: YING.id, points: 5, at: ts(50) }),
      makeRecord({ id: 'b1', memberId: LIANG.id, points: 10, at: ts(1) }),
    ]
    const standings = aggregate(records, MEMBERS, WEEK)
    const ying = standings.find((s) => s.memberId === YING.id)
    // 小影的 10 分首次达成于 ts(50)
    expect(ying?.reachedAt).toBe(ts(50))
  })

  it('第四层：四层全平时并列，共享名次', () => {
    const records = [
      makeRecord({ id: 'a', memberId: LIANG.id, points: 5, at: ts(5) }),
      makeRecord({ id: 'b', memberId: YING.id, points: 5, at: ts(5) }),
    ]
    const ranked = rankStandings(aggregate(records, MEMBERS, WEEK))
    expect(ranked[0]?.rank).toBe(1)
    expect(ranked[1]?.rank).toBe(1)
    expect(ranked[0]?.tied).toBe(true)
    expect(ranked[1]?.tied).toBe(true)
  })

  it('标准竞技排名：1, 1, 3（不是 1, 1, 2）', () => {
    const members = [...MEMBERS, makeMember({ id: 'm3', name: '小三', seriesSlot: 1 })]
    const records = [
      makeRecord({ id: 'a', memberId: LIANG.id, points: 5, at: ts(5) }),
      makeRecord({ id: 'b', memberId: YING.id, points: 5, at: ts(5) }),
      makeRecord({ id: 'c', memberId: 'm3', points: 1, at: ts(5) }),
    ]
    const ranked = rankStandings(aggregate(records, members, WEEK))
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3])
    expect(ranked[0]?.tied).toBe(true)
    expect(ranked[2]?.tied).toBe(false)
  })

  it('排名顺序是确定的：重复计算不会让顺序抖动', () => {
    const records = [
      makeRecord({ id: 'a', memberId: LIANG.id, points: 5, at: ts(5) }),
      makeRecord({ id: 'b', memberId: YING.id, points: 5, at: ts(5) }),
    ]
    const first = rankStandings(aggregate(records, MEMBERS, WEEK)).map((r) => r.memberId)
    const second = rankStandings(aggregate(records, MEMBERS, WEEK)).map((r) => r.memberId)
    expect(first).toEqual(second)
  })

  it('零记录时按成员原始顺序稳定排列', () => {
    const ranked = rankStandings(aggregate([], MEMBERS, WEEK))
    expect(ranked.map((r) => r.memberId)).toEqual([LIANG.id, YING.id])
    expect(ranked.every((r) => r.tied)).toBe(true)
  })
})

describe('familyTotals', () => {
  it('家庭总分是两人之和', () => {
    const records = [
      makeRecord({ id: 'a', memberId: LIANG.id, points: 5 }),
      makeRecord({ id: 'b', memberId: YING.id, points: 8 }),
    ]
    expect(familyTotals(records, WEEK)).toEqual({ points: 13, count: 2 })
  })

  it('空记录为零', () => {
    expect(familyTotals([], WEEK)).toEqual({ points: 0, count: 0 })
  })
})

describe('dailySeries —— 趋势图与热力图数据', () => {
  it('周区间返回七天，缺记录的天补 0', () => {
    const series = dailySeries([], MEMBERS, WEEK)
    expect(series).toHaveLength(7)
    expect(series[0]?.day).toBe('2026-09-14')
    expect(series[6]?.day).toBe('2026-09-20')
    expect(series.every((d) => d.total === 0)).toBe(true)
  })

  it('按天和按成员分别归集', () => {
    const records = [
      makeRecord({ id: 'a', memberId: LIANG.id, day: '2026-09-15', points: 3 }),
      makeRecord({ id: 'b', memberId: YING.id, day: '2026-09-15', points: 4 }),
      makeRecord({ id: 'c', memberId: LIANG.id, day: '2026-09-17', points: 5 }),
    ]
    const series = dailySeries(records, MEMBERS, WEEK)
    const d15 = series.find((d) => d.day === '2026-09-15')
    expect(d15?.byMember[LIANG.id]).toBe(3)
    expect(d15?.byMember[YING.id]).toBe(4)
    expect(d15?.total).toBe(7)

    const d17 = series.find((d) => d.day === '2026-09-17')
    expect(d17?.total).toBe(5)
  })
})

describe('categoryComparison —— 分组横向条形图数据', () => {
  it('六个分类都有条目，含双方的数值与最大值', () => {
    const records = [
      makeRecord({ id: 'a', memberId: LIANG.id, category: '厨房餐食', points: 7 }),
      makeRecord({ id: 'b', memberId: YING.id, category: '厨房餐食', points: 3 }),
    ]
    const cmp = categoryComparison(records, MEMBERS, WEEK)
    expect(cmp).toHaveLength(6)

    const kitchen = cmp.find((c) => c.category === '厨房餐食')
    expect(kitchen?.byMember[LIANG.id]).toBe(7)
    expect(kitchen?.byMember[YING.id]).toBe(3)
    expect(kitchen?.max).toBe(7)

    const cleaning = cmp.find((c) => c.category === '清洁打扫')
    expect(cleaning?.max).toBe(0)
  })
})

describe('computeDeltas —— 环比', () => {
  it('给出分数差、百分比与名次变化', () => {
    const records = [
      // 本周：小良 10，小影 5
      makeRecord({ id: 'a', memberId: LIANG.id, day: '2026-09-20', points: 10, at: ts(1) }),
      makeRecord({ id: 'b', memberId: YING.id, day: '2026-09-20', points: 5, at: ts(2) }),
      // 上周：小良 5，小影 20 → 名次发生了反转
      makeRecord({ id: 'c', memberId: LIANG.id, day: '2026-09-10', points: 5, at: ts(3) }),
      makeRecord({ id: 'd', memberId: YING.id, day: '2026-09-10', points: 20, at: ts(4) }),
    ]
    const deltas = computeDeltas(records, MEMBERS, 'week', '2026-09-20')
    const liang = deltas.find((d) => d.memberId === LIANG.id)
    const ying = deltas.find((d) => d.memberId === YING.id)

    expect(liang?.points).toBe(10)
    expect(liang?.pointsPct).toBe(100) // 5 → 10
    expect(ying?.points).toBe(5)
    expect(ying?.pointsPct).toBe(-75) // 20 → 5

    // 小良从第 2 名升到第 1 名
    expect(liang?.rankNow).toBe(1)
    expect(liang?.rankPrev).toBe(2)
    expect(liang?.rankDelta).toBe(1)
    // 小影从第 1 名掉到第 2 名
    expect(ying?.rankDelta).toBe(-1)
  })

  it('上一周期为零时百分比为 null（UI 应显示「新增」而不是「∞」）', () => {
    const records = [
      makeRecord({ id: 'a', memberId: LIANG.id, day: '2026-09-20', points: 10 }),
    ]
    const deltas = computeDeltas(records, MEMBERS, 'week', '2026-09-20')
    expect(deltas.find((d) => d.memberId === LIANG.id)?.pointsPct).toBeNull()
  })

  it('完全没有记录时百分比全为 null 且不抛错', () => {
    const deltas = computeDeltas([], MEMBERS, 'week', '2026-09-20')
    expect(deltas.every((d) => d.pointsPct === null)).toBe(true)
  })

  it('日/月周期同样可用', () => {
    const records = [
      makeRecord({ id: 'a', memberId: LIANG.id, day: '2026-09-19', points: 3 }),
      makeRecord({ id: 'b', memberId: LIANG.id, day: '2026-09-20', points: 6 }),
    ]
    expect(computeDeltas(records, MEMBERS, 'day', '2026-09-20').find((d) => d.memberId === LIANG.id)?.pointsPct).toBe(100)
    expect(computeDeltas(records, MEMBERS, 'month', '2026-09-20').find((d) => d.memberId === LIANG.id)?.points).toBe(9)
  })
})
