/**
 * 测试用的假 GitHub Contents API
 *
 * 尽量贴近真实行为，尤其是 **sha 乐观并发校验**：PUT 时带上过期 sha 就必须返回
 * 409。冲突重试的正确性完全依赖这个行为，如果假服务不校验 sha，那组最关键的
 * 测试就是空转的。
 *
 * 一台设备在另一台背后改了文件，最真实的模拟方式就是直接改这里的文件内容 ——
 * 于是对方的 sha 自然过期，PUT 自然 409。不需要额外造「冲突模式」。
 */

import { decodeBase64, encodeBase64 } from '@/domain/codec'

interface FakeFile {
  content: string
  sha: string
}

export interface FakeGithubOptions {
  owner?: string
  repo?: string
  /**
   * 若设置，则请求必须带匹配的 Bearer Token，否则 401。
   * 传 `null` 表示匿名服务（不做任何鉴权）—— 对应公开仓库的匿名读。
   */
  token?: string | null
  /** 模拟额度耗尽 */
  rateLimitRemaining?: number | null
  /** 模拟网络故障 */
  networkDown?: boolean
  /** 对已存在文件不带 sha 提交时的状态码（真实 GitHub 未在文档里写清，两种都遇到过） */
  missingShaStatus?: 409 | 422
}

export class FakeGithub {
  readonly owner: string
  readonly repo: string
  private files = new Map<string, FakeFile>()
  private token: string | null

  rateLimitRemaining: number | null
  networkDown = false
  missingShaStatus: 409 | 422 = 409
  /** 私有仓库语义：不带 Authorization 直接 401（公开仓库为 false） */
  requiresAuth = false

  /** 记录所有 PUT，用于断言「到底写了几次」 */
  commits: { path: string; message: string; content: string }[] = []
  /** 记录所有请求（含请求头），用于断言缓存策略与请求头正确性 */
  requests: { method: string; path: string; headers: Record<string, string> }[] = []

  constructor(opts: FakeGithubOptions = {}) {
    this.owner = opts.owner ?? 'family'
    this.repo = opts.repo ?? 'chore-data'
    this.token = opts.token ?? null
    this.rateLimitRemaining = opts.rateLimitRemaining ?? null
    this.missingShaStatus = opts.missingShaStatus ?? 409
  }

  // -------------------------------------------------------------------------
  // 测试辅助
  // -------------------------------------------------------------------------

  /** 直接写入文件（模拟另一台设备的提交） */
  write(path: string, content: string): void {
    this.files.set(path, { content, sha: this.hash(content) })
  }

  /** 读取文件原始内容（断言用） */
  readFile(path: string): string | null {
    return this.files.get(path)?.content ?? null
  }

  readJson<T>(path: string): T | null {
    const raw = this.readFile(path)
    return raw ? (JSON.parse(raw) as T) : null
  }

  listPaths(): string[] {
    return [...this.files.keys()].sort()
  }

  get putCount(): number {
    return this.commits.length
  }

  pathRequests(path: string, method = 'GET'): number {
    return this.requests.filter((r) => r.path === path && r.method === method).length
  }

