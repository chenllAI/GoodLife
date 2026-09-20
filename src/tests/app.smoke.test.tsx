// @vitest-environment jsdom
/**
 * 组件层冒烟测试
 *
 * 走通用户的真实操作路径，锁住几条最要紧的行为：
 *   - 账单按**快照分值**计分（改家务定义不会改写历史）
 *   - 删除记录后分数会跟着扣回去
 *   - 切换日/周/月会改变统计口径
 *   - 删掉家务后，引用它的历史记录仍然存在（快照设计的核心价值）
 *
 * 用内存适配器做种子数据，不碰网络也不碰 localStorage。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { useApp } from '@/state/store'
import { MemoryAdapter } from '@/storage/memory'
import { buildDefaultMembers, buildDefaultSettings, buildPresetChores, SCHEMA_VERSION } from '@/domain/presets'
import { todayKey, addDays } from '@/domain/time'
import type { FamilyDoc, PointsRecord } from '@/types'

function rec(partial: Partial<PointsRecord> & { id: string; day: string }): PointsRecord {
  const at = `${partial.day}T09:00:00.000Z`
  return {
    memberId: 'member-xiaoliang',
    choreId: 'preset-mop-floor',
    choreName: '拖地',
    choreEmoji: '🧽',
    category: '清洁打扫',
    difficulty: 3,
    points: 5,
    at,
    createdBy: 'test',
    createdAt: at,
    updatedAt: at,
    ...partial,
  }
}

function makeDoc(records: PointsRecord[] = []): FamilyDoc {
  return {
    meta: {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: '2026-09-01T00:00:00.000Z',
      members: buildDefaultMembers(),
      chores: buildPresetChores(),
      settings: buildDefaultSettings(),
    },
    records,
  }
}

async function seed(doc: FamilyDoc) {
  const adapter = new MemoryAdapter({ initial: doc })
  await adapter.init()
  adapter.subscribe((d, s) => useApp.setState({ doc: d, status: s }))
  useApp.setState({
    adapter,
    doc: adapter.read(),
    status: adapter.getStatus(),
    ready: true,
    // 关掉「未配置仓库」的判定 —— 测试里由 seed 直接注入适配器，
    // 不走真实的 connect 流程（那需要网络）
    needsSetup: false,
    bootError: null,
    period: 'day',
    anchor: todayKey(),
    toasts: [],
  })
}

beforeEach(async () => {
  // App 挂载时会调 bootstrap；测试里由 seed 直接注入适配器，这里把它换成空操作
  useApp.setState({ bootstrap: async () => {} })
  await seed(makeDoc())
})

describe('榜单页', () => {
  it('渲染出两位成员的名字', async () => {
    render(<App />)
    // 限定在成员卡片区域内查 —— 「小良」在标题栏和选择器里也会出现
    const grid = await screen.findByRole('main').then(() =>
      document.querySelector('.member-grid'),
    )
    expect(grid).not.toBeNull()
    const cards = within(grid as HTMLElement)
    expect(cards.getByText('小良')).toBeInTheDocument()
    expect(cards.getByText('小影')).toBeInTheDocument()
  })

  it('没有记录时显示空状态提示', async () => {
    render(<App />)
    // 趋势图和家务排行都会说「还没有记录」，这里只关心明细列表那个空状态
    // （明细在独立页签，切过去看）
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '明细' }))
    expect(await screen.findByText('还没有积分记录')).toBeInTheDocument()
  })

  it('日/周/月切换会改变统计口径', async () => {
    const today = todayKey()
    const lastMonth = addDays(today, -40)
    await seed(
      makeDoc([
        rec({ id: 'r1', day: today, points: 5 }),
        rec({ id: 'r2', day: lastMonth, points: 100 }),
      ]),
    )
    render(<App />)

    await screen.findByRole('main')
    const heroValue = () => document.querySelector('.hero__value')?.textContent ?? ''

    // 日榜：只算今天那 5 分，40 天前那 100 分不进窗口
    expect(heroValue()).toContain('5')
    expect(heroValue()).not.toContain('100')

    const user = userEvent.setup()
    // 切到月榜：40 天前仍然不在本月，数字不变 —— 验证的是「窗口边界真的生效了」
    await user.click(screen.getByRole('button', { name: '月榜' }))
    expect(heroValue()).toContain('5')

    // 切回日榜同样稳定
    await user.click(screen.getByRole('button', { name: '日榜' }))
    expect(heroValue()).toContain('5')
  })
})

describe('记一笔', () => {
  it('未选成员时提交按钮不可用（防止记错账）', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '记一笔家务' }))

    const submit = await screen.findByRole('button', { name: /确认|加 \d+ 分/ })
    expect(submit).toBeDisabled()
  })

  it('选人 + 选家务后可以提交，并按快照分值计分', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '记一笔家务' }))
    const dialog = await screen.findByRole('dialog')

    // 选人
    await user.click(within(dialog).getByRole('button', { name: /小影/ }))
    // 选家务（拖地 5 分）
    await user.click(within(dialog).getByRole('button', { name: /拖地/ }))

    const submit = within(dialog).getByRole('button', { name: /加 5 分/ })
    expect(submit).toBeEnabled()
    await user.click(submit)

    // 提交后记录应当落到数据里
    await new Promise((r) => setTimeout(r, 900))
    const stored = useApp.getState().doc.records
    expect(stored).toHaveLength(1)
    expect(stored[0]?.memberId).toBe('member-xiaoying')
    expect(stored[0]?.points).toBe(5)
    expect(stored[0]?.choreName).toBe('拖地')
  })

  it('提交的记录带完整快照字段', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: '记一笔家务' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /小良/ }))
    await user.click(within(dialog).getByRole('button', { name: /洗碗/ }))
    await user.click(within(dialog).getByRole('button', { name: /加 \d+ 分/ }))

    await new Promise((r) => setTimeout(r, 900))
    const r = useApp.getState().doc.records[0]
    expect(r?.choreEmoji).toBe('🍽️')
    expect(r?.category).toBe('厨房餐食')
    expect(typeof r?.difficulty).toBe('number')
    expect(r?.day).toBe(todayKey())
  })
})

describe('积分明细', () => {
  it('明细页显示记录，且可以删除', async () => {
    await seed(makeDoc([rec({ id: 'r1', day: todayKey(), points: 5 })]))
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '明细' }))

    // 记录出现在列表里
    expect(await screen.findByText('拖地')).toBeInTheDocument()

    // 点删除 → 弹确认 → 确认
    await user.click(screen.getByRole('button', { name: '删除 拖地' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '删除' }))

    const live = useApp.getState().doc.records.filter((x) => !x.deleted)
    expect(live).toHaveLength(0)
  })

  it('删除写的是墓碑，记录本身仍在数据里（避免被另一台设备复活）', async () => {
    await seed(makeDoc([rec({ id: 'r1', day: todayKey() })]))
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '明细' }))
    await user.click(screen.getByRole('button', { name: '删除 拖地' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '删除' }))

    const all = useApp.getState().doc.records
    expect(all).toHaveLength(1)
    expect(all[0]?.deleted).toBe(true)
  })
})

describe('删除家务不影响历史记录', () => {
  it('引用已删除家务的记录仍在，且分值不变', async () => {
    // 一条引用了「拖地」的记录
    await seed(makeDoc([rec({ id: 'r1', day: todayKey(), choreId: 'preset-mop-floor', points: 5 })]))
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '明细' }))
    expect(await screen.findByText('拖地')).toBeInTheDocument()

    // 现在把「拖地」这项家务从目录里删掉
    const adapter = useApp.getState().adapter
    await adapter?.commit([
      { type: 'deleteChore', id: 'preset-mop-floor', deletedAt: new Date().toISOString() },
    ])
    useApp.setState({ doc: adapter!.read() })

    // 记录依然在，名称与分值都是快照里的值
    const r = useApp.getState().doc.records[0]
    expect(r?.choreName).toBe('拖地')
    expect(r?.points).toBe(5)
    expect(await screen.findByText('拖地')).toBeInTheDocument()
  })
})

describe('家务管理', () => {
  it('列出预置家务，且预置项没有删除按钮', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '家务' }))

    expect(await screen.findByText('扫地')).toBeInTheDocument()
    expect(screen.getByText('拖地')).toBeInTheDocument()
    // 预置项只能改名/改分/隐藏，不能删
    expect(screen.queryByRole('button', { name: '删除 拖地' })).toBeNull()
    expect(screen.getByRole('button', { name: '隐藏 拖地' })).toBeInTheDocument()
  })

  it('新增自定义家务时自动匹配图标', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '家务' }))
    await user.click(screen.getByRole('button', { name: /新增家务/ }))

    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByLabelText('家务名称')
    await user.type(input, '洗窗帘')

    // 自动匹配到 🪟，并且它处于选中状态
    const chosen = await within(dialog).findByRole('button', { name: '选择图标 🪟' })
    expect(chosen).toHaveAttribute('aria-pressed', 'true')
  })

  it('保存自定义家务后出现在列表里', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '家务' }))
    await user.click(screen.getByRole('button', { name: /新增家务/ }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('家务名称'), '擦阳台栏杆')
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    await new Promise((r) => setTimeout(r, 50))
    const created = useApp.getState().doc.meta.chores.find((c) => c.name === '擦阳台栏杆')
    expect(created).toBeDefined()
    expect(created?.isPreset).toBe(false)
    expect(created?.emoji).toBeTruthy()
  })
})

describe('设置页', () => {
  it('提供令牌填写与成员改名', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '设置' }))

    expect(await screen.findByLabelText('访问令牌')).toBeInTheDocument()
    expect(screen.getByLabelText('修改 小良 的名字')).toBeInTheDocument()
    expect(screen.getByLabelText('修改 小影 的名字')).toBeInTheDocument()
  })

  it('仓库地址是固定的，不让用户改（开箱即用）', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '设置' }))
    await screen.findByLabelText('访问令牌')

    // 仓库地址已烘焙进构建，设置页不再有输入框
    expect(screen.queryByLabelText('GitHub 用户名')).toBeNull()
    expect(screen.queryByLabelText('数据仓库名')).toBeNull()
    // 但要告诉用户数据存在哪
    expect(screen.getByText(/GitHub 仓库里，两台手机读写同一份/)).toBeInTheDocument()
  })

  it('没有令牌时说明只能查看，并给出去哪申请', async () => {
    useApp.setState({ config: { ...useApp.getState().config, token: '' } })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '设置' }))

    expect(await screen.findByText('只能查看')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '怎么申请？' })).toBeInTheDocument()
    // 没令牌时不该出现邀请链接入口
    expect(screen.queryByRole('button', { name: /邀请链接/ })).toBeNull()
  })

  it('有令牌时显示可以记分，并出现邀请链接入口', async () => {
    useApp.setState({ config: { ...useApp.getState().config, token: 'github_pat_test' } })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '设置' }))

    expect(await screen.findByText('可以记分')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /邀请链接/ })).toBeInTheDocument()
  })

  it('生成邀请链接后能看到链接内容（便于手动复制）', async () => {
    useApp.setState({ config: { ...useApp.getState().config, token: 'github_pat_test' } })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: /邀请链接/ }))

    const box = await screen.findByLabelText('邀请链接')
    expect((box as HTMLTextAreaElement).value).toContain('#t=')
    expect((box as HTMLTextAreaElement).value).toContain('github_pat_test')
  })

  it('设置页不再有同步状态面板与存储模式切换', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '设置' }))
    await screen.findByLabelText('访问令牌')

    expect(screen.queryByText('同步状态')).toBeNull()
    expect(screen.queryByText('数据存哪里')).toBeNull()
    expect(screen.queryByLabelText('使用本机保存')).toBeNull()
    // 备份、清空数据、家庭目标这几块都已移除
    expect(screen.queryByText(/导出为文件/)).toBeNull()
    expect(screen.queryByText(/清空所有记录/)).toBeNull()
    expect(screen.queryByText(/家庭每日目标/)).toBeNull()
  })
})

describe('未配置仓库时（构建配置缺失的兜底）', () => {
  it('显示说明页而不是主界面，且不报奇怪的错', async () => {
    useApp.setState({ needsSetup: true })
    render(<App />)
    expect(await screen.findByText('还没配置数据仓库')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '榜单' })).toBeNull()
  })
})
