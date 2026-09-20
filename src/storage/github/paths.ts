/**
 * 数据仓库的路径约定
 *
 * 数据目录结构：
 *   data/meta.json                          —— 成员、家务、设置
 *   data/records/records-2026-09.json       —— 按月分片的积分明细
 *
 * 为什么要按月分片（三条理由，按重要性排序）：
 *   1. Contents API 单文件上限 1MB。不分片约 4000 条记录（≈1 年）就会撞墙，
 *      而且失败方式不显眼。
 *   2. 家务/成员改动落在 meta.json，记账落在月度分片 —— 不同文件天然降低冲突率。
 *   3. 读取时可以只取需要的月份，节省限流额度。
 */

import type { MonthKey } from '@/types'

const SHARD_PREFIX = 'records-'
const SHARD_SUFFIX = '.json'

export function normalizeBasePath(basePath: string): string {
  return basePath.replace(/^\/+|\/+$/g, '') || 'data'
}

export function metaPath(basePath: string): string {
  return `${normalizeBasePath(basePath)}/meta.json`
}

export function recordsDir(basePath: string): string {
  return `${normalizeBasePath(basePath)}/records`
}

export function shardPath(basePath: string, month: MonthKey): string {
  return `${recordsDir(basePath)}/${SHARD_PREFIX}${month}${SHARD_SUFFIX}`
}

/** 'records-2026-09.json' → '2026-09'；不认识的文件名返回 null */
export function monthFromShardName(name: string): MonthKey | null {
  if (!name.startsWith(SHARD_PREFIX) || !name.endsWith(SHARD_SUFFIX)) return null
  const month = name.slice(SHARD_PREFIX.length, name.length - SHARD_SUFFIX.length)
  return /^\d{4}-\d{2}$/.test(month) ? month : null
}
