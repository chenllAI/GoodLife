/**
 * 预置目录升级测试
 *
 * 这套逻辑的价值在于：改了预置项之后，已经存在的**真实记录不会因为要看到新列表
 * 而被清空**。所以这里逐条验证它不会误伤用户数据 —— 改过的预设不被覆盖、
 * 删过的预设不复活、历史积分不受影响。
 */

import { describe, expect, it } from 'vitest'
import { planPresetSync } from '@/domain/presetSync'
import { PRESET_EPOCH_SENTINEL, PRESET_IDS, PRESET_VERSION, buildPresetChores } from '@/domain/presets'
import { applyOps } from '@/domain/apply'
import type { Chore, FamilyDoc, PointsRecord } from '@/types'
import { makeChore, makeDoc, makeRecord, ts } from '@/tests/factories'

const NOW = '2026-09-20T10:00:00.000Z'

/** 已被下架的预置项（这些 id 曾经存在，现在不在目录里了） */
const RETIRED = ['preset-vacuum', 'preset-deep-clean', 'preset-walk-dog', 'preset-tutor-homework']

function metaWith(chores: Chore[], presetVersion?: number): FamilyDoc {
  const base = makeDoc()
  return {
    meta: {
      ...base.meta,
      chores,
      settings: {
        ...base.meta.settings,
        ...(presetVersion === undefined ? {} : { presetVersion }),
      },
    },
    records: [],
  }
}

/** 模拟一份「旧版本」数据：包含仍然有效的预置、已下架的预置、以及用户的改动 */
function legacyDoc(records: PointsRecord[] = []): FamilyDoc {
  const untouched = buildPresetChores().slice(0, 5)
  const chores: Chore[] = [
    ...untouched,
    // 用户改过名和分值的预置项 —— 升级时必须原样保留
    { ...(buildPresetChores().find((c) => c.id === 'preset-mop-floor') as Chore),
      name: '拖地（客厅+厨房）', points: 8, updatedAt: ts(100) },
    // 用户自己删掉的预置项 —— 不能复活
    { ...(buildPresetChores().find((c) => c.id === 'preset-wash-dishes') as Chore),
      deleted: true, deletedAt: ts(50), enabled: false, updatedAt: ts(50) },
    // 下架的预置项
    ...RETIRED.map((id) => makeChore({
      id, name: `已下架-${id}`, isPreset: true, updatedAt: PRESET_EPOCH_SENTINEL,
    })),
    // 用户自建的家务 —— 升级不应碰它
    makeChore({ id: 'custom-1', name: '擦黑板', isPreset: false, updatedAt: ts(80) }),
  ]
  const doc = metaWith(chores, 1)
  return { meta: doc.meta, records }
}

describe('planPresetSync —— 版本判断', () => {
  it('版本已是最新时不产生任何操作', () => {
    const doc = metaWith(buildPresetChores(), PRESET_VERSION)
    const plan = planPresetSync(doc, NOW)
    expect(plan.ops).toEqual([])
  })

  it('缺少版本号（老数据）时触发升级', () => {
    const plan = planPresetSync(legacyDoc(), NOW)
    expect(plan.ops.length).toBeGreaterThan(0)
  })

  it('版本落后时触发升级', () => {
    const plan = planPresetSync(metaWith(buildPresetChores(), 1), NOW)
    expect(plan.ops.length).toBeGreaterThan(0)
  })
})

describe('planPresetSync —— 新增', () => {
  it('目录里新增的预置项会被补进数据', () => {
    const plan = planPresetSync(legacyDoc(), NOW)
    const upserted = plan.ops
      .filter((o) => o.type === 'upsertChore')
      .map((o) => (o as { chore: Chore }).chore)
    const ids = upserted.map((c) => c.id)

    // 旧的 5 项里，只有目录中真实存在的才会被补齐
    for (const id of ids) expect(PRESET_IDS.has(id)).toBe(true)
    expect(plan.added.length).toBeGreaterThan(0)
  })

  it('全新数据（已有全部预置）不会重复添加', () => {
    const plan = planPresetSync(metaWith(buildPresetChores(), 1), NOW)
    expect(plan.added).toEqual([])
  })
})

describe('planPresetSync —— 下架', () => {
  it('已下架的预置项被移出目录', () => {
    const plan = planPresetSync(legacyDoc(), NOW)
    const deleted = plan.ops
      .filter((o) => o.type === 'deleteChore')
      .map((o) => (o as { id: string }).id)

    for (const id of RETIRED) expect(deleted).toContain(id)
    expect(plan.removed.length).toBe(RETIRED.length)
  })

  it('用户自建的家务不会被误删', () => {
    const plan = planPresetSync(legacyDoc(), NOW)
    const deleted = plan.ops
      .filter((o) => o.type === 'deleteChore')
      .map((o) => (o as { id: string }).id)
    expect(deleted).not.toContain('custom-1')
  })

  it('用户已经删过的预置项不会重复删', () => {
    const plan = planPresetSync(legacyDoc(), NOW)
    // preset-wash-dishes 在旧数据里已经是墓碑
    const deleted = plan.ops
      .filter((o) => o.type === 'deleteChore')
      .map((o) => (o as { id: string }).id)
    expect(deleted).not.toContain('preset-wash-dishes')
  })
})

