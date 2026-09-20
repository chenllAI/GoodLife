/**
 * 家务图标自动匹配
 *
 * 需求原文：「用户维护家务后会自动匹配一个图标」。手输的家务名千奇百怪，所以
 * 这里不是一串 `includes`，也不是正则，而是**有序规则表 + 加权最长关键词匹配**。
 *
 * 核心是打分公式：
 *
 *     score = 关键词长度 × 10 − min(出现位置, 9)
 *
 * **长度主导**，位置只做微调。这让「特异性」成为结构性保证，而不是靠维护者
 * 小心翼翼地排列规则顺序：
 *
 *   - 「洗车」    → 命中 `洗车`(2×10=20)，胜过任何更短的关键词 → 🚗
 *   - 「洗衣服」  → 命中 `洗衣服`(3×10=30)，胜过 `衣服`(20)   → 👕
 *   - 「洗窗帘」  → 命中 `洗窗帘`(30)，胜过 `窗帘`(20)        → 🪟
 *   - 「倒厨余垃圾」→ 命中 `倒厨余垃圾`(5×10=50)，胜过 `垃圾`(20) → 🥬
 *
 * 如果哪天有人往表里加了一条 `{ emoji:'💧', keywords:['洗'] }`，它只会拿到 10 分，
 * 永远赢不过上面任何一条 —— 破坏不了已有行为。这正是打分而非顺序的价值。
 *
 * 同分时按**规则表顺序**打破，保证结果确定（不依赖对象键的遍历顺序）。
 */

import type { ChoreCategory } from '@/types'
import { CATEGORY_DEFAULT_EMOJI } from '@/types'
import { PRESET_NAME_TO_EMOJI } from './presets'

export type MatchConfidence = 'exact' | 'high' | 'low' | 'fallback'

export interface EmojiMatch {
  emoji: string
  confidence: MatchConfidence
  /** 命中的关键词，便于测试断言「意图」而不只是一个 emoji */
  matched: string | null
}

interface EmojiRule {
  emoji: string
  keywords: readonly string[]
}

/**
 * 规则表。关键词按「在同一规则内越具体越靠前」排列 —— 虽然打分已经保证了长度
 * 主导，但显式排序让意图更易读。
 */
