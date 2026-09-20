/**
 * 成员配色映射
 *
 * **颜色跟随「人」，而不是「名次」。** 小影反超的时候，她的条形仍然是橙色，
 * 变的只是皇冠图标 —— 如果颜色跟着排名走，用户每次刷新都要重新认一遍谁是谁。
 *
 * 这两个色值跑过 dataviz 校验器（暖色底 #FFF7ED，浅色模式）：
 *   色盲可辨 ΔE 24.7 (protan) / 32.7 (tritan)，正常视觉 ΔE 33.6，对比度均 ≥3:1。
 */

export function memberColorVar(slot: 1 | 2): string {
  return slot === 1 ? 'var(--series-1)' : 'var(--series-2)'
}

export function memberDeepVar(slot: 1 | 2): string {
  return slot === 1 ? 'var(--series-1-deep)' : 'var(--series-2-deep)'
}

export function memberSoftVar(slot: 1 | 2): string {
  return slot === 1 ? 'var(--series-1-soft)' : 'var(--series-2-soft)'
}

export function memberCardClass(slot: 1 | 2): string {
  return `member-card--m${slot}`
}

export function memberDotClass(slot: 1 | 2): string {
  return `member-dot--m${slot}`
}
