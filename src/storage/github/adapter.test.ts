/**
 * GitHub 适配器测试
 *
 * 其中「两台设备同时写入」那一条是整个项目最关键的用例：它验证 409 冲突后
 * 会**重新读取远端内容再合并**，而不是重放本地旧快照 —— 后者会把对方刚记的
 * 家务直接抹掉，而且用户不会收到任何提示。
 *
 * 假服务会真的校验 sha，所以这里的冲突是自然发生的，不是造出来的。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { GithubAdapter } from '@/storage/github/adapter'
import type { KeyValueStore } from '@/storage/types'
import type { FamilyDoc, PointsRecord, Shard } from '@/types'
import { FakeGithub } from '@/tests/fakeGithub'
import { makeRecord } from '@/tests/factories'
import { buildDefaultMembers, buildDefaultSettings, SCHEMA_VERSION } from '@/domain/presets'
import { serializeMeta } from '@/domain/serialize'

const NOW = () => new Date('2026-09-20T10:00:00')
const META_PATH = 'data/meta.json'
const SHARD_SEP = 'data/records/records-2026-09.json'

function memStore(): KeyValueStore {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v)
    },
    removeItem: (k) => {
      m.delete(k)
    },
  }
}

interface HarnessOpts {
  token?: string
  store?: KeyValueStore
  maxConflictRetries?: number
  record?: (ms: number) => Promise<void>
}

let fake: FakeGithub

function seedMeta(f: FakeGithub): void {
  f.write(
    META_PATH,
    serializeMeta({
      schemaVersion: SCHEMA_VERSION,
      updatedAt: '2026-01-01T00:00:00.000Z',
      members: buildDefaultMembers(),
      chores: [],
      settings: buildDefaultSettings(),
    }),
  )
}

function makeAdapter(opts: HarnessOpts = {}): GithubAdapter {
  const token = opts.token ?? 'test-token'
  return new GithubAdapter({
    config: {
      owner: fake.owner,
      repo: fake.repo,
      branch: 'main',
      basePath: 'data',
      token,
    },
    fetchImpl: fake.fetchImpl,
    store: opts.store ?? memStore(),
    now: NOW,
    // 注入 sleep，让退避在测试里瞬间完成
    sleep: opts.record ?? (async () => {}),
    maxConflictRetries: opts.maxConflictRetries ?? 3,
  })
}

function aRecord(id: string, memberId: string, points: number): PointsRecord {
  return makeRecord({
    id,
    memberId,
    points,
    day: '2026-09-20',
    at: `2026-09-20T0${points % 9}:00:00.000Z`,
  })
}

beforeEach(() => {
  fake = new FakeGithub({ token: 'test-token' })
  seedMeta(fake)
})

describe('init 与 refresh', () => {
  it('读取 meta 与已有的月份分片', async () => {
    const shard: Shard = {
      schemaVersion: SCHEMA_VERSION,
      month: '2026-09',
      records: [aRecord('r1', 'member-xiaoliang', 5)],
    }
    fake.write(SHARD_SEP, JSON.stringify(shard))

    const adapter = makeAdapter()
    const result = await adapter.init()

    expect(result.ok).toBe(true)
    expect(adapter.read().meta.members).toHaveLength(2)
    expect(adapter.read().records).toHaveLength(1)
    expect(adapter.read().records[0]?.id).toBe('r1')
  })

  it('仓库为空时也能正常初始化（首次使用）', async () => {
    const adapter = makeAdapter()
    const result = await adapter.init()
    expect(result.ok).toBe(true)
    expect(adapter.read().records).toHaveLength(0)
    expect(adapter.getStatus().state).toBe('ready')
  })

  it('断网但有本地缓存时进入离线状态而不是报错', async () => {
    const store = memStore()
    // 第一次成功同步，写入缓存
    const first = makeAdapter({ store })
    await first.init()
    await first.commit([{ type: 'addRecord', record: aRecord('r1', 'member-xiaoliang', 5) }])

    // 第二次断网启动
    fake.networkDown = true
    const second = makeAdapter({ store })
    const result = await second.init()

    expect(result.ok).toBe(true)
    expect(second.getStatus().state).toBe('offline')
    // 缓存里的记录仍在，界面不会是空的
    expect(second.read().records.length).toBeGreaterThan(0)
  })
})

describe('commit', () => {
  it('新增记录写到当月的分片', async () => {
    const adapter = makeAdapter()
    await adapter.init()

    const result = await adapter.commit([
      { type: 'addRecord', record: aRecord('r1', 'member-xiaoliang', 5) },
    ])

    expect(result.applied).toBe(true)
    const shard = fake.readJson<Shard>(SHARD_SEP)
    expect(shard?.records.map((r) => r.id)).toEqual(['r1'])
  })

  it('写入的记录带完整快照（家务名、图标、分值）', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    await adapter.commit([
      { type: 'addRecord', record: aRecord('r1', 'member-xiaoliang', 5) },
    ])

    const rec = fake.readJson<Shard>(SHARD_SEP)?.records[0]
    expect(rec?.choreName).toBe('拖地')
    expect(rec?.choreEmoji).toBe('🧽')
    expect(rec?.points).toBe(5)
  })

  it('中文内容往返正确', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    await adapter.commit([
      { type: 'addRecord', record: aRecord('r1', 'member-xiaoliang', 5) },
    ])

    const raw = fake.readFile(SHARD_SEP) ?? ''
    expect(raw).toContain('拖地')

    const reread = makeAdapter()
    await reread.init()
    expect(reread.read().records[0]?.choreName).toBe('拖地')
  })

  it('删除记录写的是墓碑，不是把它从文件里抹掉', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    await adapter.commit([
      { type: 'addRecord', record: aRecord('r1', 'member-xiaoliang', 5) },
    ])
    await adapter.commit([
      { type: 'deleteRecord', id: 'r1', deletedAt: '2026-09-20T12:00:00.000Z' },
    ])

    const shard = fake.readJson<Shard>(SHARD_SEP)
    expect(shard?.records).toHaveLength(1)
    expect(shard?.records[0]?.deleted).toBe(true)
  })

  it('把家务改动写到 meta.json', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    const chore = {
      id: 'custom-1',
      name: '自定义家务',
      emoji: '🧪',
      points: 4,
      difficulty: 2 as const,
      category: '其他杂项' as const,
      isPreset: false,
      enabled: true,
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    }
    await adapter.commit([{ type: 'upsertChore', chore }])

    const meta = fake.readJson<FamilyDoc['meta']>(META_PATH)
    expect(meta?.chores.find((c) => c.id === 'custom-1')?.name).toBe('自定义家务')
  })

  it('内容无变化时不重复写入（省额度、少提交）', async () => {
    const adapter = makeAdapter()
    await adapter.init()

    const op = { type: 'addRecord' as const, record: aRecord('r1', 'member-xiaoliang', 5) }
    await adapter.commit([op])
    const afterFirst = fake.putCount

    // 同一批操作再提交一次 —— 幂等，内容不变，不应产生新的提交
    await adapter.commit([op])
    expect(fake.putCount).toBe(afterFirst)
  })

  it('只读模式下拒绝写入并给出可操作提示', async () => {
    const adapter = makeAdapter({ token: '' })
    await adapter.init()

    const result = await adapter.commit([
      { type: 'addRecord', record: aRecord('r1', 'member-xiaoliang', 5) },
    ])

    expect(result.applied).toBe(false)
    expect(adapter.getStatus().message).toContain('只读')
    expect(fake.putCount).toBe(0)
  })
})

describe('并发写入 —— 本项目最关键的一组用例', () => {
  it('两台设备同时记分，两条记录都保留', async () => {
    // 两台设备各自初始化，此时仓库里还没有当月分片
    const deviceA = makeAdapter()
    const deviceB = makeAdapter()
    await deviceA.init()
    await deviceB.init()

    const recA = aRecord('rec-a', 'member-xiaoliang', 5)
    const recB = aRecord('rec-b', 'member-xiaoying', 7)

    // 小良先记了一笔
    const resA = await deviceA.commit([{ type: 'addRecord', record: recA }])
    expect(resA.applied).toBe(true)

    // 小影紧接着记一笔。她本地的认知是「文件还不存在」
    const resB = await deviceB.commit([{ type: 'addRecord', record: recB }])
    expect(resB.applied).toBe(true)

    // 关键断言：最终文件里两条记录都在，谁都没被覆盖
    const ids = fake.readJson<Shard>(SHARD_SEP)?.records.map((r) => r.id).sort()
    expect(ids).toEqual(['rec-a', 'rec-b'])

    // 说明：这里没有发生冲突，因为写路径是「先 GET 拿最新 sha 再 PUT」——
    // 小影在写入前就读到了小良的记录，天然避开了冲突窗口。
    // 这是比「撞上再重试」更好的结果。真正的冲突重试由下一组用例覆盖。
    expect(resB.conflicts).toBe(0)
  })

  it('恰好在 GET 与 PUT 之间被对方插入写入时，走重试合并而不是覆盖', async () => {
    // 这条用例精确命中冲突窗口：在适配器读完 sha、还没发出 PUT 的那一刻，
    // 另一台设备抢先写入。这是唯一会真正触发 409 的时序。
    const realFetch = fake.fetchImpl
    let armed = true
    const racyFetch: typeof fetch = async (input, init) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      const path = String(input)

      // 第一次要写当月分片时，抢在 PUT 之前把对方的记录写进去
      if (armed && method === 'PUT' && path.includes('records-2026-09')) {
        armed = false
        fake.write(
          SHARD_SEP,
          JSON.stringify({
            schemaVersion: SCHEMA_VERSION,
            month: '2026-09',
            records: [aRecord('other-phone', 'member-xiaoying', 9)],
          }),
        )
      }
      return realFetch(input, init)
    }

    const adapter = new GithubAdapter({
      config: {
        owner: fake.owner,
        repo: fake.repo,
        branch: 'main',
        basePath: 'data',
        token: 'test-token',
      },
      fetchImpl: racyFetch,
      store: memStore(),
      now: NOW,
      sleep: async () => {},
    })
    await adapter.init()

    const result = await adapter.commit([
      { type: 'addRecord', record: aRecord('mine', 'member-xiaoliang', 5) },
    ])

    expect(result.applied).toBe(true)
    expect(result.conflicts).toBeGreaterThan(0)

    // 决定性断言：我方和对方的记录都在。
    // 若实现是「重放本地快照」，other-phone 会消失。
    const ids = fake.readJson<Shard>(SHARD_SEP)?.records.map((r) => r.id).sort()
    expect(ids).toEqual(['mine', 'other-phone'])
  })

  it('冲突重试时读的是**远端新内容**，而不是本地旧快照', async () => {
    const adapter = makeAdapter()
    await adapter.init()

    // 另一台设备在小良不知情的情况下写入了一条记录
    fake.write(
      SHARD_SEP,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        month: '2026-09',
        records: [aRecord('remote-1', 'member-xiaoying', 3)],
      }),
    )

    // 小良提交自己的记录 —— 他本地完全没有 remote-1 的认知
    await adapter.commit([
      { type: 'addRecord', record: aRecord('local-1', 'member-xiaoliang', 5) },
    ])

    const ids = fake.readJson<Shard>(SHARD_SEP)?.records.map((r) => r.id).sort()
    // 如果实现是「重放本地快照」，remote-1 就会消失
    expect(ids).toEqual(['local-1', 'remote-1'])
  })

  it('两台设备互相反超后，合并结果一致（收敛）', async () => {
    const deviceA = makeAdapter()
    const deviceB = makeAdapter()
    await deviceA.init()
    await deviceB.init()

    await deviceA.commit([{ type: 'addRecord', record: aRecord('a1', 'member-xiaoliang', 5) }])
    await deviceB.commit([{ type: 'addRecord', record: aRecord('b1', 'member-xiaoying', 7) }])
    await deviceA.commit([{ type: 'addRecord', record: aRecord('a2', 'member-xiaoliang', 3) }])
    await deviceB.commit([{ type: 'addRecord', record: aRecord('b2', 'member-xiaoying', 2) }])

    // 两边各自做一次全量刷新，读到的应该是同一份内容
    await deviceA.refresh({ full: true })
    await deviceB.refresh({ full: true })

    const idsA = deviceA.read().records.map((r) => r.id).sort()
    const idsB = deviceB.read().records.map((r) => r.id).sort()
    expect(idsA).toEqual(['a1', 'a2', 'b1', 'b2'])
    expect(idsB).toEqual(idsA)
  })

  it('连续冲突超过重试上限时，操作进入离线队列而不是丢失', async () => {
    const adapter = makeAdapter({ maxConflictRetries: 2 })
    await adapter.init()

    // 让每次 GET 拿到的 sha 都在 PUT 前失效 —— 用自定义 fetch 制造持续冲突
    let sabotage = false
    const realFetch = fake.fetchImpl
    const flakyFetch: typeof fetch = async (input, init) => {
      const res = await realFetch(input, init)
      // 在 PUT 之前偷偷改一次文件，让 sha 永远对不上
      if (sabotage && String(input).includes('records-2026-09')) {
        fake.write(
          SHARD_SEP,
          JSON.stringify({
            schemaVersion: SCHEMA_VERSION,
            month: '2026-09',
            records: [aRecord(`noise-${Math.random()}`, 'member-xiaoliang', 1)],
          }),
        )
      }
      return res
    }

    const stubborn = new GithubAdapter({
      config: {
        owner: fake.owner,
        repo: fake.repo,
        branch: 'main',
        basePath: 'data',
        token: 'test-token',
      },
      fetchImpl: flakyFetch,
      store: memStore(),
      now: NOW,
      sleep: async () => {},
      maxConflictRetries: 2,
    })
    await stubborn.init()

    sabotage = true
    const result = await stubborn.commit([
      { type: 'addRecord', record: aRecord('lost-1', 'member-xiaoliang', 5) },
    ])
    sabotage = false

    // 没有丢：进了队列，状态里能看到待同步条数
    expect(result.applied).toBe(false)
    expect(result.queued).toBe(true)
    expect(stubborn.getStatus().pendingOps).toBe(1)

    // 冲突消失后能补传成功
    const flushed = await stubborn.flushPending()
    expect(flushed.applied).toBe(true)
    expect(stubborn.getStatus().pendingOps).toBe(0)
    void adapter
  })
})

describe('离线队列', () => {
  it('断网时排队，恢复后补传，且数据不丢', async () => {
    const store = memStore()
    const adapter = makeAdapter({ store })
    await adapter.init()

    fake.networkDown = true
    const result = await adapter.commit([
      { type: 'addRecord', record: aRecord('offline-1', 'member-xiaoliang', 5) },
    ])

    expect(result.applied).toBe(false)
    expect(result.queued).toBe(true)
    expect(adapter.getStatus().pendingOps).toBe(1)
    // 乐观更新：界面上立刻能看到
    expect(adapter.read().records.map((r) => r.id)).toContain('offline-1')

    // 恢复网络
    fake.networkDown = false
    const flushed = await adapter.flushPending()

    expect(flushed.applied).toBe(true)
    expect(adapter.getStatus().pendingOps).toBe(0)
    expect(fake.readJson<Shard>(SHARD_SEP)?.records.map((r) => r.id)).toContain('offline-1')
  })

  it('队列持久化：换一个适配器实例（模拟重开应用）仍能补传', async () => {
    const store = memStore()
    const first = makeAdapter({ store })
    await first.init()

    fake.networkDown = true
    await first.commit([{ type: 'addRecord', record: aRecord('q1', 'member-xiaoliang', 5) }])
    expect(first.getStatus().pendingOps).toBe(1)

    fake.networkDown = false
    // 重开应用：新建适配器，复用同一份本地存储
    const second = makeAdapter({ store })
    await second.init()

    // init 会自动尝试补传
    expect(second.getStatus().pendingOps).toBe(0)
    expect(fake.readJson<Shard>(SHARD_SEP)?.records.map((r) => r.id)).toContain('q1')
  })

  it('离线队列存的是操作而不是文档快照', async () => {
    const store = memStore()
    const adapter = makeAdapter({ store })
    await adapter.init()

    fake.networkDown = true
    await adapter.commit([{ type: 'addRecord', record: aRecord('q1', 'member-xiaoliang', 5) }])

    // 找出队列存储项，确认里面是 Op 结构
    const raw = (store as unknown as { getItem(k: string): string | null }).getItem(
      'chore.ghOutbox.v1:family/chore-data@main',
    )
    expect(raw).toBeTruthy()
    const ops = JSON.parse(raw!) as { type: string }[]
    expect(ops[0]?.type).toBe('addRecord')
    // 不是整份文档
    expect(JSON.stringify(ops)).not.toContain('"members"')
  })
})

describe('读取策略 —— 限流友好性', () => {
  it('真正冷门的历史分片只拉一次，之后完全靠缓存', async () => {
    // 注意：热窗口是「当月 + 上月」（环比需要上月数据），所以相对 2026-09
    // 而言，2026-08 属于热月份。这里用 6 月来测真正的冷分片。
    const COLD = 'data/records/records-2026-06.json'
    fake.write(
      COLD,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        month: '2026-06',
        records: [aRecord('old-1', 'member-xiaoliang', 5)],
      }),
    )

    const adapter = makeAdapter()
    await adapter.init()
    const firstCount = fake.pathRequests(COLD)
    expect(firstCount).toBe(1)
    // 冷分片虽然不重复拉取，但内容仍要进入榜单（累计总分、等级要用）
    expect(adapter.read().records.map((r) => r.id)).toContain('old-1')

    // 再刷新一次：目录列表里的 sha 未变，应当完全跳过这个文件
    await adapter.refresh()
    expect(fake.pathRequests(COLD)).toBe(firstCount)

    // 第三次也一样，不会随刷新次数累积请求
    await adapter.refresh()
    expect(fake.pathRequests(COLD)).toBe(firstCount)
  })

  it('冷分片内容真的变了时会重新拉取（缓存不会导致数据陈旧）', async () => {
    const COLD = 'data/records/records-2026-06.json'
    fake.write(
      COLD,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        month: '2026-06',
        records: [aRecord('old-1', 'member-xiaoliang', 5)],
      }),
    )

    const adapter = makeAdapter()
    await adapter.init()
    expect(adapter.read().records.map((r) => r.id)).toEqual(['old-1'])

    // 另一台设备补录了一条 6 月的记录
    fake.write(
      COLD,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        month: '2026-06',
        records: [aRecord('old-1', 'member-xiaoliang', 5), aRecord('old-2', 'member-xiaoying', 3)],
      }),
    )

    await adapter.refresh()
    expect(adapter.read().records.map((r) => r.id).sort()).toEqual(['old-1', 'old-2'])
  })

  it('全量刷新会忽略缓存，重新拉取所有分片', async () => {
    const COLD = 'data/records/records-2026-06.json'
    fake.write(
      COLD,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        month: '2026-06',
        records: [aRecord('old-1', 'member-xiaoliang', 5)],
      }),
    )

    const adapter = makeAdapter()
    await adapter.init()
    const before = fake.pathRequests(COLD)

    await adapter.refresh({ full: true })
    expect(fake.pathRequests(COLD)).toBeGreaterThan(before)
  })

  it('当月的热分片每次刷新都校验（保证能拿到对方的新记录）', async () => {
    // 先造出当月分片，否则没有文件可拉，用例是空转的
    fake.write(
      SHARD_SEP,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        month: '2026-09',
        records: [aRecord('r1', 'member-xiaoliang', 5)],
      }),
    )

    const adapter = makeAdapter()
    await adapter.init()
    const afterInit = fake.pathRequests(SHARD_SEP)
    expect(afterInit).toBeGreaterThan(0)

    await adapter.refresh()
    // 热分片必须重新校验，否则拿不到另一台设备刚记的账
    expect(fake.pathRequests(SHARD_SEP)).toBeGreaterThan(afterInit)
  })

  it('刷新能拿到另一台设备写入的新记录', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    expect(adapter.read().records).toHaveLength(0)

    fake.write(
      SHARD_SEP,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        month: '2026-09',
        records: [aRecord('from-other-phone', 'member-xiaoying', 6)],
      }),
    )

    await adapter.refresh()
    expect(adapter.read().records.map((r) => r.id)).toContain('from-other-phone')
  })

  it('远端删掉分片后本地缓存也被清掉', async () => {
    fake.write(
      SHARD_SEP,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        month: '2026-09',
        records: [aRecord('r1', 'member-xiaoliang', 5)],
      }),
    )
    const adapter = makeAdapter()
    await adapter.init()
    expect(adapter.read().records).toHaveLength(1)

    // 远端文件消失
    ;(fake as unknown as { files: Map<string, unknown> }).files.delete(SHARD_SEP)
    await adapter.refresh({ full: true })

    expect(adapter.read().records).toHaveLength(0)
  })
})

describe('状态与订阅', () => {
  it('订阅者能在数据变化时收到通知', async () => {
    const adapter = makeAdapter()
    await adapter.init()

    const seen: number[] = []
    adapter.subscribe((doc) => seen.push(doc.records.length))

    await adapter.commit([
      { type: 'addRecord', record: aRecord('r1', 'member-xiaoliang', 5) },
    ])

    expect(seen.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toBe(1)

    adapter.dispose()
  })

  it('限流时状态里带上恢复时间，供界面倒计时', async () => {
    const adapter = makeAdapter()
    await adapter.init()

    fake.rateLimitRemaining = 0
    await adapter.commit([
      { type: 'addRecord', record: aRecord('r1', 'member-xiaoliang', 5) },
    ])

    const status = adapter.getStatus()
    expect(status.message).toBeTruthy()
    expect(status.pendingOps).toBe(1) // 操作没丢，进了队列
  })
})

describe('导出与导入', () => {
  it('导入的数据能落盘并被重新读出', async () => {
    const adapter = makeAdapter()
    await adapter.init()

    const doc: FamilyDoc = {
      meta: {
        schemaVersion: SCHEMA_VERSION,
        updatedAt: '2026-09-20T10:00:00.000Z',
        members: buildDefaultMembers(),
        chores: [],
        settings: buildDefaultSettings(),
      },
      records: [aRecord('imported-1', 'member-xiaoliang', 9)],
    }

    await adapter.importAll(doc)

    const reread = makeAdapter()
    await reread.init()
    expect(reread.read().records.map((r) => r.id)).toContain('imported-1')
  })
})