const EMOJI_RULES: readonly EmojiRule[] = [
  // ---- 交通 / 大家伙 ----
  { emoji: '🚗', keywords: ['洗车', '擦车', '打蜡', '车'] },

  // ---- 宠物 ----
  { emoji: '🐠', keywords: ['清洗鱼缸', '洗鱼缸', '刷鱼缸', '鱼缸', '换水', '水族'] },
  { emoji: '🐟', keywords: ['喂鱼', '鱼食', '鱼粮', '鱼'] },
  { emoji: '🐕', keywords: ['遛狗', '遛弯'] },
  { emoji: '🐱', keywords: ['铲猫砂', '猫砂', '猫'] },
  { emoji: '🐶', keywords: ['喂宠物', '宠物', '狗粮', '狗'] },
  { emoji: '🛁', keywords: ['给宠物洗澡', '宠物洗澡', '洗澡'] },

  // ---- 衣物鞋帽 ----
  { emoji: '👚', keywords: ['收衣服叠衣服', '收衣服', '叠衣服', '折叠'] },
  { emoji: '👕', keywords: ['洗衣服', '衣服', 'T恤', '上衣'] },
  { emoji: '🧦', keywords: ['洗袜子', '袜子'] },
  { emoji: '👟', keywords: ['刷鞋', '球鞋', '鞋'] },
  { emoji: '🥾', keywords: ['鞋柜', '靴子'] },
  { emoji: '♨️', keywords: ['熨衣服', '熨斗', '烫衣'] },
  { emoji: '🧺', keywords: ['晾衣服', '晾晒', '衣架', '洗衣篮'] },

  // ---- 窗户 / 玻璃 ----
  { emoji: '🪟', keywords: ['擦窗户', '洗窗帘', '窗户', '窗帘', '玻璃'] },

  // ---- 地面 / 台面 ----
  { emoji: '🧹', keywords: ['扫地', '扫把', '笤帚', '扫'] },
  { emoji: '🧽', keywords: ['拖地', '擦地', '抹地', '拖把', '地'] },
  { emoji: '🧴', keywords: ['擦桌子', '桌子', '台面', '茶几', '抹布'] },
  { emoji: '🌀', keywords: ['吸尘', '除尘', '地毯'] },
  { emoji: '🧼', keywords: ['大扫除', '消毒', '清洁剂', '打扫'] },

  // ---- 卫生间 ----
  { emoji: '🚽', keywords: ['刷马桶', '马桶', '厕所'] },
  { emoji: '🚿', keywords: ['卫生间', '浴室', '淋浴', '洗手池'] },

  // ---- 床品 ----
  { emoji: '🛏️', keywords: ['换床单被套', '床单', '被套', '床品'] },
  { emoji: '🛌', keywords: ['叠被子', '铺床', '被子', '床铺'] },

  // ---- 厨房 ----
  { emoji: '🍽️', keywords: ['洗碗', '餐具', '盘子', '碗'] },
  { emoji: '🍳', keywords: ['做饭炒菜', '做饭', '炒菜', '烹饪', '下厨'] },
  { emoji: '🔪', keywords: ['洗菜切菜', '洗菜', '切菜', '切'] },
  { emoji: '🔥', keywords: ['清理灶台', '灶台', '燃气灶', '灶'] },
  { emoji: '💨', keywords: ['清理油烟机', '油烟机', '排风扇'] },
  { emoji: '🛒', keywords: ['买菜', '采购', '超市', '购物'] },
  { emoji: '🍚', keywords: ['淘米煮饭', '煮饭', '淘米', '米饭'] },
  { emoji: '🧊', keywords: ['整理冰箱', '冰箱', '冷藏'] },
  { emoji: '🥬', keywords: ['倒厨余垃圾', '厨余垃圾', '厨余', '剩菜'] },

  // ---- 垃圾 / 回收（注意：必须排在厨余之后，靠长度取胜）----
  { emoji: '♻️', keywords: ['垃圾分类', '回收', '分类'] },
  { emoji: '🗑️', keywords: ['倒垃圾', '垃圾'] },

  // ---- 收纳整理 ----
  { emoji: '🧸', keywords: ['整理房间', '收拾房间', '玩具', '房间'] },
  { emoji: '👗', keywords: ['整理衣柜', '衣柜', '挂衣服'] },
  { emoji: '📚', keywords: ['整理书桌', '书桌', '书架', '书本'] },
  { emoji: '🧳', keywords: ['收纳换季衣物', '换季衣物', '行李箱', '收纳箱'] },

  // ---- 花草 ----
  { emoji: '🪴', keywords: ['浇花', '绿植', '盆栽', '植物', '花'] },
  { emoji: '✂️', keywords: ['修剪花草', '修剪', '剪枝', '花草'] },

  // ---- 杂项 ----
  { emoji: '📦', keywords: ['取快递', '快递', '包裹', '搬东西'] },
  { emoji: '🔧', keywords: ['换灯泡维修', '维修', '修理', '灯泡', '工具'] },
  { emoji: '💡', keywords: ['交水电费', '水电费', '电费', '记账', '缴费'] },
  { emoji: '📖', keywords: ['辅导作业', '作业', '功课', '辅导'] },
]

/** 分类词 → 分类，用于「名称里出现分类关键词但没命中具体规则」时的兜底 */
const CATEGORY_HINTS: readonly { keyword: string; category: ChoreCategory }[] = [
  { keyword: '清洁', category: '清洁打扫' },
  { keyword: '打扫', category: '清洁打扫' },
  { keyword: '洗', category: '洗衣晾晒' },
  { keyword: '厨房', category: '厨房餐食' },
  { keyword: '做饭', category: '厨房餐食' },
  { keyword: '整理', category: '整理收纳' },
  { keyword: '收纳', category: '整理收纳' },
  { keyword: '宠物', category: '宠物花草' },
  { keyword: '花', category: '宠物花草' },
  { keyword: '草', category: '宠物花草' },
]

export const DEFAULT_EMOJI = '🧹'

/**
 * 归一化：全角转半角、去空白与常见标点、拉丁转小写。
 * 「擦 桌 子」、「擦桌子。」、「ＡＢ」都应归到同一形态。
 */
