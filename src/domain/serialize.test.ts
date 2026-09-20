/**
 * 规范化序列化测试
 *
 * 核心断言：**两台设备持有相同数据集时，无论内部顺序如何，产出逐字节相同的文件。**
 * 这是「无变化就跳过 PUT」能可靠工作的前提 —— 否则每次刷新都会误判为有变化，
 * 白耗限流额度、制造无意义提交、推高冲突概率。
 */

import { describe, expect, it } from 'vitest'
import {
  canonicalStringify,
  serializeMeta,
  serializeShard,
  sortChores,
  sortMembers,
  sortRecords,
} from '@/domain/serialize'
import { makeChore, makeDoc, makeRecord, ts } from '@/tests/factories'
import { SCHEMA_VERSION } from '@/domain/presets'

describe('canonicalStringify', () => {
  it('递归排序对象键', () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalStringify({ z: { y: 1, x: 2 }, a: 0 })).toBe('{"a":0,"z":{"x":2,"y":1}}')
  })

  it('保留数组顺序（数组的顺序语义由调用方负责）', () => {
    expect(canonicalStringify([3, 1, 2])).toBe('[3,1,2]')
  })

  it('跳过 undefined，保持与 JSON.stringify 一致的语义', () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it('处理嵌套数组与对象', () => {
    expect(canonicalStringify({ list: [{ b: 1, a: 2 }] })).toBe('{"list":[{"a":2,"b":1}]}')
  })
})

describe('排序helper', () => {
  it('sortRecords 按 (at, id) 升序', () => {
    const records = [
      makeRecord({ id: 'b', at: ts(2) }),
      makeRecord({ id: 'a', at: ts(2) }),
      makeRecord({ id: 'c', at: ts(1) }),
    ]
    expect(sortRecords(records).map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })

  it('sortChores 按 id 升序', () => {
    const chores = [makeChore({ id: 'c' }), makeChore({ id: 'a' }), makeChore({ id: 'b' })]
    expect(sortChores(chores).map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('sortMembers 按 seriesSlot 升序', () => {
    const members = [
      { ...makeDoc().meta.members[1]!, seriesSlot: 2 as const },
      { ...makeDoc().meta.members[0]!, seriesSlot: 1 as const },
    ]
    expect(sortMembers(members)[0]?.seriesSlot).toBe(1)
  })

  it('sortRecords 不修改原数组', () => {
    const records = [makeRecord({ id: 'b', at: ts(2) }), makeRecord({ id: 'a', at: ts(1) })]
    const before = records.map((r) => r.id)
    sortRecords(records)
    expect(records.map((r) => r.id)).toEqual(before)
  })
})

describe('字节稳定性 —— 这份测试的意义所在', () => {
  it('两台设备以不同顺序持有同一批记录，序列化结果完全相同', () => {
    const r1 = makeRecord({ id: 'r1', at: ts(1) })
    const r2 = makeRecord({ id: 'r2', at: ts(2) })
    const r3 = makeRecord({ id: 'r3', at: ts(3) })

    // 设备 A 按时间顺序写入，设备 B 完全打乱（例如合并后顺序不同）
    const deviceA = { schemaVersion: SCHEMA_VERSION, month: '2026-09', records: [r1, r2, r3] }
    const deviceB = { schemaVersion: SCHEMA_VERSION, month: '2026-09', records: [r3, r1, r2] }

    expect(serializeShard(deviceA)).toBe(serializeShard(deviceB))
  })

  it('键的书写顺序不影响结果', () => {
    const a = makeRecord({ id: 'r1' })
    // 手工构造一个键序完全不同的等价对象
    const b = {
      updatedAt: a.updatedAt,
      createdAt: a.createdAt,
      createdBy: a.createdBy,
      day: a.day,
      at: a.at,
      points: a.points,
      difficulty: a.difficulty,
      category: a.category,
      choreEmoji: a.choreEmoji,
      choreName: a.choreName,
      choreId: a.choreId,
      memberId: a.memberId,
      id: a.id,
    } as typeof a

    expect(serializeShard({ schemaVersion: 1, month: '2026-09', records: [a] })).toBe(
      serializeShard({ schemaVersion: 1, month: '2026-09', records: [b] }),
    )
  })

  it('家务列表顺序不同也不影响 meta 序列化', () => {
    const base = makeDoc().meta
    const c1 = makeChore({ id: 'c1' })
    const c2 = makeChore({ id: 'c2' })

    const a = serializeMeta({ ...base, chores: [c1, c2] })
    const b = serializeMeta({ ...base, chores: [c2, c1] })
    expect(a).toBe(b)
  })

  it('内容确实不同时序列化结果必须不同（防止上面的用例变成空转）', () => {
    const a = serializeShard({
      schemaVersion: SCHEMA_VERSION,
      month: '2026-09',
      records: [makeRecord({ id: 'r1', points: 5 })],
    })
    const b = serializeShard({
      schemaVersion: SCHEMA_VERSION,
      month: '2026-09',
      records: [makeRecord({ id: 'r1', points: 6 })],
    })
    expect(a).not.toBe(b)
  })
})
