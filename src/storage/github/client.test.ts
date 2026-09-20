/**
 * GitHub 客户端测试
 *
 * 重点是**错误分流**：401 / 403+限流 / 404 / 409 / 422 各自要映射成正确的类型化
 * 错误。因为 409 既可能是版本冲突也可能是 base64 编码错误，靠字符串匹配分流
 * 非常不可靠 —— 这里逐条锁定行为。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { GithubClient } from '@/storage/github/client'
import {
  AuthError,
  ConflictError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '@/storage/types'
import { FakeGithub } from '@/tests/fakeGithub'

const META_PATH = 'data/meta.json'

function makeClient(
  fake: FakeGithub,
  overrides: Partial<{ token: string; owner: string; repo: string }> = {},
) {
  return new GithubClient({
    owner: overrides.owner ?? fake.owner,
    repo: overrides.repo ?? fake.repo,
    branch: 'main',
    token: overrides.token ?? 'test-token',
    fetchImpl: fake.fetchImpl,
  })
}

let fake: FakeGithub

beforeEach(() => {
  fake = new FakeGithub({ token: 'test-token' })
})

describe('getFile', () => {
  it('读到内容并正确解码中文（btoa 做不到这件事）', async () => {
    const payload = { name: '小良', chore: '拖地🧽' }
    fake.write(META_PATH, JSON.stringify(payload))

    const res = await makeClient(fake).getFile<typeof payload>(META_PATH)
    expect(res.kind).toBe('ok')
    if (res.kind !== 'ok') return
    expect(res.data).toEqual(payload)
    expect(res.sha).toBeTruthy()
    expect(res.etag).toBeTruthy()
  })

  it('文件不存在时返回 missing 而不是抛错', async () => {
    const res = await makeClient(fake).getFile('data/nope.json')
    expect(res.kind).toBe('missing')
  })

  it('带上未变化的 ETag 时返回 notModified，不传输正文', async () => {
    fake.write(META_PATH, JSON.stringify({ v: 1 }))
    const client = makeClient(fake)

    const first = await client.getFile(META_PATH)
    expect(first.kind).toBe('ok')
    if (first.kind !== 'ok') return

    const second = await client.getFile(META_PATH, first.etag)
    expect(second.kind).toBe('notModified')
  })

  it('路径指向目录时抛出可读错误（目录返回数组而非对象）', async () => {
    fake.write('data/records/records-2026-09.json', '{}')
    await expect(makeClient(fake).getFile('data/records')).rejects.toThrow(ValidationError)
    await expect(makeClient(fake).getFile('data/records')).rejects.toThrow(/目录/)
  })

  it('内容不是合法 JSON 时抛出 ValidationError', async () => {
    fake.write(META_PATH, 'this is not json {{{')
    await expect(makeClient(fake).getFile(META_PATH)).rejects.toThrow(ValidationError)
  })

  it('请求头发送 Authorization，且**不发送** X-GitHub-Api-Version', async () => {
    fake.write(META_PATH, '{}')
    await makeClient(fake).getFile(META_PATH)

    const req = fake.requests.find((r) => r.path === META_PATH)
    expect(req?.headers['Authorization']).toBe('Bearer test-token')
    // 这个头不在 CORS 白名单里，发了会被浏览器预检拦下
    expect(req?.headers['X-GitHub-Api-Version']).toBeUndefined()
  })

  it('未配置 Token 时不发送 Authorization（只读匿名读公开仓库）', async () => {
    const anon = new FakeGithub({ token: null })
    anon.write(META_PATH, '{}')
    await makeClient(anon, { token: '' }).getFile(META_PATH)

    const req = anon.requests.find((r) => r.path === META_PATH)
    expect(req?.headers['Authorization']).toBeUndefined()
  })

  it('仓库名写错时返回 missing 的语义由调用方区分（404）', async () => {
    const client = makeClient(fake, { repo: 'wrong-repo' })
    const res = await client.getFile(META_PATH)
    expect(res.kind).toBe('missing')
  })
})

describe('putFile', () => {
  it('创建新文件：不带 sha → 201', async () => {
    const client = makeClient(fake)
    const result = await client.putFile(META_PATH, { v: 1 }, { message: '创建', sha: null })
    expect(result.commitSha).toBeTruthy()
    expect(fake.readJson(META_PATH)).toEqual({ v: 1 })
  })

  it('更新已有文件：带上正确的 sha → 200', async () => {
    fake.write(META_PATH, JSON.stringify({ v: 1 }))
    const current = await makeClient(fake).getFile(META_PATH)
    if (current.kind !== 'ok') throw new Error('前置条件失败')

    await makeClient(fake).putFile(META_PATH, { v: 2 }, { message: '更新', sha: current.sha })
    expect(fake.readJson(META_PATH)).toEqual({ v: 2 })
  })

  it('sha 过期 → ConflictError', async () => {
    fake.write(META_PATH, JSON.stringify({ v: 1 }))
    const client = makeClient(fake)
    const current = await client.getFile(META_PATH)
    if (current.kind !== 'ok') throw new Error('前置条件失败')

    // 另一台设备在此期间改了内容
    fake.write(META_PATH, JSON.stringify({ v: 99 }))

    await expect(
      client.putFile(META_PATH, { v: 2 }, { message: '更新', sha: current.sha }),
    ).rejects.toThrow(ConflictError)
  })

  it('已存在文件却不带 sha → 也判为冲突（真实 GitHub 未写明 409 还是 422）', async () => {
    fake.write(META_PATH, JSON.stringify({ v: 1 }))
    // missingShaStatus 默认 409
    await expect(
      makeClient(fake).putFile(META_PATH, { v: 2 }, { message: '更新', sha: null }),
    ).rejects.toThrow(ConflictError)
  })

  it('422 且消息里提到 sha 时也判为冲突（可重试），而不是参数错误', async () => {
    const throwing = new FakeGithub({ token: 'test-token', missingShaStatus: 422 })
    throwing.write(META_PATH, JSON.stringify({ v: 1 }))
    await expect(
      makeClient(throwing).putFile(META_PATH, { v: 2 }, { message: '更新', sha: null }),
    ).rejects.toThrow(ConflictError)
  })

  it('内容里的中文能正确写入（base64 编码路径正确）', async () => {
    const payload = { members: ['小良', '小影'], emoji: '🧹🧽' }
    await makeClient(fake).putFile(META_PATH, payload, { message: '写中文', sha: null })
    expect(fake.readJson(META_PATH)).toEqual(payload)
  })

  it('只读模式（无 Token）下拒绝写入并给出可操作的提示', async () => {
    const anon = new FakeGithub({ token: null })
    const client = makeClient(anon, { token: '' })
    await expect(
      client.putFile(META_PATH, { v: 1 }, { message: '写', sha: null }),
    ).rejects.toThrow(AuthError)
    await expect(
      client.putFile(META_PATH, { v: 1 }, { message: '写', sha: null }),
    ).rejects.toThrow(/只读模式/)
  })
})

describe('错误分流', () => {
  it('401 → AuthError（不可重试）', async () => {
    fake.write(META_PATH, '{}')
    const client = makeClient(fake, { token: 'wrong-token' })
    await expect(client.getFile(META_PATH)).rejects.toThrow(AuthError)
  })

  it('403 且额度耗尽 → RateLimitError，并带上恢复时间', async () => {
    fake.rateLimitRemaining = 0
    fake.write(META_PATH, '{}')
    try {
      await makeClient(fake).getFile(META_PATH)
      throw new Error('应当抛错')
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError)
      const e = err as RateLimitError
      expect(e.resetAt).toBeGreaterThan(Date.now())
      expect(e.resetAt).toBeLessThan(Date.now() + 2 * 3600 * 1000)
    }
  })

  it('断网 → NetworkError', async () => {
    fake.networkDown = true
    await expect(makeClient(fake).getFile(META_PATH)).rejects.toThrow(NetworkError)
  })

  it('错误类型可区分 —— 这是用类型而不是字符串匹配的原因', async () => {
    fake.write(META_PATH, '{}')
    const authErr = await makeClient(fake, { token: 'bad' })
      .getFile(META_PATH)
      .catch((e: unknown) => e)
    expect(authErr).toBeInstanceOf(AuthError)
    expect(authErr).not.toBeInstanceOf(RateLimitError)
    expect(authErr).not.toBeInstanceOf(NotFoundError)
  })
})

describe('时钟偏移采样', () => {
  it('从响应头采样出服务器时间与本地时间的偏差', async () => {
    fake.write(META_PATH, '{}')
    // 本地时钟比服务器慢 5 分钟
    const fiveMinBehind = Date.now() - 5 * 60_000
    const client = new GithubClient({
      owner: fake.owner,
      repo: fake.repo,
      branch: 'main',
      token: 'test-token',
      fetchImpl: fake.fetchImpl,
      now: () => fiveMinBehind,
    })

    await client.getFile(META_PATH)

    // 采样出的偏移应该约为 +5 分钟（服务器在前）
    expect(client.clockSkewMs).toBeGreaterThan(4 * 60_000)
    expect(client.clockSkewMs).toBeLessThan(6 * 60_000)
    // 校正后的时间应接近真实当前时间
    expect(Math.abs(client.nowMs() - Date.now())).toBeLessThan(5_000)
  })

  it('时钟准确时偏移接近 0', async () => {
    fake.write(META_PATH, '{}')
    const client = makeClient(fake)
    await client.getFile(META_PATH)
    expect(Math.abs(client.clockSkewMs)).toBeLessThan(5_000)
  })
})

describe('listDir', () => {
  it('列出目录下的分片', async () => {
    fake.write('data/records/records-2026-08.json', '{}')
    fake.write('data/records/records-2026-09.json', '{}')
    fake.write('data/meta.json', '{}')

    const entries = await makeClient(fake).listDir('data/records')
    const names = entries.map((e) => e.name).sort()
    expect(names).toEqual(['records-2026-08.json', 'records-2026-09.json'])
    expect(entries[0]?.sha).toBeTruthy()
  })

  it('目录不存在时返回空数组而不是抛错', async () => {
    expect(await makeClient(fake).listDir('data/records')).toEqual([])
  })
})

describe('testConnection', () => {
  it('仓库可达且带 Token 时报告可写', async () => {
    const result = await makeClient(fake).testConnection()
    expect(result.ok).toBe(true)
    expect(result.readOnly).toBe(false)
    expect(result.message).toContain('写入权限')
  })

  it('无 Token 时报告只读，并说明能看不能记', async () => {
    const anon = new FakeGithub({ token: null })
    const result = await makeClient(anon, { token: '' }).testConnection()
    expect(result.ok).toBe(true)
    expect(result.readOnly).toBe(true)
    expect(result.message).toContain('只读')
  })

  it('仓库不存在时给出针对性的提示', async () => {
    const result = await makeClient(fake, { repo: 'no-such-repo' }).testConnection()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('找不到该仓库')
  })

  it('Token 无效时给出针对性的提示', async () => {
    const result = await makeClient(fake, { token: 'bad-token' }).testConnection()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Token 无效')
  })

  it('断网时不抛错，而是返回可读的失败说明', async () => {
    fake.networkDown = true
    const result = await makeClient(fake).testConnection()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('网络')
  })
})

describe('base64 往返（回归保护）', () => {
  it('写入再读出，中文与 emoji 都保持不变', async () => {
    const payload = { title: '家务积分榜', members: ['小良', '小影'], icon: '🏆' }
    const client = makeClient(fake)
    await client.putFile(META_PATH, payload, { message: 'x', sha: null })

    const res = await client.getFile<typeof payload>(META_PATH)
    expect(res.kind).toBe('ok')
    if (res.kind !== 'ok') return
    expect(res.data).toEqual(payload)
  })
})
