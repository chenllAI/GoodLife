/**
 * 测试数据工厂
 *
 * 让每个用例只声明它真正关心的字段，其余走默认值 —— 这样测试的意图是显式的，
 * 改动数据模型时也不会一次性弄坏所有用例。
 */

import type {
  Chore,
  ChoreCategory,
  Difficulty,
  FamilyDoc,
  Member,
  Meta,
  PointsRecord,
} from '@/types'
import { SCHEMA_VERSION, buildDefaultMembers, buildDefaultSettings } from '@/domain/presets'

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${String(seq).padStart(4, '0')}`
}

/** 测试用的确定性时间戳，避免依赖真实时钟 */
export function ts(n: number): string {
  // 以 2026-09-01T00:00:00Z 为基准往后推 n 分钟
  const base = Date.UTC(2026, 8, 1, 0, 0, 0)
  return new Date(base + n * 60_000).toISOString()
}

export function makeRecord(partial: Partial<PointsRecord> = {}): PointsRecord {
  const id = partial.id ?? nextId('rec')
  const at = partial.at ?? ts(0)
  return {
    id,
    memberId: 'member-xiaoliang',
    choreId: 'preset-mop-floor',
    choreName: '拖地',
    choreEmoji: '🧽',
    category: '清洁打扫' as ChoreCategory,
    difficulty: 3 as Difficulty,
    points: 5,
    at,
    day: '2026-09-20',
    createdBy: 'device-a',
    createdAt: at,
    updatedAt: at,
    ...partial,
  }
}

export function makeChore(partial: Partial<Chore> = {}): Chore {
  const id = partial.id ?? nextId('chore')
  const at = partial.updatedAt ?? ts(0)
  return {
    id,
    name: '测试家务',
    emoji: '🧪',
    points: 3,
    difficulty: 2 as Difficulty,
    category: '其他杂项' as ChoreCategory,
    isPreset: false,
    enabled: true,
    createdAt: at,
    updatedAt: at,
    ...partial,
  }
}

export function makeMember(partial: Partial<Member> = {}): Member {
  const at = partial.updatedAt ?? ts(0)
  return {
    id: partial.id ?? nextId('member'),
    name: '测试成员',
    avatarEmoji: '🙂',
    seriesSlot: 1,
    createdAt: at,
    updatedAt: at,
    ...partial,
  }
}

export function makeDoc(partial: Partial<FamilyDoc> = {}): FamilyDoc {
  const meta: Meta = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: ts(0),
    members: buildDefaultMembers(),
    chores: [],
    settings: buildDefaultSettings(),
    ...partial.meta,
  }
  return { meta, records: partial.records ?? [] }
}
