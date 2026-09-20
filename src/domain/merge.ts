/**
 * 合并语义
 *
 * 两台设备各自离线操作、之后同步，必然产生分叉。Contents API 的 409 只保护
 * **文件级**的更新丢失，它不会帮你合并两条不同的记录 —— 合并规则必须自己定。
 *
 * 规则：
 *   - **求并集**：按 id 合并，两边都有的条目做 LWW（后写覆盖先写）
 *   - **墓碑优先**：`updatedAt` 相同时，已删除的一方获胜。否则一台设备删掉的
 *     记录会被另一台设备的陈旧副本「复活」，而用户会看到删了又冒出来。
 *   - **记录永远保住快照**：即使它引用的家务已被删除，记录本身及其分值不受影响。
 *
 * 所有函数都是纯函数：不修改入参，相同输入必得相同输出。
 */

import type { Chore, FamilyDoc, Member, Meta, PointsRecord, Settings } from '@/types'

/** ISO-8601 字符串按字典序比较即等于按时间序比较 */
function cmpUpdatedAt(a: { updatedAt: string }, b: { updatedAt: string }): number {
  if (a.updatedAt === b.updatedAt) return 0
  return a.updatedAt < b.updatedAt ? -1 : 1
}

/**
 * 二选一：返回较新的那个。
 * `deleteWinsOnTie` 为 true 时，时间戳相同的情况下优先返回已删除的一方
 * （用于记录与家务，避免删除被复活）。
 */
function pickLatest<T extends { updatedAt: string }>(
  a: T,
  b: T,
  isDeleted?: (v: T) => boolean,
): T {
  const c = cmpUpdatedAt(a, b)
  if (c > 0) return a
  if (c < 0) return b
  if (isDeleted) {
    const aDel = isDeleted(a)
    const bDel = isDeleted(b)
    if (aDel !== bDel) return aDel ? a : b
  }
  return a
}

/** 通用按 id 求并集 */
function mergeById<T extends { id: string; updatedAt: string }>(
  a: readonly T[],
  b: readonly T[],
  isDeleted?: (v: T) => boolean,
): T[] {
  const map = new Map<string, T>()
  for (const item of a) map.set(item.id, item)
  for (const item of b) {
    const existing = map.get(item.id)
    map.set(item.id, existing ? pickLatest(existing, item, isDeleted) : item)
  }
  return [...map.values()]
}

const recordDeleted = (r: PointsRecord): boolean => r.deleted === true
const choreDeleted = (c: Chore): boolean => c.deleted === true

export function mergeRecords(
  a: readonly PointsRecord[],
  b: readonly PointsRecord[],
): PointsRecord[] {
  return mergeById(a, b, recordDeleted)
}

export function mergeChores(a: readonly Chore[], b: readonly Chore[]): Chore[] {
  return mergeById(a, b, choreDeleted)
}

export function mergeMembers(a: readonly Member[], b: readonly Member[]): Member[] {
  return mergeById(a, b)
}

/** 设置是单例，直接 LWW */
export function mergeSettings(a: Settings, b: Settings): Settings {
  return cmpUpdatedAt(a, b) >= 0 ? a : b
}

export function mergeMeta(a: Meta, b: Meta): Meta {
  return {
    schemaVersion: Math.max(a.schemaVersion, b.schemaVersion),
    updatedAt: a.updatedAt >= b.updatedAt ? a.updatedAt : b.updatedAt,
    members: mergeMembers(a.members, b.members),
    chores: mergeChores(a.chores, b.chores),
    settings: mergeSettings(a.settings, b.settings),
  }
}

/**
 * 合并两个完整文档。
 *
 * 记录是**只增不减**的集合（删除用墓碑表达，不真删），所以并集就是正确的合并；
 * 这正是墓碑设计换来的好处 —— 不需要处理「记录消失」的分叉。
 */
export function mergeDoc(a: FamilyDoc, b: FamilyDoc): FamilyDoc {
  return {
    meta: mergeMeta(a.meta, b.meta),
    records: mergeRecords(a.records, b.records),
  }
}

/** 过滤掉已删除的记录（读取时用） */
export function liveRecords(records: readonly PointsRecord[]): PointsRecord[] {
  return records.filter((r) => !r.deleted)
}

/** 过滤掉已删除/已隐藏的家务（选择器里用） */
export function selectableChores(chores: readonly Chore[]): Chore[] {
  return chores.filter((c) => !c.deleted && c.enabled)
}

/**
 * 墓碑回收：删除超过 `maxAgeDays` 的记录从集合中真正移除。
 *
 * 保留一段时间是必要的 —— 太早回收，一台离线很久的设备上线后仍会把删除「复活」。
 * 90 天足够覆盖任何现实的离线时长。
 */
export function collectGarbage(
  records: readonly PointsRecord[],
  now: Date,
  maxAgeDays = 90,
): PointsRecord[] {
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000
  return records.filter((r) => {
    if (!r.deleted) return true
    const at = r.deletedAt ?? r.updatedAt
    const t = Date.parse(at)
    if (!Number.isFinite(t)) return true // 时间不可解析时保守保留
    return t >= cutoff
  })
}
