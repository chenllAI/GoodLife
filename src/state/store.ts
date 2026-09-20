/**
 * 应用状态
 *
 * 适配器持有权威文档，store 只订阅它并派生 UI 需要的数据。UI 组件不直接碰适配器。
 *
 * 存储**只有 GitHub 仓库一种**：需求就是「两台手机读写同一份」，本机存储做不到
 * 这件事，留一个「本地模式」开关只会让人以为数据同步了。所以没配置仓库时
 * 应用不进主界面，而是显示配置页。
 */

import { create } from 'zustand'
import type { Chore, DayKey, FamilyDoc, Period, PointsRecord } from '@/types'
import { newId } from '@/domain/codec'
import { consumeInviteToken } from '@/config/invite'
import { createInitialDoc } from '@/domain/doc'
import { normalizeName } from '@/domain/emojiMatcher'
import { planPresetSync } from '@/domain/presetSync'
import { dayKeyOf, todayKey } from '@/domain/time'
import { createAdapter, isGithubConfigUsable, loadStorageConfig, saveStorageConfig } from '@/storage'
import type { AdapterStatus, GithubConfig, StorageAdapter } from '@/storage/types'

export interface Toast {
  id: string
  text: string
  tone: 'info' | 'ok' | 'error'
}

interface AddRecordInput {
  memberId: string
  chore: Chore
  /** 补录：指定日期（不传则用今天） */
  day?: DayKey
  note?: string
}

interface AppState {
  config: GithubConfig
  adapter: StorageAdapter | null
  doc: FamilyDoc
  status: AdapterStatus
  /** 是否已完成首次加载 */
  ready: boolean
  /** 还没配置仓库 —— 界面应显示配置页而不是主界面 */
  needsSetup: boolean
  bootError: string | null

  period: Period
  anchor: DayKey

  toasts: Toast[]

  // 生命周期
  bootstrap: () => Promise<void>
  connect: (config: GithubConfig) => Promise<void>
  refresh: (full?: boolean) => Promise<void>

  // 写入
  addRecord: (input: AddRecordInput) => Promise<PointsRecord | null>
  deleteRecord: (id: string) => Promise<void>
  saveChore: (input: {
    id?: string
    name: string
    emoji: string
    points: number
    difficulty: Chore['difficulty']
    category: Chore['category']
  }) => Promise<void>
  toggleChore: (id: string) => Promise<void>
  deleteChore: (id: string) => Promise<void>
  renameMember: (id: string, name: string) => Promise<void>

  // UI
  setPeriod: (p: Period) => void
  setAnchor: (a: DayKey) => void
  pushToast: (text: string, tone?: Toast['tone']) => void
  dismissToast: (id: string) => void
}

const EMPTY_STATUS: AdapterStatus = {
  kind: 'github',
  state: 'idle',
  pendingOps: 0,
  lastSyncedAt: null,
  readOnly: false,
  message: null,
  rateLimitResetAt: null,
}

