/**
 * 适配器契约测试
 *
 * 同一套行为断言，跑在内存适配器与 GitHub 适配器（假服务）上。
 *
 * 本机存储已经去掉了 —— 需求是「两台手机读写同一份」，本机存储做不到这件事。
 * 但契约测试仍然有价值：两个适配器实现同一个接口，这一套断言保证它们的行为
 * **不会各自漂移**。GitHub 适配器另有自己的套件，覆盖网络、冲突、离线队列等
 * 内存适配器不存在的语义。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '@/storage/memory'
import { GithubAdapter } from '@/storage/github/adapter'
import type { KeyValueStore, StorageAdapter } from '@/storage/types'
import { FakeGithub } from '@/tests/fakeGithub'
import { rangeOf } from '@/domain/time'
import { buildDefaultMembers, PRESET_DEF_COUNT } from '@/domain/presets'
import { makeChore, makeRecord } from '@/tests/factories'

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

let fake: FakeGithub

function makeGithub(store: KeyValueStore): StorageAdapter {
  return new GithubAdapter({
    config: {
      owner: fake.owner,
      repo: fake.repo,
      branch: 'main',
      basePath: 'data',
      token: 'test-token',
    },
    fetchImpl: fake.fetchImpl,
    store,
    now: () => new Date('2026-09-20T10:00:00'),
    sleep: async () => {},
  })
}

interface Variant {
  name: string
  make: (store: KeyValueStore) => StorageAdapter
  /** 能否在新实例上读回旧数据（内存适配器天然做不到） */
  persistent: boolean
  /** 该实现声明的能力 —— 每个适配器不一样，所以不放在共享断言里 */
  capabilities: {
    multiDevice: boolean
    needsToken: boolean
    offlineQueue: boolean
  }
}

const VARIANTS: Variant[] = [
  {
    name: 'MemoryAdapter',
    make: () => new MemoryAdapter(),
    persistent: false,
    // 内存适配器只用于测试与演示，不跨设备
    capabilities: { multiDevice: false, needsToken: false, offlineQueue: false },
  },
  {
    name: 'GithubAdapter',
    make: (store) => makeGithub(store),
    persistent: true,
    capabilities: { multiDevice: true, needsToken: true, offlineQueue: true },
  },
]

beforeEach(() => {
  fake = new FakeGithub({ token: 'test-token' })
})