  /**
   * 内容哈希作为 sha —— 真实的 git blob sha 就是内容寻址的。
   *
   * 关键性质：**内容相同则 sha 相同，内容变化则 sha 变化。**
   * 这既是乐观并发校验的基础，也让「目录列表里的 sha 与文件请求返回的 sha 一致」
   * 这一前提成立 —— 适配器正是靠比对目录列表的 sha 来决定要不要拉取分片的。
   * 如果这里掺入自增值，那条优化就永远测不出来。
   */
  private hash(content: string): string {
    let h = 2166136261
    for (let i = 0; i < content.length; i++) {
      h ^= content.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    // 带上长度，降低碰撞概率（纯演示用的哈希，不追求密码学强度）
    return `blob${(h >>> 0).toString(16)}${content.length.toString(16)}`
  }

  private json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      date: new Date().toUTCString(),
      ...extraHeaders,
    }
    if (this.rateLimitRemaining !== null) {
      headers['x-ratelimit-remaining'] = String(this.rateLimitRemaining)
      headers['x-ratelimit-limit'] = '5000'
      headers['x-ratelimit-reset'] = String(Math.floor(Date.now() / 1000) + 3600)
    }
    return new Response(JSON.stringify(body), { status, headers })
  }

  private rateLimited(): Response | null {
    if (this.rateLimitRemaining === 0) {
      return this.json(403, { message: 'API rate limit exceeded' }, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1800),
      })
    }
    return null
  }

  /** 供 fetchImpl 使用 */
  fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (this.networkDown) throw new TypeError('Failed to fetch')

    const url = new URL(String(input))
    const method = (init?.method ?? 'GET').toUpperCase()

    // 鉴权先于路由。
    // 真实行为：公开仓库**不带** Authorization 可以匿名读；但一旦带了无效的
    // Authorization，GitHub 会返回 401 而不是忽略它。这一点对「测试连接」很关键 ——
    // 否则填错 Token 也会显示连接成功。
    if (this.token !== null) {
      const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization']
      if (auth !== undefined && auth !== `Bearer ${this.token}`) {
        return this.json(401, { message: 'Bad credentials' })
      }
      if (auth === undefined && this.requiresAuth) {
        return this.json(401, { message: 'Requires authentication' })
      }
    }

    // 仓库信息接口
    const repoMatch = /^\/repos\/([^/]+)\/([^/]+)$/.exec(url.pathname)
    if (repoMatch) {
      if (repoMatch[1] !== this.owner || repoMatch[2] !== this.repo) {
        return this.json(404, { message: 'Not Found' })
      }
      const limitedRepo = this.rateLimited()
      if (limitedRepo) return limitedRepo
      return this.json(200, { private: false, default_branch: 'main' })
    }

    const contentsMatch = /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.*)$/.exec(url.pathname)
    if (!contentsMatch) return this.json(404, { message: 'Not Found' })
    if (contentsMatch[1] !== this.owner || contentsMatch[2] !== this.repo) {
      return this.json(404, { message: 'Not Found' })
    }

    const path = contentsMatch[3] ?? ''
    this.requests.push({
      method,
      path,
      headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) },
    })

    const limited = this.rateLimited()
    if (limited) return limited

    if (method === 'GET') return this.handleGet(path, init)
    if (method === 'PUT') return this.handlePut(path, init)
    return this.json(405, { message: 'Method Not Allowed' })
  }

  private handleGet(path: string, init?: RequestInit): Response {
    const file = this.files.get(path)

    if (file) {
      const etag = `"${file.sha}"`
      const inm = (init?.headers as Record<string, string> | undefined)?.['If-None-Match']
      if (inm && inm === etag) {
        return new Response(null, {
          status: 304,
          headers: { etag, date: new Date().toUTCString() },
        })
      }
      return this.json(
        200,
        {
          name: path.split('/').pop(),
          path,
          sha: file.sha,
          size: file.content.length,
          type: 'file',
          content: encodeBase64(file.content),
          encoding: 'base64',
        },
        { etag },
      )
    }

    // 目录：存在子条目则返回数组
    const prefix = path.endsWith('/') ? path : `${path}/`
    const children = [...this.files.entries()]
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, f]) => {
        const rest = p.slice(prefix.length)
        return {
          name: rest,
          path: p,
          sha: f.sha,
          size: f.content.length,
          type: rest.includes('/') ? 'dir' : 'file',
        }
      })

    if (children.length > 0) return this.json(200, children)
    return this.json(404, { message: 'Not Found' })
  }

  private handlePut(path: string, init?: RequestInit): Response {
    let body: { message?: string; content?: string; sha?: string }
    try {
      body = JSON.parse(String(init?.body ?? '{}')) as typeof body
    } catch {
      return this.json(400, { message: 'invalid body' })
    }

    if (typeof body.content !== 'string') {
      return this.json(422, { message: 'content is required' })
    }

    let decoded: string
    try {
      decoded = decodeBase64(body.content)
    } catch {
      return this.json(409, { message: 'The file content is not base64 encoded' })
    }

    const existing = this.files.get(path)

    // 乐观并发校验 —— 这是整套冲突重试逻辑的基石
    if (existing) {
      if (!body.sha) {
        return this.json(this.missingShaStatus, {
          message: `"sha" wasn't supplied`,
        })
      }
      if (body.sha !== existing.sha) {
        return this.json(409, {
          message: `${path} does not match ${existing.sha}`,
        })
      }
    }

    this.write(path, decoded)
    this.commits.push({ path, message: body.message ?? '', content: decoded })

    return this.json(existing ? 200 : 201, {
      content: { name: path.split('/').pop(), path, sha: this.hash(decoded), type: 'file' },
      commit: { sha: `commit${this.commits.length}`, html_url: `https://github.com/x/y/commit/${this.commits.length}` },
    })
  }
}
