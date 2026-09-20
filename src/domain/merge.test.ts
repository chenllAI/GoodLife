/**
 * 合并语义测试
 *
 * 这些用例覆盖两台设备离线各写各的、之后同步时的分叉场景。其中最关键的一条是
 * 「墓碑胜过更旧的活记录」—— 没有它，用户在 A 手机上删掉的记录会被 B 手机的
 * 陈旧副本复活。
 */

import { describe, expect, it } from 'vitest'
import {
  collectGarbage,
  liveRecords,
  mergeChores,
  mergeDoc,
  mergeMembers,
  mergeRecords,
  mergeSettings,
  selectableChores,
} from '@/domain/merge'
import { makeChore, makeDoc, makeRecord, ts } from '@/tests/factories'
import { buildDefaultSettings } from '@/domain/presets'

describe('mergeRecords —— 按 id 求并集', () => {
  it('两台设备各自的记录都保留', () => {
    const a = [makeRecord({ id: 'r1', at: ts(1) })]
    const b = [makeRecord({ id: 'r2', at: ts(2) })]
    const merged = mergeRecords(a, b)
    expect(merged.map((r) => r.id).sort()).toEqual(['r1', 'r2'])
  })

  it('同一条记录两边都有时按 updatedAt 做 LWW', () => {
    const older = makeRecord({ id: 'r1', points: 5, updatedAt: ts(1) })
    const newer = makeRecord({ id: 'r1', points: 99, updatedAt: ts(2) })
    expect(mergeRecords([older], [newer])[0]?.points).toBe(99)
    // 顺序反过来结果一致 —— 合并是可交换的
    expect(mergeRecords([newer], [older])[0]?.points).toBe(99)
  })

  it('空集与自身合并都不改变内容', () => {
    const a = [makeRecord({ id: 'r1' }), makeRecord({ id: 'r2' })]
    expect(mergeRecords(a, [])).toHaveLength(2)
    expect(mergeRecords(a, a)).toHaveLength(2)
  })
})

describe('mergeRecords —— 墓碑语义', () => {
  it('墓碑胜过更旧的活记录（删除不会被复活）', () => {
    const alive = makeRecord({ id: 'r1', updatedAt: ts(1) })
    const tomb = makeRecord({ id: 'r1', deleted: true, deletedAt: ts(5), updatedAt: ts(5) })

    expect(mergeRecords([alive], [tomb])[0]?.deleted).toBe(true)
    // 关键：反过来的顺序也必须保持删除状态
    expect(mergeRecords([tomb], [alive])[0]?.deleted).toBe(true)
  })

  it('时间戳相同时，删除方获胜', () => {
    const alive = makeRecord({ id: 'r1', updatedAt: ts(3) })
    const tomb = makeRecord({
      id: 'r1',
      deleted: true,
      deletedAt: ts(3),
      updatedAt: ts(3),
    })
    expect(mergeRecords([alive], [tomb])[0]?.deleted).toBe(true)
    expect(mergeRecords([tomb], [alive])[0]?.deleted).toBe(true)
  })

  it('对方从没见过的墓碑也会被保留（否则后续同步会复活）', () => {
    const tomb = makeRecord({ id: 'r9', deleted: true, deletedAt: ts(5), updatedAt: ts(5) })
    const merged = mergeRecords([], [tomb])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.deleted).toBe(true)
  })

  it('liveRecords 过滤掉墓碑', () => {
    const records = [
      makeRecord({ id: 'r1' }),
      makeRecord({ id: 'r2', deleted: true, deletedAt: ts(5), updatedAt: ts(5) }),
    ]
    expect(liveRecords(records).map((r) => r.id)).toEqual(['r1'])
  })
})

describe('mergeRecords —— 快照不因家务变动而受影响', () => {
  it('引用了已删除家务的记录，其名称与分值原样保留', () => {
    const rec = makeRecord({
      id: 'r1',
      choreId: 'preset-mop-floor',
      choreName: '拖地',
      points: 5,
    })
    const choreDeleted = makeChore({
      id: 'preset-mop-floor',
      deleted: true,
      deletedAt: ts(9),
      updatedAt: ts(9),
    })

    const doc = mergeDoc(makeDoc({ records: [rec] }), makeDoc({ meta: { ...makeDoc().meta, chores: [choreDeleted] } }))
    const out = doc.records[0]
    expect(out?.choreName).toBe('拖地')
    expect(out?.points).toBe(5)
  })
})

describe('mergeChores', () => {
  it('按 id 求并集并做 LWW', () => {
    const a = [makeChore({ id: 'c1', points: 3, updatedAt: ts(1) })]
    const b = [
      makeChore({ id: 'c1', points: 8, updatedAt: ts(4) }),
      makeChore({ id: 'c2', updatedAt: ts(4) }),
    ]
    const merged = mergeChores(a, b)
    expect(merged).toHaveLength(2)
    expect(merged.find((c) => c.id === 'c1')?.points).toBe(8)
  })

  it('selectableChores 排除隐藏与已删除的', () => {
    const chores = [
      makeChore({ id: 'c1', enabled: true }),
      makeChore({ id: 'c2', enabled: false }),
      makeChore({ id: 'c3', deleted: true, deletedAt: ts(9), updatedAt: ts(9), enabled: true }),
    ]
    expect(selectableChores(chores).map((c) => c.id)).toEqual(['c1'])
  })
})

describe('mergeMembers / mergeSettings', () => {
  it('成员按 id 合并', () => {
    const a = makeDoc().meta.members
    const merged = mergeMembers(a, [])
    expect(merged).toHaveLength(2)
  })

  it('设置按 updatedAt 取新', () => {
    const older = { ...buildDefaultSettings(), appTitle: '旧', updatedAt: ts(1) }
    const newer = { ...buildDefaultSettings(), appTitle: '新', updatedAt: ts(2) }
    expect(mergeSettings(older, newer).appTitle).toBe('新')
    expect(mergeSettings(newer, older).appTitle).toBe('新')
  })
})

describe('mergeDoc', () => {
  it('两个文档合并后记录与元数据都取并集', () => {
    const a = makeDoc({ records: [makeRecord({ id: 'r1' })] })
    const b = makeDoc({ records: [makeRecord({ id: 'r2' })] })
    const merged = mergeDoc(a, b)
    expect(merged.records).toHaveLength(2)
    expect(merged.meta.members).toHaveLength(2)
  })

  it('合并是幂等的：同一份文档合并两次结果不变', () => {
    const a = makeDoc({ records: [makeRecord({ id: 'r1' })] })
    const once = mergeDoc(a, a)
    const twice = mergeDoc(once, a)
    expect(twice.records).toHaveLength(once.records.length)
  })
})

describe('collectGarbage —— 墓碑回收', () => {
  it('超过保留期的墓碑被移除', () => {
    const now = new Date('2026-09-20T00:00:00Z')
    const old = makeRecord({
      id: 'r-old',
      deleted: true,
      deletedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const recent = makeRecord({
      id: 'r-new',
      deleted: true,
      deletedAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })
    const alive = makeRecord({ id: 'r-alive' })

    const kept = collectGarbage([old, recent, alive], now, 90).map((r) => r.id)
    expect(kept).toContain('r-new')
    expect(kept).toContain('r-alive')
    expect(kept).not.toContain('r-old')
  })

  it('活记录无论多旧都不会被回收', () => {
    const now = new Date('2030-01-01T00:00:00Z')
    const ancient = makeRecord({ id: 'r1', at: '2020-01-01T00:00:00.000Z' })
    expect(collectGarbage([ancient], now, 90)).toHaveLength(1)
  })
})
