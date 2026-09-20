/**
 * 预置家务目录（44 项）
 *
 * 分值按难度分档，保持严格一致：
 *   D1 很轻松 1–2 分 · D2 轻松 3 分 · D3 一般 4–5 分 · D4 有点累 6–7 分 · D5 很费力 8–10 分
 *
 * 每项都有稳定的英文 slug 作为 id（而不是数组下标）—— 这样以后重排顺序或增删条目，
 * 已存在的记录不会因为 id 漂移而失去关联。
 */

import type { Chore, ChoreCategory, Difficulty, Member, Settings } from '@/types'

interface PresetDef {
  id: string
  name: string
  emoji: string
  difficulty: Difficulty
  points: number
  category: ChoreCategory
}

const DEFS: readonly PresetDef[] = [
  // ---- 清洁打扫 ----
  { id: 'preset-sweep-floor', name: '扫地', emoji: '🧹', difficulty: 1, points: 2, category: '清洁打扫' },
  { id: 'preset-mop-floor', name: '拖地', emoji: '🧽', difficulty: 3, points: 5, category: '清洁打扫' },
  { id: 'preset-wipe-table', name: '擦桌子', emoji: '🧴', difficulty: 1, points: 2, category: '清洁打扫' },
  { id: 'preset-wipe-window', name: '擦窗户', emoji: '🪟', difficulty: 3, points: 5, category: '清洁打扫' },
  { id: 'preset-scrub-toilet', name: '刷马桶', emoji: '🚽', difficulty: 4, points: 6, category: '清洁打扫' },
  { id: 'preset-clean-bathroom', name: '清洁卫生间', emoji: '🚿', difficulty: 5, points: 8, category: '清洁打扫' },
  { id: 'preset-take-out-trash', name: '倒垃圾', emoji: '🗑️', difficulty: 1, points: 2, category: '清洁打扫' },
  { id: 'preset-change-bedding', name: '换床单被套', emoji: '🛏️', difficulty: 3, points: 5, category: '清洁打扫' },

  // ---- 洗衣晾晒 ----
  { id: 'preset-wash-clothes', name: '洗衣服', emoji: '👕', difficulty: 2, points: 3, category: '洗衣晾晒' },
  { id: 'preset-hang-laundry', name: '晾衣服', emoji: '🧺', difficulty: 1, points: 2, category: '洗衣晾晒' },
  { id: 'preset-fold-clothes', name: '收衣服叠衣服', emoji: '👚', difficulty: 2, points: 3, category: '洗衣晾晒' },
  { id: 'preset-clean-shoes', name: '刷鞋', emoji: '👟', difficulty: 3, points: 4, category: '洗衣晾晒' },

  // ---- 厨房餐食 ----
  { id: 'preset-wash-dishes', name: '洗碗', emoji: '🍽️', difficulty: 2, points: 3, category: '厨房餐食' },
  { id: 'preset-cook-meal', name: '做饭炒菜', emoji: '🍳', difficulty: 4, points: 7, category: '厨房餐食' },
  { id: 'preset-prep-vegetables', name: '洗菜切菜', emoji: '🔪', difficulty: 2, points: 3, category: '厨房餐食' },
  { id: 'preset-clean-stove', name: '清理灶台', emoji: '🔥', difficulty: 3, points: 5, category: '厨房餐食' },
  { id: 'preset-clean-range-hood', name: '清理油烟机', emoji: '💨', difficulty: 4, points: 7, category: '厨房餐食' },
  { id: 'preset-grocery-shopping', name: '买菜', emoji: '🛒', difficulty: 3, points: 4, category: '厨房餐食' },
  { id: 'preset-cook-rice', name: '淘米煮饭', emoji: '🍚', difficulty: 1, points: 2, category: '厨房餐食' },
  { id: 'preset-kitchen-waste', name: '倒厨余垃圾', emoji: '🥬', difficulty: 1, points: 2, category: '厨房餐食' },
  { id: 'preset-organize-fridge', name: '整理冰箱', emoji: '🧊', difficulty: 4, points: 6, category: '厨房餐食' },

  // ---- 整理收纳 ----
  { id: 'preset-make-bed', name: '叠被子铺床', emoji: '🛌', difficulty: 1, points: 2, category: '整理收纳' },
  { id: 'preset-organize-shoes', name: '整理鞋柜', emoji: '🥾', difficulty: 3, points: 5, category: '整理收纳' },
  { id: 'preset-organize-wardrobe', name: '整理衣柜', emoji: '👗', difficulty: 4, points: 6, category: '整理收纳' },

  // ---- 花草鱼宠 ----
  { id: 'preset-water-plants', name: '浇花', emoji: '🪴', difficulty: 1, points: 2, category: '宠物花草' },
  { id: 'preset-feed-fish', name: '喂鱼', emoji: '🐟', difficulty: 1, points: 2, category: '宠物花草' },
  { id: 'preset-clean-fish-tank', name: '清洗鱼缸', emoji: '🐠', difficulty: 4, points: 6, category: '宠物花草' },

  // ---- 其他杂项 ----
  { id: 'preset-pickup-parcel', name: '取快递', emoji: '📦', difficulty: 1, points: 2, category: '其他杂项' },
  { id: 'preset-bills', name: '交水电费记账', emoji: '💡', difficulty: 2, points: 3, category: '其他杂项' },
  { id: 'preset-wash-car', name: '洗车', emoji: '🚗', difficulty: 5, points: 8, category: '其他杂项' },
]