describe('planPresetSync —— 保护用户改动', () => {
  it('用户改过名和分值的预置项不会被覆盖', () => {
    const plan = planPresetSync(legacyDoc(), NOW)
    const upserted = plan.ops
      .filter((o) => o.type === 'upsertChore')
      .map((o) => (o as { chore: Chore }).chore.id)
    expect(upserted).not.toContain('preset-mop-floor')
  })

  it('用户删掉的预置项不会复活', () => {
    const plan = planPresetSync(legacyDoc(), NOW)
    const upserted = plan.ops
      .filter((o) => o.type === 'upsertChore')
      .map((o) => (o as { chore: Chore }).chore.id)
    expect(upserted).not.toContain('preset-wash-dishes')
  })

  it('用户没动过、但定义变了的预置项会被刷新成新定义', () => {
    // 造一个「还是出厂时间戳、但分值是被改过的旧定义」
    const stale: Chore = {
      ...(buildPresetChores().find((c) => c.id === 'preset-mop-floor') as Chore),
      points: 1, // 旧定义里是 1 分，新目录里是 5 分
      updatedAt: PRESET_EPOCH_SENTINEL,
    }
    const plan = planPresetSync(metaWith([stale], 1), NOW)
    const refreshed = plan.ops
      .filter((o) => o.type === 'upsertChore')
      .map((o) => (o as { chore: Chore }).chore)
      .find((c) => c.id === 'preset-mop-floor')
    expect(refreshed?.points).toBe(5)
  })
})

describe('planPresetSync —— 应用后的结果', () => {
  it('升级后目录里只剩当前的预置项加用户自建项', () => {
    const doc = legacyDoc()
    const plan = planPresetSync(doc, NOW)
    const after = applyOps(doc, plan.ops)

    const live = after.meta.chores.filter((c) => !c.deleted)
    const liveIds = live.map((c) => c.id)

    // 用户自建项还在
    expect(liveIds).toContain('custom-1')
    // 下架的预置项都不在
    for (const id of RETIRED) expect(liveIds).not.toContain(id)
    // 其余每一项要么是当前预置，要么是用户自建
    for (const id of liveIds) {
      expect(PRESET_IDS.has(id) || id === 'custom-1').toBe(true)
    }
  })

  it('版本号被写回，第二次运行不再产生操作', () => {
    const doc = legacyDoc()
    const plan = planPresetSync(doc, NOW)
    const after = applyOps(doc, plan.ops)

    expect(after.meta.settings.presetVersion).toBe(PRESET_VERSION)

    const second = planPresetSync(after, NOW)
    expect(second.ops).toEqual([])
  })

  it('幂等：同一批操作应用两次结果一致', () => {
    const doc = legacyDoc()
    const plan = planPresetSync(doc, NOW)
    const once = applyOps(doc, plan.ops)
    const twice = applyOps(once, plan.ops)

    expect(twice.meta.chores.length).toBe(once.meta.chores.length)
    expect(twice.meta.settings.presetVersion).toBe(once.meta.settings.presetVersion)
  })

  it('不修改传入的文档', () => {
    const doc = legacyDoc()
    const snapshot = JSON.stringify(doc)
    planPresetSync(doc, NOW)
    expect(JSON.stringify(doc)).toBe(snapshot)
  })
})

describe('planPresetSync —— 历史记录不受影响', () => {
  it('引用了下架家务的记录，升级后名称与分值原样保留', () => {
    const rec = makeRecord({
      id: 'r1',
      choreId: 'preset-deep-clean', // 已被下架
      choreName: '大扫除',
      points: 10,
      day: '2026-09-15',
    })
    const doc = legacyDoc([rec])

    const plan = planPresetSync(doc, NOW)
    const after = applyOps(doc, plan.ops)

    const kept = after.records.find((r) => r.id === 'r1')
    expect(kept).toBeDefined()
    expect(kept?.choreName).toBe('大扫除')
    expect(kept?.points).toBe(10)
    expect(kept?.deleted).toBeUndefined()
  })

  it('升级不会动记录数组', () => {
    const recs = [
      makeRecord({ id: 'r1', day: '2026-09-15' }),
      makeRecord({ id: 'r2', day: '2026-09-16' }),
    ]
    const doc = legacyDoc(recs)
    const after = applyOps(doc, planPresetSync(doc, NOW).ops)
    expect(after.records.map((r) => r.id).sort()).toEqual(['r1', 'r2'])
  })
})
