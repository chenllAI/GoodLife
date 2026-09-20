/**
 * 预置目录的完整性检查
 *
 * 这些断言守的是「日后改预置时容易漏掉的东西」—— 重复的 id、分值超出难度档位、
 * 演示数据引用了已下架的家务。每一条都对应一种真实会发生的疏漏。
 */

import { describe, expect, it } from 'vitest'
import {
  PRESET_DEF_COUNT,
  PRESET_EPOCH_SENTINEL,
  PRESET_IDS,
  PRESET_NAME_TO_EMOJI,
  PRESET_VERSION,
  buildDefaultMembers,
  buildDefaultSettings,
  buildPresetChores,
} from '@/domain/presets'
import { CHORE_CATEGORIES, type Difficulty } from '@/types'

/** 各难度允许的分值区间 */
const POINT_BAND: Record<Difficulty, [number, number]> = {
  1: [1, 2],
  2: [3, 3],
  3: [4, 5],
  4: [6, 7],
  5: [8, 10],
}

describe('预置目录结构', () => {
  const presets = buildPresetChores()

  it('数量与导出常量一致', () => {
    expect(presets.length).toBe(PRESET_DEF_COUNT)
    expect(PRESET_IDS.size).toBe(PRESET_DEF_COUNT)
  })

  it('id 唯一（重复 id 会导致合并时互相覆盖）', () => {
    const ids = presets.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('名称唯一（否则图标精确匹配会撞车）', () => {
    const names = presets.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    expect(PRESET_NAME_TO_EMOJI.size).toBe(names.length)
  })

  it('每项都有非空名称与图标', () => {
    for (const c of presets) {
      expect(c.name.trim().length, `${c.id} 名称`).toBeGreaterThan(0)
      expect(c.emoji.length, `${c.id} 图标`).toBeGreaterThan(0)
    }
  })

  it('分类都是合法分类', () => {
    for (const c of presets) {
      expect(CHORE_CATEGORIES, `${c.name} 的分类`).toContain(c.category)
    }
  })

  it('分值落在其难度对应的档位内', () => {
    const offenders: string[] = []
    for (const c of presets) {
      const [lo, hi] = POINT_BAND[c.difficulty]
      if (c.points < lo || c.points > hi) {
        offenders.push(`${c.name}：D${c.difficulty} 应为 ${lo}–${hi} 分，实际 ${c.points}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('每项都标记为预置且默认启用', () => {
    for (const c of presets) {
      expect(c.isPreset, `${c.name}`).toBe(true)
      expect(c.enabled, `${c.name}`).toBe(true)
      expect(c.deleted).toBeUndefined()
    }
  })

  it('时间戳是固定的哨兵值（保证两台设备逐字节一致）', () => {
    for (const c of presets) {
      expect(c.createdAt).toBe(PRESET_EPOCH_SENTINEL)
      expect(c.updatedAt).toBe(PRESET_EPOCH_SENTINEL)
    }
  })

  it('每次调用返回全新对象（避免共享可变引用）', () => {
    const a = buildPresetChores()
    const b = buildPresetChores()
    expect(a[0]).not.toBe(b[0])
    expect(a[0]).toEqual(b[0])
  })

  it('六个分类下都有家务（否则筛选会出现空分类）', () => {
    for (const cat of CHORE_CATEGORIES) {
      const n = presets.filter((c) => c.category === cat).length
      expect(n, `分类「${cat}」`).toBeGreaterThan(0)
    }
  })
})

describe('默认成员与设置', () => {
  it('默认是两位成员（界面按两人对决设计）', () => {
    const members = buildDefaultMembers()
    expect(members).toHaveLength(2)
    expect(members.map((m) => m.seriesSlot)).toEqual([1, 2])
  })

  it('成员的配色槽位不重复', () => {
    const slots = buildDefaultMembers().map((m) => m.seriesSlot)
    expect(new Set(slots).size).toBe(slots.length)
  })

  it('默认设置里带着当前的预置版本号', () => {
    // 这一条保证全新安装不会触发一次多余的升级写入
    expect(buildDefaultSettings().presetVersion).toBe(PRESET_VERSION)
  })
})
