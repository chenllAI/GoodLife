/**
 * 预置目录升级
 *
 * 问题：预置家务是**首次初始化时**写进数据的。之后改预置目录（删掉「大扫除」、
 * 加上「喂鱼」），已经存在的数据不会自己更新 —— 老用户必须「清空数据」才能看到
 * 新列表。而一旦家里开始真实记账，清空数据就意味着丢掉全部记录。
 *
 * 所以这里做一次自动合并：拿当前预置目录和数据里存的对比，算出需要哪些操作。
 *
 * 三条保护：
 *
 * 1. **用户改过的预置项不动。** 改名或改过分值之后 `updatedAt` 就不再是
 *    PRESET_EPOCH，这里只刷新没被动过的那些。判断依据是时间戳而不是内容对比，
 *    因为 LWW 合并用的就是它，两者必须一致。
 * 2. **下架的预置项打墓碑，不真删。** 历史记录里存的是快照，所以删掉家务不会
 *    影响已经记下的积分。
 * 3. **操作是幂等的。** 两台设备同时升级会发出内容相同的操作，合并后结果一致。
 */

import type { FamilyDoc, Op } from '@/types'
import { PRESET_EPOCH_SENTINEL, PRESET_IDS, PRESET_VERSION, buildPresetChores } from './presets'

export interface PresetSyncPlan {
  /** 需要执行的操作；为空表示已经是最新 */
  ops: Op[]
  /** 新加入的预置项名称（用于提示用户） */
  added: string[]
  /** 被下架的预置项名称 */
  removed: string[]
}

/** 判断某个家务是否还保持着出厂状态（用户没改过） */
function isUntouched(updatedAt: string): boolean {
  return updatedAt === PRESET_EPOCH_SENTINEL
}

/**
 * 算出把文档里的预置目录升到当前版本所需的操作。
 *
 * @param now 当前时间（ISO），用于墓碑与设置的时间戳
 */
export function planPresetSync(doc: FamilyDoc, now: string): PresetSyncPlan {
  const currentVersion = doc.meta.settings.presetVersion ?? 1
  if (currentVersion >= PRESET_VERSION) {
    return { ops: [], added: [], removed: [] }
  }

  const ops: Op[] = []
  const added: string[] = []
  const removed: string[] = []

  const byId = new Map(doc.meta.chores.map((c) => [c.id, c]))

  // 1. 补齐新增的预置项，并把没被动过的旧预置刷新成新定义
  for (const preset of buildPresetChores()) {
    const existing = byId.get(preset.id)
    if (!existing) {
      ops.push({ type: 'upsertChore', chore: preset })
      added.push(preset.name)
      continue
    }
    // 用户改名/改分过的保持原样；已删除的也不复活
    if (existing.deleted) continue
    if (!isUntouched(existing.updatedAt)) continue
    if (JSON.stringify(existing) === JSON.stringify(preset)) continue
    ops.push({ type: 'upsertChore', chore: preset })
  }

  // 2. 下架已经从目录里移除的预置项
  for (const chore of doc.meta.chores) {
    if (!chore.isPreset) continue
    if (chore.deleted) continue
    if (PRESET_IDS.has(chore.id)) continue
    ops.push({ type: 'deleteChore', id: chore.id, deletedAt: now })
    removed.push(chore.name)
  }

  // 3. 记录版本号，避免下次重复执行
  ops.push({
    type: 'putSettings',
    settings: {
      ...doc.meta.settings,
      presetVersion: PRESET_VERSION,
      updatedAt: now,
    },
  })

  return { ops, added, removed }
}