export const useApp = create<AppState>((set, get) => ({
  config: loadStorageConfig(),
  adapter: null,
  doc: createInitialDoc(),
  status: EMPTY_STATUS,
  ready: false,
  needsSetup: !isGithubConfigUsable(loadStorageConfig()),
  bootError: null,

  period: 'day',
  anchor: todayKey(),

  toasts: [],

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  bootstrap: async () => {
    // 邀请链接：地址里带着令牌就自动填上，用户什么都不用做。
    // 仓库地址是构建时烘焙好的，所以到这里配置一定是完整的。
    const invited = consumeInviteToken()
    let config = get().config
    if (invited && invited !== config.token) {
      config = { ...config, token: invited }
      saveStorageConfig(config)
      set({ config })
    }

    if (!isGithubConfigUsable(config)) {
      // 只会在「构建时没配仓库地址」这种异常情况下走到这里
      set({ ready: true, needsSetup: true, adapter: null, bootError: null })
      return
    }

    await get().connect(config)
    if (invited) {
      get().pushToast('已通过邀请链接完成配置，可以记分了', 'ok')
    }
  },

  connect: async (config) => {
    const prev = get().adapter
    prev?.dispose()

    saveStorageConfig(config)
    set({
      config,
      adapter: null,
      ready: false,
      needsSetup: false,
      bootError: null,
      status: EMPTY_STATUS,
    })

    const adapter = createAdapter({ config })
    adapter.subscribe((doc, status) => {
      set({ doc, status })
    })
    set({ adapter })

    const result = await adapter.init()

    // 预置目录升级：改了预置项之后，老数据靠这个自动合并，不需要手工干预。
    await applyPresetSync(adapter, get().pushToast)

    set({
      ready: true,
      doc: adapter.read(),
      status: adapter.getStatus(),
      bootError: result.ok ? null : result.message,
    })
  },

  refresh: async (full = false) => {
    const adapter = get().adapter
    if (!adapter) return
    try {
      await adapter.refresh({ full })
      set({ doc: adapter.read(), status: adapter.getStatus(), bootError: null })
    } catch (err) {
      set({
        status: adapter.getStatus(),
        bootError: err instanceof Error ? err.message : String(err),
      })
    }
  },

  // -------------------------------------------------------------------------
  // 写入
  // -------------------------------------------------------------------------

  addRecord: async ({ memberId, chore, day, note }) => {
    const adapter = get().adapter
    if (!adapter) return null

    // 时间取自适配器 —— GitHub 模式下会用采样到的服务器偏移校正，
    // 避免两台手机时钟不一致导致记到错误的日子
    const nowMs = adapter.nowMs()
    const when = day ? atOnDay(day, nowMs) : new Date(nowMs)
    const iso = when.toISOString()

    const record: PointsRecord = {
      id: newId(),
      memberId,
      choreId: chore.id,
      // 快照：之后改家务分值不会改写这条历史
      choreName: chore.name,
      choreEmoji: chore.emoji,
      category: chore.category,
      difficulty: chore.difficulty,
      points: chore.points,
      at: iso,
      day: day ?? dayKeyOf(when),
      ...(note ? { note } : {}),
      createdBy: deviceId(),
      createdAt: iso,
      updatedAt: iso,
    }

    const result = await adapter.commit([{ type: 'addRecord', record }])
    set({ doc: adapter.read(), status: adapter.getStatus() })

    if (!result.applied && !result.queued) {
      get().pushToast('记录失败，请稍后重试', 'error')
    } else if (result.queued) {
      get().pushToast('已保存在本地，联网后会自动同步', 'info')
    }
    return record
  },

  deleteRecord: async (id) => {
    const adapter = get().adapter
    if (!adapter) return
    const nowIso = new Date(adapter.nowMs()).toISOString()
    const result = await adapter.commit([{ type: 'deleteRecord', id, deletedAt: nowIso }])
    set({ doc: adapter.read(), status: adapter.getStatus() })
    if (result.applied || result.queued) {
      get().pushToast('已删除这条记录', 'ok')
    } else {
      get().pushToast('删除失败，请稍后重试', 'error')
    }
  },

  saveChore: async (input) => {
    const adapter = get().adapter
    if (!adapter) return

    const iso = new Date(adapter.nowMs()).toISOString()
    const existing = input.id
      ? adapter.read().meta.chores.find((c) => c.id === input.id)
      : undefined

    const chore: Chore = {
      id: input.id ?? newId(),
      name: input.name.trim(),
      emoji: input.emoji,
      points: input.points,
      difficulty: input.difficulty,
      category: input.category,
      isPreset: existing?.isPreset ?? false,
      enabled: existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? iso,
      updatedAt: iso,
    }

    // 用户手选的图标学下来 —— 以后在另一台手机上也能自动命中
    const settings = adapter.read().meta.settings
    const learnedKey = normalizeName(chore.name)

    const ops = [
      { type: 'upsertChore' as const, chore },
      ...(learnedKey
        ? [
            {
              type: 'putSettings' as const,
              settings: {
                ...settings,
                customEmojiMap: { ...settings.customEmojiMap, [learnedKey]: chore.emoji },
                updatedAt: iso,
              },
            },
          ]
        : []),
    ]

    const result = await adapter.commit(ops)
    set({ doc: adapter.read(), status: adapter.getStatus() })

    if (result.applied || result.queued) {
      get().pushToast(input.id ? '已更新家务' : '已添加家务', 'ok')
    } else {
      get().pushToast('保存失败，请稍后重试', 'error')
    }
  },

  toggleChore: async (id) => {
    const adapter = get().adapter
    if (!adapter) return
    const chore = adapter.read().meta.chores.find((c) => c.id === id)
    if (!chore) return

    const iso = new Date(adapter.nowMs()).toISOString()
    await adapter.commit([
      { type: 'upsertChore', chore: { ...chore, enabled: !chore.enabled, updatedAt: iso } },
    ])
    set({ doc: adapter.read(), status: adapter.getStatus() })
    get().pushToast(chore.enabled ? '已隐藏这项家务' : '已恢复这项家务', 'ok')
  },

  deleteChore: async (id) => {
    const adapter = get().adapter
    if (!adapter) return
    const iso = new Date(adapter.nowMs()).toISOString()
    await adapter.commit([{ type: 'deleteChore', id, deletedAt: iso }])
    set({ doc: adapter.read(), status: adapter.getStatus() })
    get().pushToast('已删除该家务（历史记录不受影响）', 'ok')
  },

  renameMember: async (id, name) => {
    const adapter = get().adapter
    if (!adapter) return
    const member = adapter.read().meta.members.find((m) => m.id === id)
    if (!member) return
    const iso = new Date(adapter.nowMs()).toISOString()
    await adapter.commit([
      { type: 'upsertMember', member: { ...member, name: name.trim() || member.name, updatedAt: iso } },
    ])
    set({ doc: adapter.read(), status: adapter.getStatus() })
    get().pushToast('已保存', 'ok')
  },

  // -------------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------------

  setPeriod: (period) => set({ period }),
  setAnchor: (anchor) => set({ anchor }),

  pushToast: (text, tone = 'info') => {
    const id = newId()
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
    setTimeout(() => get().dismissToast(id), 3200)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/**
 * 把预置目录升到当前版本。
 *
 * 只在版本号落后时才产生操作，所以正常情况下（全新配置、或已经升过级）
 * 这里是一次空跑，不会产生任何写入。
 */
async function applyPresetSync(
  adapter: StorageAdapter,
  pushToast: (text: string, tone?: Toast['tone']) => void,
): Promise<void> {
  const plan = planPresetSync(adapter.read(), new Date(adapter.nowMs()).toISOString())
  if (plan.ops.length === 0) return

  const result = await adapter.commit(plan.ops)

  if (plan.removed.length > 0 && (result.applied || result.queued)) {
    pushToast(
      `预置家务已更新，移除了 ${plan.removed.length} 项（历史积分不受影响）`,
      'info',
    )
  }
}

/** 补录：把某一天的时间定在当天 19:00，避开 00:00 这个夏令时切换的落点 */
function atOnDay(day: DayKey, nowMs: number): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const candidate = new Date(y, m - 1, d, 19, 0, 0, 0)
  // 补录到今天时不要造出「未来时间」
  if (candidate.getTime() > nowMs) return new Date(nowMs)
  return candidate
}

/** 设备标识：两台手机共用同一个 GitHub 账号提交，靠这个区分是谁记的账 */
function deviceId(): string {
  const KEY = 'chore.deviceId'
  try {
    const ls = globalThis.localStorage
    if (!ls) return 'device-unknown'
    const existing = ls.getItem(KEY)
    if (existing) return existing
    const id = newId()
    ls.setItem(KEY, id)
    return id
  } catch {
    return 'device-unknown'
  }
}