/** 数据版本号，结构变更时递增 */
export const SCHEMA_VERSION = 1

/**
 * 预置目录的版本号。
 *
 * **每次增删改预置项都要 +1。** 应用启动时会拿这个号和数据里存的对比，
 * 不一致就把新版预置合并进去（见 store 里的 syncPresets）。
 *
 * 没有这个机制的话，改预置之后老用户必须「清空数据」才能看到新列表 ——
 * 而一旦家里开始真实记账，清空数据就意味着丢掉全部记录。
 */
export const PRESET_VERSION = 2

/** 当前所有预置项的 id，用于识别「已被下架的旧预置」 */
export const PRESET_IDS: ReadonlySet<string> = new Set(DEFS.map((d) => d.id))

/**
 * 固定的预置时间戳。
 *
 * 不用 `new Date()` —— 否则两台设备各自初始化时会产生不同的 `updatedAt`，
 * LWW 合并会认为双方都「更新」过，产生无意义的冲突。固定值保证预置项
 * 在任何设备上都是逐字节相同的。
 *
 * 它同时是「这一项还是出厂状态、用户没动过」的判定依据（见 presetSync.ts）。
 */
const PRESET_EPOCH = '2026-01-01T00:00:00.000Z'

/** 对外暴露，供 presetSync 判断某个预置项是否被用户改动过 */
export const PRESET_EPOCH_SENTINEL = PRESET_EPOCH

/** 生成完整的预置家务列表（每次调用返回全新对象，避免共享可变引用） */
export function buildPresetChores(): Chore[] {
  return DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    emoji: d.emoji,
    points: d.points,
    difficulty: d.difficulty,
    category: d.category,
    isPreset: true,
    enabled: true,
    createdAt: PRESET_EPOCH,
    updatedAt: PRESET_EPOCH,
  }))
}

/** 默认两位成员 */
export function buildDefaultMembers(): Member[] {
  return [
    {
      id: 'member-xiaoliang',
      name: '小良',
      avatarEmoji: '👦',
      seriesSlot: 1,
      createdAt: PRESET_EPOCH,
      updatedAt: PRESET_EPOCH,
    },
    {
      id: 'member-xiaoying',
      name: '小影',
      avatarEmoji: '👧',
      seriesSlot: 2,
      createdAt: PRESET_EPOCH,
      updatedAt: PRESET_EPOCH,
    },
  ]
}

/** 默认设置 */
export function buildDefaultSettings(): Settings {
  return {
    appTitle: '家务积分榜',
    customEmojiMap: {},
    refreshMinIntervalMs: 60_000,
    presetVersion: PRESET_VERSION,
    updatedAt: PRESET_EPOCH,
  }
}

/** 预置家务名称集合 */
export const PRESET_CHORE_NAMES: readonly string[] = DEFS.map((d) => d.name)

/** 名称 → 图标，供自动匹配的「精确命中」判定使用 */
export const PRESET_NAME_TO_EMOJI: ReadonlyMap<string, string> = new Map(
  DEFS.map((d) => [d.name, d.emoji]),
)

export const PRESET_DEF_COUNT = DEFS.length
export type { PresetDef }

/** 图标选择器里的常用候选，按「家务感」挑选 */
export const FAVORITE_EMOJIS: readonly string[] = [
  '🧹', '🧽', '🧺', '🧼', '🧴', '🪣',
  '👕', '👚', '🧦', '👟', '🧺', '🛏️',
  '🍽️', '🍳', '🔪', '🍚', '🛒', '🧊',
  '🧸', '📚', '👗', '🧳', '🪴', '🐶',
  '🐱', '🐕', '🛁', '📦', '🚗', '🔧',
]
