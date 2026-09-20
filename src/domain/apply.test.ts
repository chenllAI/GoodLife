/**
 * 操作流应用测试
 *
 * applyOps 是两条同步路径共用的唯一合并语义，所以它必须**纯粹且幂等**：
 *   - 纯粹：不修改入参，相同输入必得相同输出
 *   - 幂等：同一批 op 重复应用结果不变（离线队列重试时会重复应用）
 */

import { describe, expect, it } from 'vitest'
import { applyOp, applyOps } from '@/domain/apply'
import type { Op } from '@/types'
import { makeChore, makeDoc, makeRecord, ts } from '@/tests/factories'

describe('applyOps —— addRecord', () => {
  it('新增一条记录', () => {
    const doc = makeDoc()
    const rec = makeRecord({ id: 'r1' })
    const out = applyOp(doc, { type: 'addRecord', record: rec })
    expect(out.records).toHaveLength(1)
    expect(out.records[0]?.id).toBe('r1')
  })

  it('幂等：同一条 op 应用两次仍只有一条记录', () => {
    const doc = makeDoc()
    const op: Op = { type: 'addRecord', record: makeRecord({ id: 'r1' }) }
    const twice = applyOps(doc, [op, op])
    expect(twice.records).toHaveLength(1)
  })

  it('同 id 但更新的写入会覆盖', () => {
    const doc = makeDoc()
    const first = applyOp(doc, {
      type: 'addRecord',
      record: makeRecord({ id: 'r1', points: 5, updatedAt: ts(1) }),
    })
    const second = applyOp(first, {
      type: 'addRecord',
      record: makeRecord({ id: 'r1', points: 9, updatedAt: ts(2) }),
    })
    expect(second.records[0]?.points).toBe(9)
  })

  it('同 id 但更旧的写入被忽略（乱序重放不会倒退）', () => {
    const doc = applyOp(makeDoc(), {
      type: 'addRecord',
      record: makeRecord({ id: 'r1', points: 9, updatedAt: ts(5) }),
    })
    const out = applyOp(doc, {
      type: 'addRecord',
      record: makeRecord({ id: 'r1', points: 1, updatedAt: ts(1) }),
    })
    expect(out.records[0]?.points).toBe(9)
  })
})

describe('applyOps —— deleteRecord', () => {
  it('标记墓碑而不是真删', () => {
    const doc = applyOp(makeDoc(), {
      type: 'addRecord',
      record: makeRecord({ id: 'r1' }),
    })
    const out = applyOp(doc, { type: 'deleteRecord', id: 'r1', deletedAt: ts(10) })
    expect(out.records).toHaveLength(1)
    expect(out.records[0]?.deleted).toBe(true)
    expect(out.records[0]?.deletedAt).toBe(ts(10))
  })

  it('幂等：删两次结果一致', () => {
    const doc = applyOp(makeDoc(), {
      type: 'addRecord',
      record: makeRecord({ id: 'r1' }),
    })
    const once = applyOp(doc, { type: 'deleteRecord', id: 'r1', deletedAt: ts(10) })
    const twice = applyOp(once, { type: 'deleteRecord', id: 'r1', deletedAt: ts(99) })
    // 第二次不应改写时间戳
    expect(twice.records[0]?.deletedAt).toBe(ts(10))
  })

  it('删除不存在的 id 是无操作，不抛错', () => {
    const doc = makeDoc()
    expect(() =>
      applyOp(doc, { type: 'deleteRecord', id: 'nope', deletedAt: ts(1) }),
    ).not.toThrow()
  })
})

describe('applyOps —— 家务操作', () => {
  it('upsertChore 新增与更新', () => {
    const doc = makeDoc()
    const added = applyOp(doc, { type: 'upsertChore', chore: makeChore({ id: 'c1' }) })
    expect(added.meta.chores).toHaveLength(1)

    const updated = applyOp(added, {
      type: 'upsertChore',
      chore: makeChore({ id: 'c1', points: 42, updatedAt: ts(9) }),
    })
    expect(updated.meta.chores[0]?.points).toBe(42)
  })

  it('deleteChore 同时置 deleted 与 enabled:false（预置项不硬删）', () => {
    const doc = applyOp(makeDoc(), {
      type: 'upsertChore',
      chore: makeChore({ id: 'preset-mop-floor', isPreset: true, enabled: true }),
    })
    const out = applyOp(doc, { type: 'deleteChore', id: 'preset-mop-floor', deletedAt: ts(10) })
    expect(out.meta.chores).toHaveLength(1)
    expect(out.meta.chores[0]?.deleted).toBe(true)
    expect(out.meta.chores[0]?.enabled).toBe(false)
  })
})

describe('applyOps —— 成员与设置', () => {
  it('upsertMember 更新成员名', () => {
    const doc = makeDoc()
    const member = { ...(doc.meta.members[0]!), name: '小良良', updatedAt: ts(9) }
    const out = applyOp(doc, { type: 'upsertMember', member })
    expect(out.meta.members.find((m) => m.id === member.id)?.name).toBe('小良良')
  })

  it('putSettings 遵循 LWW', () => {
    const doc = makeDoc()
    const newer = {
      ...doc.meta.settings,
      appTitle: '新标题',
      updatedAt: ts(99),
    }
    const out = applyOp(doc, { type: 'putSettings', settings: newer })
    expect(out.meta.settings.appTitle).toBe('新标题')

    const stale = { ...doc.meta.settings, appTitle: '旧标题', updatedAt: ts(0) }
    const out2 = applyOp(out, { type: 'putSettings', settings: stale })
    expect(out2.meta.settings.appTitle).toBe('新标题')
  })
})

describe('applyOps —— 纯函数保证', () => {
  it('不修改传入的文档', () => {
    const doc = makeDoc({ records: [makeRecord({ id: 'r1' })] })
    const snapshot = JSON.stringify(doc)
    applyOps(doc, [
      { type: 'addRecord', record: makeRecord({ id: 'r2' }) },
      { type: 'deleteRecord', id: 'r1', deletedAt: ts(9) },
    ])
    expect(JSON.stringify(doc)).toBe(snapshot)
  })

  it('不修改传入的 op 对象', () => {
    const doc = makeDoc()
    const op: Op = { type: 'addRecord', record: makeRecord({ id: 'r1' }) }
    const snapshot = JSON.stringify(op)
    applyOp(doc, op)
    expect(JSON.stringify(op)).toBe(snapshot)
  })

  it('相同输入必得相同输出（确定性）', () => {
    const doc = makeDoc()
    const ops: Op[] = [
      { type: 'addRecord', record: makeRecord({ id: 'r1', at: ts(1) }) },
      { type: 'addRecord', record: makeRecord({ id: 'r2', at: ts(2) }) },
    ]
    expect(JSON.stringify(applyOps(doc, ops))).toBe(JSON.stringify(applyOps(doc, ops)))
  })
})
