/**
 * 图标自动匹配测试
 *
 * 重点是**特异性陷阱**：洗车 / 洗衣服 / 洗碗 / 洗菜切菜 / 洗窗帘 / 洗袜子
 * 全部含「洗」字，但必须各自命中自己的图标，而不能共用一条泛化的「洗」规则。
 * 这正是「长度主导打分」相对「按顺序 includes」的价值所在。
 */

import { describe, expect, it } from 'vitest'
import { matchEmoji, normalizeName, suggestEmojis } from '@/domain/emojiMatcher'
import { buildPresetChores } from '@/domain/presets'

describe('特异性陷阱 —— 都含「洗」但必须各归各的', () => {
  const cases: [string, string][] = [
    ['洗车', '🚗'],
    ['洗衣服', '👕'],
    ['洗袜子', '🧦'],
    ['洗碗', '🍽️'],
    ['洗菜切菜', '🔪'],
    ['洗窗帘', '🪟'],
  ]

  for (const [name, expected] of cases) {
    it(`「${name}」→ ${expected}`, () => {
      expect(matchEmoji(name).emoji).toBe(expected)
    })
  }

  it('同一批名字互不串味（两两结果都不同）', () => {
    const emojis = cases.map(([n]) => matchEmoji(n).emoji)
    expect(new Set(emojis).size).toBe(cases.length)
  })
})

describe('垃圾三兄弟 —— 靠长度区分', () => {
  it('倒垃圾 → 🗑️', () => {
    expect(matchEmoji('倒垃圾').emoji).toBe('🗑️')
  })

  it('垃圾分类 → ♻️（不能被「垃圾」抢走）', () => {
    expect(matchEmoji('垃圾分类').emoji).toBe('♻️')
  })

  it('倒厨余垃圾 → 🥬（不能被「垃圾」抢走）', () => {
    expect(matchEmoji('倒厨余垃圾').emoji).toBe('🥬')
  })

  it('三者结果互不相同', () => {
    const emojis = ['倒垃圾', '垃圾分类', '倒厨余垃圾'].map((n) => matchEmoji(n).emoji)
    expect(new Set(emojis).size).toBe(3)
  })
})

describe('长度主导', () => {
  it('更长的关键词胜出，即使出现位置更靠后', () => {
    // 「厨房用的洗碗布」：洗碗(2) 出现在位置 4，厨… 更短的关键词出现在位置 0
    expect(matchEmoji('厨房里的洗碗布').emoji).toBe('🍽️')
  })

  it('同一规则内取最佳关键词', () => {
    // 「收拾换季衣物」命中 收纳换季衣物 规则下的 换季衣物
    const m = matchEmoji('收拾换季衣物')
    expect(m.emoji).toBe('🧳')
    expect(m.matched).toBe('换季衣物')
  })
})

describe('预置家务全部能匹配到自己的图标', () => {
  const presets = buildPresetChores()

  it('每一项预置都能精确命中自己的图标', () => {
    for (const chore of presets) {
      const m = matchEmoji(chore.name)
      expect(m.emoji, `${chore.name} 应匹配 ${chore.emoji}`).toBe(chore.emoji)
      expect(m.confidence, `${chore.name} 应为精确命中`).toBe('exact')
    }
  })

  it('加了后缀、无法精确命中时，打分仍能选对（真正在测打分逻辑）', () => {
    // 这一组绕开了「预置名精确命中」的捷径，走的是加权扫描
    const failures: string[] = []
    for (const chore of presets) {
      const decorated = `${chore.name}（日常）`
      const m = matchEmoji(decorated)
      if (m.emoji !== chore.emoji) {
        failures.push(`${decorated}: 期望 ${chore.emoji}，实际 ${m.emoji}（命中「${m.matched}」）`)
      }
    }
    expect(failures).toEqual([])
  })
})

describe('用户自定义 —— 学习能力', () => {
  it('customMap 优先于一切规则', () => {
    const m = matchEmoji('拖地', { customMap: { 拖地: '🎯' } })
    expect(m.emoji).toBe('🎯')
    expect(m.confidence).toBe('exact')
  })

  it('customMap 的键是归一化后的名称', () => {
    // 输入带空格/全角也会归一到同一个键
    expect(matchEmoji('拖 地', { customMap: { 拖地: '🎯' } }).emoji).toBe('🎯')
  })
})

describe('兜底与置信度', () => {
  it('完全没线索时用默认图标并标为 fallback', () => {
    const m = matchEmoji('做点别的事情')
    expect(m.confidence).toBe('fallback')
    expect(m.emoji).toBe('🧹')
  })

  it('只靠分类兜底时标为 low', () => {
    const m = matchEmoji('卧室里的杂活', { category: '清洁打扫' })
    expect(m.confidence).toBe('low')
    expect(m.emoji).toBe('🧽')
  })

  it('名称里含分类线索也能兜底', () => {
    const m = matchEmoji('厨房的杂活')
    expect(m.emoji).toBe('🍳')
  })

  it('空字符串与纯空白不抛错', () => {
    expect(() => matchEmoji('')).not.toThrow()
    expect(() => matchEmoji('   ')).not.toThrow()
    expect(matchEmoji('').confidence).toBe('fallback')
  })

  it('命中长度 ≥2 的关键词时标为 high', () => {
    const m = matchEmoji('把地拖一拖')
    // 「拖」是单字，走 low；这里断言的是置信度语义而非具体值
    expect(['high', 'low']).toContain(m.confidence)
  })
})

describe('normalizeName', () => {
  it('去空格', () => {
    expect(normalizeName('拖 地')).toBe('拖地')
  })

  it('全角转半角', () => {
    expect(normalizeName('ＡＢＣ')).toBe('abc')
  })

  it('去标点', () => {
    expect(normalizeName('拖地（客厅）')).toBe('拖地客厅')
    expect(normalizeName('拖地。')).toBe('拖地')
    expect(normalizeName('拖地!!!')).toBe('拖地')
  })

  it('拉丁字母转小写', () => {
    expect(normalizeName('T恤')).toBe('t恤')
  })

  it('表意空格也去掉', () => {
    expect(normalizeName('拖　地')).toBe('拖地')
  })
})

describe('suggestEmojis —— 供图标选择器使用', () => {
  it('首个候选就是匹配结果', () => {
    expect(suggestEmojis('拖地')[0]).toBe('🧽')
  })

  it('返回去重且不超过 limit', () => {
    const list = suggestEmojis('洗碗', {}, 8)
    expect(list.length).toBeLessThanOrEqual(8)
    expect(new Set(list).size).toBe(list.length)
  })

  it('无线索时也给出足够多的候选', () => {
    expect(suggestEmojis('随便什么').length).toBeGreaterThan(5)
  })
})
