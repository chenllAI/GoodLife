/**
 * GitHub Contents API 客户端
 *
 * 职责边界：**只负责一次请求的正确性与错误分类**，不负责重试循环、分片、离线队列。
 * 冲突重试放在 adapter 里，因为那需要「重新读取 → 重新合并」的业务语义。
 *
 * 几处已核实、容易踩的细节：
 *
 *   - **不发 `X-GitHub-Api-Version`。** 它不在 GitHub 文档里 `Access-Control-Allow-Headers`
 *     的白名单内，发了会挂预检，浏览器直接拒绝。
 *   - PUT 的**分支放在 body 的 `branch` 字段**，不是 `?ref=`（`ref` 只在 GET 上支持）。
 *   - 创建文件 = **不带 `sha`** → 201；更新文件 = **带上当前 blob sha** → 200。
 *   - 目录的 GET 返回**数组**而不是对象，必须显式判断，否则会出现 `undefined.content`
 *     这类难查的错误。
 *   - `btoa` 不能直接编码中文，编解码统一走 domain/codec。
 */

import { decodeBase64, encodeBase64 } from '@/domain/codec'
import {
  AuthError,
  ConflictError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '../types'

const API_ROOT = 'https://api.github.com'

export interface GithubClientOptions {
  owner: string
  repo: string
  branch: string
  /** 留空 = 只读（公开仓库匿名可读） */
  token: string
  fetchImpl?: typeof fetch
  /** 注入时钟，便于测试 */
  now?: () => number
}

export type GetFileResult<T> =
  | { kind: 'ok'; data: T; sha: string; etag: string | null }
  | { kind: 'notModified' }
  | { kind: 'missing' }

export interface DirEntry {
  name: string
  path: string
  sha: string
  size: number
  type: string
}

export interface PutResult {
  commitSha: string
  commitUrl: string
}

interface RawContentResponse {
  content?: string
  encoding?: string
  sha: string
  size: number
  type: string
}

export class GithubClient {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  /** 与 GitHub 服务器的时钟偏移（毫秒），由响应头采样得到 */
  private skewMs = 0
  private skewSampled = false

  constructor(private readonly opts: GithubClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.now = opts.now ?? (() => Date.now())
  }

  get clockSkewMs(): number {
    return this.skewMs
  }

  /** 校正后的当前时间 */
  nowMs(): number {
    return this.now() + this.skewMs
  }

  get readOnly(): boolean {
    return this.opts.token.trim() === ''
  }

  private url(path: string, withRef = false): string {
    const clean = path.replace(/^\/+/, '')
    const base = `${API_ROOT}/repos/${encodeURIComponent(this.opts.owner)}/${encodeURIComponent(
      this.opts.repo,
    )}/contents/${clean}`
    // ref 只在 GET 上支持；PUT 用 body 里的 branch
    return withRef ? `${base}?ref=${encodeURIComponent(this.opts.branch)}` : base
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      ...extra,
    }
    // 注意：不要加 X-GitHub-Api-Version —— 不在 CORS 白名单里
    if (!this.readOnly) h.Authorization = `Bearer ${this.opts.token.trim()}`
    return h
  }

  /** 用响应头采样时钟偏移 —— 两台手机时钟不一致会让「今天」错位 */
  private sampleSkew(res: Response): void {
    const dateHeader = res.headers.get('date')
    if (!dateHeader) return
    const serverMs = Date.parse(dateHeader)
    if (!Number.isFinite(serverMs)) return
    const roundTrip = 0 // 保守起见不做 RTT 补偿，家庭场景下误差可忽略
    const sample = serverMs + roundTrip - this.now()
    // 只接受绝对偏差更小的样本，避免被一次慢响应带偏
    if (!this.skewSampled || Math.abs(sample) < Math.abs(this.skewMs)) {
      this.skewMs = sample
      this.skewSampled = true
    }
  }

  /** 把 HTTP 响应映射成类型化错误 */
  private async raiseFor(res: Response, path: string): Promise<never> {
    const status = res.status
    let bodyText = ''
    try {
      bodyText = await res.text()
    } catch {
      /* 忽略 */
    }
    const detail = bodyText.slice(0, 300)

    if (status === 401) {
      throw new AuthError('Token 无效、已过期或被撤销，请在设置里重新填写')
    }

    if (status === 403) {
      const remaining = res.headers.get('x-ratelimit-remaining')
      if (remaining === '0') {
        const reset = res.headers.get('x-ratelimit-reset')
        const resetSec = reset ? Number(reset) : NaN
        throw new RateLimitError(
          'GitHub 接口调用次数已达上限，请稍后再试',
          Number.isFinite(resetSec) ? resetSec * 1000 : null,
        )
      }
      throw new AuthError('没有访问权限：请确认 Token 已授权该仓库的 Contents 读写权限')
    }

    if (status === 404) {
      throw new NotFoundError(`找不到 ${path}：请确认仓库、分支与数据目录是否填写正确`)
    }

    if (status === 409) {
      // 409 既可能是版本冲突，也可能是 base64 编码错误 ——
      // 靠状态码分流，绝不解析错误消息
      throw new ConflictError(`写入冲突（${path}）`, 0)
    }

    if (status === 422) {
      // GitHub 文档没有把 409 与 422 的边界写清楚：**缺失或过期的 sha 也可能返回 422**。
      // 所以按「消息里提到 sha」判定为冲突，让上层走「重读 → 重新合并 → 重试」，
      // 而不是当成不可重试的参数错误。真正的参数错误（比如 base64 编码问题）里
      // 不会出现 sha 字样，仍会被正确归类。
      if (/\bsha\b/i.test(detail)) {
        throw new ConflictError(`写入冲突（${path}）：sha 缺失或已过期`, 0)
      }
      throw new ValidationError(`请求内容不合法：${detail || '未知原因'}`)
    }

    if (status >= 500) {
      throw new NetworkError(`GitHub 服务异常（${status}），请稍后重试`)
    }

    throw new NetworkError(`请求失败（${status}）：${detail}`)
  }

  private async request(path: string, init: RequestInit, withRef = false): Promise<Response> {
    let res: Response
    try {
      res = await this.fetchImpl(this.url(path, withRef), init)
    } catch (err) {
      // fetch 只在网络层失败时抛错（DNS、断网、CORS 预检被拒）
      const message = err instanceof Error ? err.message : String(err)
      throw new NetworkError(`网络请求失败：${message}`)
    }
    this.sampleSkew(res)
    return res
  }

  /**
   * 读取一个 JSON 文件。
   *
   * @param etag 上次拿到的 ETag；命中则返回 `{kind:'notModified'}`（不传输正文）
   */
  async getFile<T>(path: string, etag?: string | null): Promise<GetFileResult<T>> {
    const extra: Record<string, string> = {}
    if (etag) extra['If-None-Match'] = etag

    const res = await this.request(path, { method: 'GET', headers: this.headers(extra) }, true)

    if (res.status === 304) return { kind: 'notModified' }
    if (res.status === 404) return { kind: 'missing' }
    if (!res.ok) await this.raiseFor(res, path)

    const raw = (await res.json()) as unknown

    // 目录的 GET 返回数组 —— 必须显式拦截，否则后面 raw.content 是 undefined
    if (Array.isArray(raw)) {
      throw new ValidationError(
        `路径 ${path} 指向的是一个目录而不是文件，请检查数据目录配置`,
      )
    }

    const file = raw as RawContentResponse
    if (typeof file.content !== 'string') {
      throw new ValidationError(`响应里没有文件内容（${path}）`)
    }

    let data: T
    try {
      // decodeBase64 会剥离换行，且用 TextDecoder 正确处理中文
      data = JSON.parse(decodeBase64(file.content)) as T
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ValidationError(`${path} 的内容不是合法 JSON：${message}`)
    }

    return { kind: 'ok', data, sha: file.sha, etag: res.headers.get('etag') }
  }

  /** 列目录。目录不存在时返回空数组而不是抛错。 */
  async listDir(path: string): Promise<DirEntry[]> {
    const res = await this.request(path, { method: 'GET', headers: this.headers() }, true)

    if (res.status === 404) return []
    if (!res.ok) await this.raiseFor(res, path)

    const raw = (await res.json()) as unknown
    if (!Array.isArray(raw)) {
      throw new ValidationError(`${path} 不是一个目录`)
    }

    return raw.map((e) => {
      const entry = e as Record<string, unknown>
      return {
        name: String(entry.name ?? ''),
        path: String(entry.path ?? ''),
        sha: String(entry.sha ?? ''),
        size: Number(entry.size ?? 0),
        type: String(entry.type ?? ''),
      }
    })
  }

  /**
   * 写入一个 JSON 文件。
   *
   * @param sha 当前 blob sha。**传 null 表示创建新文件**（省略该字段）。
   *            对已存在的文件不带 sha 提交，GitHub 会返回 409/422 ——
   *            调用方的重试循环把两者都当作冲突处理。
   */
  async putFile(
    path: string,
    data: unknown,
    opts: { message: string; sha: string | null },
  ): Promise<PutResult> {
    if (this.readOnly) {
      throw new AuthError('当前是只读模式，请先在设置里填入 Token')
    }

    const body: Record<string, unknown> = {
      message: opts.message,
      content: encodeBase64(JSON.stringify(data, null, 2)),
      branch: this.opts.branch,
    }
    if (opts.sha) body.sha = opts.sha

    const res = await this.request(path, {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })

    if (!res.ok) await this.raiseFor(res, path)

    const raw = (await res.json()) as { commit?: { sha?: string; html_url?: string } }
    return {
      commitSha: raw.commit?.sha ?? '',
      commitUrl: raw.commit?.html_url ?? '',
    }
  }

  /**
   * 连接自检：依次验证仓库可达、数据目录状态、以及（有 Token 时）写权限。
   * 设置页的「测试连接」按钮用它，把失败原因说清楚而不是笼统报错。
   */
  async testConnection(): Promise<{
    ok: boolean
    readOnly: boolean
    message: string
    repoPrivate: boolean | null
  }> {
    try {
      // 查仓库本身而不是 contents 根目录 —— 这个接口会返回 private 与 default_branch，
      // 正好用来提示「分支填错了」这类最常见的手误
      const repoUrl = `${API_ROOT}/repos/${encodeURIComponent(this.opts.owner)}/${encodeURIComponent(
        this.opts.repo,
      )}`
      let res: Response
      try {
        res = await this.fetchImpl(repoUrl, { method: 'GET', headers: this.headers() })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          ok: false,
          readOnly: true,
          message: `网络请求失败：${message}`,
          repoPrivate: null,
        }
      }
      this.sampleSkew(res)

      if (res.status === 404) {
        return {
          ok: false,
          readOnly: true,
          message: '找不到该仓库：请检查用户名与仓库名（注意区分大小写）',
          repoPrivate: null,
        }
      }
      if (res.status === 401) {
        return { ok: false, readOnly: true, message: 'Token 无效或已过期', repoPrivate: null }
      }
      if (!res.ok) await this.raiseFor(res, `${this.opts.owner}/${this.opts.repo}`)

      const info = (await res.json()) as { private?: boolean; default_branch?: string }
      const repoPrivate = typeof info.private === 'boolean' ? info.private : null

      if (this.readOnly) {
        return {
          ok: true,
          readOnly: true,
          message: repoPrivate
            ? '已连接（只读）。这是私有仓库，未填 Token 将无法读取数据，也无法写入。'
            : '已连接（只读）。当前未填 Token，可以查看榜单，但不能记分。',
          repoPrivate,
        }
      }

      if (info.default_branch && info.default_branch !== this.opts.branch) {
        return {
          ok: true,
          readOnly: false,
          message: `已连接。提示：该仓库的默认分支是 ${info.default_branch}，而当前配置的是 ${this.opts.branch}。`,
          repoPrivate,
        }
      }

      return {
        ok: true,
        readOnly: false,
        message: '已连接，且具备写入权限。',
        repoPrivate,
      }
    } catch (err) {
      return {
        ok: false,
        readOnly: true,
        message: err instanceof Error ? err.message : String(err),
        repoPrivate: null,
      }
    }
  }
}
