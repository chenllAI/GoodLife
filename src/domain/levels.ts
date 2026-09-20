/**
 * 等级体系
 *
 * 按**累计总分**（历史全部记录，只增不减）评定，而不是按当期积分。
 * 理由：如果按周榜积分评级，孩子生病或考试周没做家务就会被「降级」，
 * 那是在惩罚不可控的事情，和鼓励做家务的初衷相反。
 */

export interface Level {
  /** 达到该等级所需的累计积分下限 */
  min: number
  title: string
  emoji: string
}

export const LEVELS: readonly Level[] = [
  { min: 0, title: '家务小白', emoji: '🌱' },
  { min: 100, title: '家务学徒', emoji: '🧹' },
  { min: 300, title: '家务能手', emoji: '🧼' },
  { min: 600, title: '家务达人', emoji: '⭐' },
  { min: 1000, title: '家务大师', emoji: '🏅' },
  { min: 2000, title: '家务超人', emoji: '🦸' },
  { min: 3500, title: '家务传奇', emoji: '👑' },
  { min: 6000, title: '家务之神', emoji: '🌈' },
]

export interface LevelState {
  level: Level
  /** 等级下标，0 起 */
  index: number
  /** 下一级；已是最高级时为 null */
  next: Level | null
  /** 距离下一级还差多少分；已满级为 0 */
  toNext: number
  /** 在当前等级内的进度 0–1；已满级恒为 1 */
  progress: number
}

export function levelOf(lifetimePoints: number): LevelState {
  const pts = Math.max(0, Math.floor(lifetimePoints))

  let index = 0
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    const lv = LEVELS[i]
    if (lv && pts >= lv.min) {
      index = i
      break
    }
  }

  const level = LEVELS[index] as Level
  const next = LEVELS[index + 1] ?? null

  if (!next) {
    return { level, index, next: null, toNext: 0, progress: 1 }
  }

  const span = next.min - level.min
  const done = pts - level.min
  return {
    level,
    index,
    next,
    toNext: next.min - pts,
    progress: span > 0 ? Math.min(1, Math.max(0, done / span)) : 0,
  }
}