export function normalizeName(raw: string): string {
  let s = raw.trim()
  // 全角 → 半角（FF01–FF5E → 21–7E），并处理表意空格
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  s = s.replace(/　/g, ' ')
  // 去掉空白与常见标点/装饰符
  s = s.replace(/[\s·・.,，。、!！?？~～\-_—()（）[\]【】{}<>《》'"“”‘’:：;；/\\|+*#@&]/g, '')
  return s.toLowerCase()
}

interface Scored {
  emoji: string
  keyword: string
  score: number
  ruleIndex: number
}

function scoreRules(normalizedName: string): Scored | null {
  let best: Scored | null = null

  for (let ri = 0; ri < EMOJI_RULES.length; ri++) {
    const rule = EMOJI_RULES[ri] as EmojiRule
    let ruleBest: Scored | null = null

    for (const kw of rule.keywords) {
      const idx = normalizedName.indexOf(kw)
      if (idx < 0) continue
      const score = kw.length * 10 - Math.min(idx, 9)
      if (ruleBest === null || score > ruleBest.score) {
        ruleBest = { emoji: rule.emoji, keyword: kw, score, ruleIndex: ri }
      }
    }

    if (ruleBest === null) continue
    // 同分按规则表顺序打破，保证确定性
    if (best === null || ruleBest.score > best.score) best = ruleBest
  }

  return best
}

export interface MatchOptions {
  /** 用户选定的分类，用于兜底档 */
  category?: ChoreCategory
  /** 用户手改过的图标，按归一化名称索引（随数据同步） */
  customMap?: Record<string, string>
}

/**
 * 为一个家务名匹配图标。
 *
 * 返回的 `confidence` 供 UI 决定是否提示用户确认：
 *   exact   —— 与预置名完全一致，或用户之前手动选定过 → 直接采用，不打扰
 *   high    —— 命中了长度 ≥ 2 的关键词 → 直接采用
 *   low     —— 只靠分类兜底 → 弹出选择器让用户确认
 *   fallback—— 完全没线索 → 弹出选择器
 */
export function matchEmoji(rawName: string, opts: MatchOptions = {}): EmojiMatch {
  const name = normalizeName(rawName)
  if (!name) {
    return { emoji: DEFAULT_EMOJI, confidence: 'fallback', matched: null }
  }

  // 1. 用户手改过的选择优先 —— 学一次，两台设备都记住
  const custom = opts.customMap?.[name]
  if (custom) return { emoji: custom, confidence: 'exact', matched: name }

  // 2. 预置名精确命中
  const presetEmoji = PRESET_NAME_TO_EMOJI.get(rawName.trim())
  if (presetEmoji) {
    return { emoji: presetEmoji, confidence: 'exact', matched: rawName.trim() }
  }

  // 3. 加权扫描
  const hit = scoreRules(name)
  if (hit && hit.keyword.length >= 2) {
    return { emoji: hit.emoji, confidence: 'high', matched: hit.keyword }
  }

  // 4. 分类兜底：先看用户选的分类，再看名称里的分类线索
  const hinted =
    opts.category ??
    CATEGORY_HINTS.find((h) => name.includes(h.keyword))?.category ??
    null
  if (hinted) {
    return { emoji: CATEGORY_DEFAULT_EMOJI[hinted], confidence: 'low', matched: null }
  }

  // 5. 单字命中虽然弱，也好过完全没线索
  if (hit) return { emoji: hit.emoji, confidence: 'low', matched: hit.keyword }

  return { emoji: DEFAULT_EMOJI, confidence: 'fallback', matched: null }
}

/**
 * 给图标选择器生成候选（去重、保序）：
 * 匹配结果 → 分类默认 → 常用图标。
 * 用户即便随手一输，也能在一屏内点到合适的图标。
 */
export function suggestEmojis(
  rawName: string,
  opts: MatchOptions = {},
  limit = 12,
): string[] {
  const out: string[] = []
  const push = (e: string | undefined) => {
    if (e && !out.includes(e)) out.push(e)
  }

  const match = matchEmoji(rawName, opts)
  push(match.emoji)

  const hinted = opts.category ?? CATEGORY_HINTS.find((h) => normalizeName(rawName).includes(h.keyword))?.category
  if (hinted) push(CATEGORY_DEFAULT_EMOJI[hinted])

  for (const e of FAVORITES) push(e)

  return out.slice(0, limit)
}

const FAVORITES: readonly string[] = [
  '🧹', '🧽', '🧼', '🧺', '🧴', '🪣',
  '👕', '👚', '🧦', '👟', '🛏️', '🛌',
  '🍽️', '🍳', '🔪', '🍚', '🛒', '🧊',
  '🧸', '📚', '👗', '🧳', '🪴', '🐶',
  '🐱', '🐕', '🛁', '📦', '🚗', '🔧',
  '💡', '📖', '♻️', '🗑️', '🚿', '🚽',
]
