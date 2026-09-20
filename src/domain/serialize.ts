/**
 * 规范化序列化
 *
 * 目标：**两台设备持有相同数据集时，产出逐字节相同的文件。**
 *
 * 这不是洁癖，而是「无变化就跳过 PUT」能可靠工作的前提 —— 否则每次刷新都会因为
 * 键序或数组顺序不同而认为「有变化」，白白消耗限流额度、制造无意义的提交，
 * 还会让 409 冲突变得频繁。
 *
 * 三条规范化：对象键递归排序、数组按稳定键排序、数字/布尔保持原样。
 */

import type { Chore, Member, Meta, PointsRecord, Shard } from '@/types'

/**
 * 递归按键名排序后序列化。
 * 数组顺序**原样保留** —— 数组的顺序语义应由调用方显式排序（见下方各 sort*）。
 */
export function canonicalStringify(value: unknown, indent = 0): string {
  return JSON.stringify(sortKeysDeep(value), null, indent)
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(src).sort()) {
      const v = src[key]
      if (v === undefined) continue // undefined 不参与序列化，保持与 JSON.stringify 一致
      out[key] = sortKeysDeep(v)
    }
    return out
  }
  return value
}

/** 记录按 (at, id) 升序 —— at 保证时间序，id 打破同一毫秒的并列 */
export function sortRecords(records: PointsRecord[]): PointsRecord[] {
  return [...records].sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** 家务按 id 升序 */
export function sortChores(chores: Chore[]): Chore[] {
  return [...chores].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 成员按 seriesSlot 升序（保证渲染顺序稳定），同槽位按 id */
export function sortMembers(members: Member[]): Member[] {
  return [...members].sort((a, b) => {
    if (a.seriesSlot !== b.seriesSlot) return a.seriesSlot - b.seriesSlot
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** 规范化的 meta（不含 updatedAt 之外的时间语义，只保证字节稳定） */
export function canonicalMeta(meta: Meta): Meta {
  return {
    schemaVersion: meta.schemaVersion,
    updatedAt: meta.updatedAt,
    members: sortMembers(meta.members),
    chores: sortChores(meta.chores),
    settings: meta.settings,
  }
}

export function serializeMeta(meta: Meta): string {
  return canonicalStringify(canonicalMeta(meta), 2)
}

export function serializeShard(shard: Shard): string {
  return canonicalStringify(
    {
      schemaVersion: shard.schemaVersion,
      month: shard.month,
      records: sortRecords(shard.records),
    },
    2,
  )
}

/** 判断两份内容是否等价（用于「无变化则跳过写入」） */
export function isSameContent(a: string, b: string): boolean {
  return a === b
}