for (const variant of VARIANTS) {
  describe(`契约：${variant.name}`, () => {
    it('初始化后可用', async () => {
      const a = variant.make(memStore())
      const result = await a.init()
      expect(result.ok).toBe(true)
      expect(a.getStatus().kind).toBeTruthy()
    })

    it('初次使用能拿到成员、预置家务与设置', async () => {
      const a = variant.make(memStore())
      await a.init()
      const doc = a.read()
      expect(doc.meta.members.length).toBeGreaterThan(0)
      expect(doc.meta.chores.length).toBe(PRESET_DEF_COUNT)
      expect(doc.meta.settings).toBeDefined()
      expect(doc.records).toEqual([])
    })

    it('新增记录后能读回来，且带完整快照', async () => {
      const a = variant.make(memStore())
      await a.init()

      const result = await a.commit([
        { type: 'addRecord', record: makeRecord({ id: 'r1', points: 5 }) },
      ])
      expect(result.applied).toBe(true)

      const back = a.read().records.find((r) => r.id === 'r1')
      expect(back?.points).toBe(5)
      expect(back?.choreName).toBe('拖地')
      expect(back?.choreEmoji).toBe('🧽')
    })

    it('持久化：新建实例能读到之前写入的数据', async () => {
      if (!variant.persistent) return // 内存适配器不跨实例持久化，跳过

      const store = memStore()
      const first = variant.make(store)
      await first.init()
      await first.commit([{ type: 'addRecord', record: makeRecord({ id: 'persisted' }) }])

      const second = variant.make(store)
      await second.init()
      expect(second.read().records.map((r) => r.id)).toContain('persisted')
    })

    it('删除记录写墓碑而不是抹掉', async () => {
      const a = variant.make(memStore())
      await a.init()
      await a.commit([{ type: 'addRecord', record: makeRecord({ id: 'r1' }) }])
      await a.commit([
        { type: 'deleteRecord', id: 'r1', deletedAt: '2026-09-20T12:00:00.000Z' },
      ])

      const rec = a.read().records.find((r) => r.id === 'r1')
      expect(rec).toBeDefined()
      expect(rec?.deleted).toBe(true)
    })

    it('删除后该记录不再出现在区间查询里', async () => {
      const a = variant.make(memStore())
      await a.init()
      const range = rangeOf('day', '2026-09-20')
      await a.commit([
        { type: 'addRecord', record: makeRecord({ id: 'r1', day: '2026-09-20' }) },
      ])
      expect(a.readRecords(range)).toHaveLength(1)

      await a.commit([
        { type: 'deleteRecord', id: 'r1', deletedAt: '2026-09-20T12:00:00.000Z' },
      ])
      expect(a.readRecords(range)).toHaveLength(0)
    })

    it('新增自定义家务', async () => {
      const a = variant.make(memStore())
      await a.init()
      const before = a.read().meta.chores.length

      await a.commit([
        { type: 'upsertChore', chore: makeChore({ id: 'custom-1', name: '擦黑板' }) },
      ])

      expect(a.read().meta.chores).toHaveLength(before + 1)
      expect(a.read().meta.chores.find((c) => c.id === 'custom-1')?.name).toBe('擦黑板')
    })

    it('区间查询只返回范围内的记录', async () => {
      const a = variant.make(memStore())
      await a.init()
      await a.commit([
        { type: 'addRecord', record: makeRecord({ id: 'in', day: '2026-09-20' }) },
        { type: 'addRecord', record: makeRecord({ id: 'out', day: '2026-08-01' }) },
      ])
      const got = a.readRecords(rangeOf('day', '2026-09-20')).map((r) => r.id)
      expect(got).toEqual(['in'])
    })

    it('订阅者能收到变更通知', async () => {
      const a = variant.make(memStore())
      await a.init()
      let calls = 0
      const unsub = a.subscribe(() => {
        calls++
      })
      await a.commit([{ type: 'addRecord', record: makeRecord({ id: 'r1' }) }])
      expect(calls).toBeGreaterThan(0)
      unsub()
    })

    it('dispose 之后不再回调订阅者', async () => {
      const a = variant.make(memStore())
      await a.init()
      let calls = 0
      a.subscribe(() => {
        calls++
      })
      a.dispose()
      await a.commit([{ type: 'addRecord', record: makeRecord({ id: 'r1' }) }])
      expect(calls).toBe(0)
    })

    it('导出后再导入，记录不丢', async () => {
      const source = variant.make(memStore())
      await source.init()
      await source.commit([
        { type: 'addRecord', record: makeRecord({ id: 'exported', points: 7 }) },
      ])
      const dump = await source.exportAll()

      const target = variant.make(memStore())
      await target.init()
      await target.importAll(dump)

      expect(target.read().records.map((r) => r.id)).toContain('exported')
    })

    it('连续多次提交，记录累积而不互相覆盖', async () => {
      const a = variant.make(memStore())
      await a.init()
      for (let i = 0; i < 5; i++) {
        await a.commit([{ type: 'addRecord', record: makeRecord({ id: `r${i}` }) }])
      }
      expect(a.read().records).toHaveLength(5)
    })

    it('批量提交一批操作是一次原子写入', async () => {
      const a = variant.make(memStore())
      await a.init()
      const members = buildDefaultMembers()
      const result = await a.commit([
        { type: 'addRecord', record: makeRecord({ id: 'b1', memberId: members[0]!.id }) },
        { type: 'addRecord', record: makeRecord({ id: 'b2', memberId: members[1]!.id }) },
        { type: 'upsertChore', chore: makeChore({ id: 'c1' }) },
      ])
      expect(result.applied).toBe(true)
      expect(a.read().records).toHaveLength(2)
      expect(a.read().meta.chores.some((c) => c.id === 'c1')).toBe(true)
    })

    it('能力声明与实际用途一致', async () => {
      const a = variant.make(memStore())
      await a.init()
      expect(a.capabilities.multiDevice).toBe(variant.capabilities.multiDevice)
      expect(a.capabilities.needsToken).toBe(variant.capabilities.needsToken)
      expect(a.capabilities.offlineQueue).toBe(variant.capabilities.offlineQueue)
    })
  })
}
