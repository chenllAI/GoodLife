/**
 * 家务积分榜 —— 核心数据模型
 *
 * 设计要点（改动前请先读）：
 *
 * 1. `PointsRecord` 是**不可变账本条目**，它在创建时快照了家务的名称/图标/分类/
 *    难度/分值。这样调整家务分值不会追溯改写历史榜单，删除家务也不会让历史记录
 *    变成孤儿。详见 README 的「为什么记录要存快照」。
 * 2. 所有时间归属判断都基于 `day`（记录时冻结的民用日期字符串），而不是从 `at`
 *    现算。这让聚合变成纯粹的字符串比较，不受时区数据库与设备时钟漂移影响。
 * 3. 删除一律用**墓碑**（`deleted: true` + `deletedAt`），绝不从数组里剔除 ——
 *    直接剔除会被另一台设备的陈旧副本「复活」。
 */

/** 'YYYY-MM-DD'，本地民用日期 */
export type DayKey = string

/** 'YYYY-MM'，用于数据分片文件名 */
export type MonthKey = string

export type MemberId = string
export type ChoreId = string
export type RecordId = string

/** 1 很轻松 → 5 很费力 */
export type Difficulty = 1 | 2 | 3 | 4 | 5

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  1: '很轻松',
  2: '轻松',
  3: '一般',
  4: '有点累',
  5: '很费力',
}

/** 各难度对应的建议分值，用于自定义家务时预填 */
export const DIFFICULTY_SUGGESTED_POINTS: Record<Difficulty, number> = {
  1: 2,
  2: 3,
  3: 5,
  4: 7,
  5: 9,
}

export const CHORE_CATEGORIES = [
  '清洁打扫',
  '洗衣晾晒',
  '厨房餐食',
  '整理收纳',
  '宠物花草',
  '其他杂项',
] as const

export type ChoreCategory = (typeof CHORE_CATEGORIES)[number]

/** 每类家务的默认图标，用于自动匹配的兜底档 */
export const CATEGORY_DEFAULT_EMOJI: Record<ChoreCategory, string> = {
  清洁打扫: '🧽',
  洗衣晾晒: '🧺',
  厨房餐食: '🍳',
  整理收纳: '🧸',
  宠物花草: '🪴',
  其他杂项: '📦',
}

export interface Member {
  id: MemberId
  name: string
  avatarEmoji: string
  /**
   * 系列配色槽位。**颜色跟随「人」而非「名次」** —— 小影反超时她的条形仍是橙色，
   * 变的只是皇冠图标。已校验该配色在暖色底上的对比度与色盲可辨性。
   */
  seriesSlot: 1 | 2
  createdAt: string
  /** 并发编辑的 LWW 键 */
  updatedAt: string
}

export interface Chore {
  id: ChoreId
  name: string
  emoji: string
  points: number
  difficulty: Difficulty
  category: ChoreCategory
  /** 预置项可改名/改分/隐藏，但不硬删除（用 enabled:false 隐藏） */
  isPreset: boolean
  enabled: boolean
  createdAt: string
  /** 并发编辑的 LWW 键 */
  updatedAt: string
  /** 自定义家务的墓碑标记（预置项不走这条路，用 enabled 隐藏） */
  deleted?: boolean
  deletedAt?: string
}

export interface PointsRecord {
  /** uuid v4 —— 跨设备合并的主键 */
  id: RecordId
  memberId: MemberId

  /** 软链接。家务被删除后仍保留 id，便于统计「这项家务总共做过几次」 */
  choreId: ChoreId | null

  // ↓↓↓ 快照字段：记录发生时的家务形态，之后永不回查家务表 ↓↓↓
  choreName: string
  choreEmoji: string
  category: ChoreCategory
  difficulty: Difficulty
  /** **计分唯一依据**，绝不从 choreId 反查 */
  points: number

  /** ISO-8601 瞬时，用于「谁先到达」的并列判定与展示 */
  at: string
  /** 记录创建时冻结的民用日期，所有日/周/月归属都看它 */
  day: DayKey

  note?: string

  /**
   * 设备 id —— 真正的归属人。两台设备共用同一个 GitHub 账号提交，
   * 所以提交者信息无法区分是谁记的账，必须自己记。
   */
  createdBy: string
  createdAt: string
  /** 并发编辑的 LWW 键 */
  updatedAt: string

  /** 墓碑标记 */
  deleted?: boolean
  deletedAt?: string
}

export interface Settings {
  appTitle: string
  /** 用户手改过的图标选择，学下来后两台设备都能命中 */
  customEmojiMap: Record<string, string>
  /** 刷新间隔下限，保护匿名限流额度 */
  refreshMinIntervalMs: number
  /**
   * 已同步到的预置目录版本。
   * 应用启动时对比它和当前 PRESET_VERSION，不一致就自动合并新版预置。
   */
  presetVersion?: number
  /** 并发编辑的 LWW 键 */
  updatedAt: string
}

export interface Meta {
  schemaVersion: number
  updatedAt: string
  members: Member[]
  chores: Chore[]
  settings: Settings
}

/** 一个月的记录分片，对应 data/records/records-YYYY-MM.json */
export interface Shard {
  schemaVersion: number
  month: MonthKey
  records: PointsRecord[]
}

/** 完整文档 —— 适配器读写的逻辑单位 */
export interface FamilyDoc {
  meta: Meta
  records: PointsRecord[]
}

// ---------------------------------------------------------------------------
// 存储操作流
// ---------------------------------------------------------------------------

/**
 * 适配器之间传递的是**操作**，不是文档快照。
 *
 * 这一点很关键：离线队列如果保存整个 JSON 文档并在恢复后重放，会把另一台设备
 * 期间的写入整个覆盖掉；而重放操作则是把它们叠加到「刚刚读到的」远端状态上。
 */
export type Op =
  | { type: 'addRecord'; record: PointsRecord }
  | { type: 'deleteRecord'; id: RecordId; deletedAt: string }
  | { type: 'upsertChore'; chore: Chore }
  | { type: 'deleteChore'; id: ChoreId; deletedAt: string }
  | { type: 'upsertMember'; member: Member }
  | { type: 'putSettings'; settings: Settings }

export type Period = 'day' | 'week' | 'month'

export interface DayRange {
  /** 闭区间起点 */
  start: DayKey
  /** 闭区间终点 */
  end: DayKey
}
