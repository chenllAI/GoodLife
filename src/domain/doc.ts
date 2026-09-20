/**
 * 文档工厂
 *
 * 只负责「一份干净的空文档」—— 预置家务 + 两位成员 + 默认设置。
 *
 * 这里曾经还有一份演示数据（预填两周的家务记录，让空榜单看起来有内容）。
 * 改成只支持 GitHub 仓库存储之后就删掉了：把演示记录写进**用户自己的共享仓库**
 * 是错的，两个人会看到一堆不是他们记的账。
 */

import type { FamilyDoc } from '@/types'
import {
  SCHEMA_VERSION,
  buildDefaultMembers,
  buildDefaultSettings,
  buildPresetChores,
} from './presets'

export function createInitialDoc(): FamilyDoc {
  return {
    meta: {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      members: buildDefaultMembers(),
      chores: buildPresetChores(),
      settings: buildDefaultSettings(),
    },
    records: [],
  }
}
