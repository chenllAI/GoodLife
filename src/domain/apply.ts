/**
 * 纯函数 applyOps —— 两条同步路径共用的唯一合并语义
 *
 * 本地适配器和 GitHub 适配器都调用它，区别只在于前者直接落盘、后者多了一层
 * 网络重试。这个切分让合并逻辑可以脱离网络做单元测试，也保证离线重放和在线
 * 提交走的是同一套规则。
 *
 * **必须是纯函数**：不修改入参，相同输入必得相同输出，且对同一批 op 重复应用
 * 是幂等的（离线队列重试时会重复应用，不幂等就会产生重复记录）。
 */

import type { FamilyDoc, Op } from '@/types'

/** 时间戳派生：所有写入都基于这个，保证同一批 op 重复应用结果一致 */
function upsertById<T extends { id: string; updatedAt: string }>(
  list: readonly T[],
  item: T,
): T[] {
  const idx = list.findIndex((x) => x.id === item.id)
  if (idx < 0) return [...list, item]
  const existing = list[idx] as T
  // LWW：只有更新的写入才生效（幂等重放的关键）
  if (existing.updatedAt > item.updatedAt) return [...list]
  const next = [...list]
  next[idx] = item
  return next
}

/** 把一条操作应用到一个文档上，返回**新**文档 */
export function applyOp(doc: FamilyDoc, op: Op): FamilyDoc {
  switch (op.type) {
    case 'addRecord': {
      return { ...doc, records: upsertById(doc.records, op.record) }
    }

    case 'deleteRecord': {
      const idx = doc.records.findIndex((r) => r.id === op.id)
      if (idx < 0) return doc
      const existing = doc.records[idx]
      if (!existing) return doc
      // 已经删过了 —— 幂等，不重复写
      if (existing.deleted) return doc
      const next = [...doc.records]
      next[idx] = {
        ...existing,
        deleted: true,
        deletedAt: op.deletedAt,
        updatedAt: op.deletedAt,
      }
      return { ...doc, records: next }
    }

    case 'upsertChore': {
      return { ...doc, meta: { ...doc.meta, chores: upsertById(doc.meta.chores, op.chore) } }
    }

    case 'deleteChore': {
      const idx = doc.meta.chores.findIndex((c) => c.id === op.id)
      if (idx < 0) return doc
      const existing = doc.meta.chores[idx]
      if (!existing || existing.deleted) return doc
      const next = [...doc.meta.chores]
      next[idx] = {
        ...existing,
        deleted: true,
        deletedAt: op.deletedAt,
        // 预置项不硬删，标记隐藏即可，避免误删后无法恢复
        enabled: false,
        updatedAt: op.deletedAt,
      }
      return { ...doc, meta: { ...doc.meta, chores: next } }
    }

    case 'upsertMember': {
      return { ...doc, meta: { ...doc.meta, members: upsertById(doc.meta.members, op.member) } }
    }

    case 'putSettings': {
      return {
        ...doc,
        meta: {
          ...doc.meta,
          settings:
            doc.meta.settings.updatedAt > op.settings.updatedAt
              ? doc.meta.settings
              : op.settings,
        },
      }
    }
  }
}

/** 依次应用一批操作 */
export function applyOps(doc: FamilyDoc, ops: readonly Op[]): FamilyDoc {
  let cur = doc
  for (const op of ops) cur = applyOp(cur, op)
  return cur
}
