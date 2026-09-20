/**
 * 存储适配器契约
 *
 * 应用只依赖这个接口，不关心数据存在 localStorage 还是 GitHub 仓库。
 * 适配器内部持有权威文档并向订阅者广播变更，UI 只做渲染。
 */

import type { DayRange, FamilyDoc, Op, PointsRecord } from '@/types'

export type AdapterKind = 'github' | 'memory'

export interface StorageCapabilities {
  /** 两台设备能看到同一份数据 */
  multiDevice: boolean
  /** 当前配置下能否写入（只读模式下为 false） */
  canWrite: boolean
  /** 写入是否需要 Token */
  needsToken: boolean
  /** 离线时能否排队，联网后补传 */
  offlineQueue: boolean
}

export type AdapterState =
  | 'idle'
  | 'loading'
  | 'syncing'
  | 'ready'
  | 'offline'
  | 'error'

export interface AdapterStatus {
  kind: AdapterKind
  state: AdapterState
  /** 待同步的操作数（离线队列长度） */
  pendingOps: number
  lastSyncedAt: string | null
  readOnly: boolean
  /** 给用户看的一句话说明（错误原因、限流提示等） */
  message: string | null
  /** 限流恢复时间（epoch 毫秒），用于倒计时 */
  rateLimitResetAt: number | null
}

export interface CommitResult {
  /** 已落到远端（或本地） */
  applied: boolean
  /** 进了离线队列，等联网后补传 */
  queued: boolean
  /** 遇到的 409 冲突次数（用于诊断） */
  conflicts: number
}

export interface InitResult {
  ok: boolean
  readOnly: boolean
  message: string | null
}

export interface StorageAdapter {
  readonly kind: AdapterKind
  readonly capabilities: StorageCapabilities

  /** 初始化：先加载本地缓存（快），再尝试拉远端（可能失败但不阻塞） */
  init(): Promise<InitResult>

  /** 当前内存中的权威文档 */
  read(): FamilyDoc

  /** 某个区间内的记录（内部自行过滤） */
  readRecords(range: DayRange): PointsRecord[]

  /** 提交一批操作。先乐观应用到内存，再持久化；失败则入队 */
  commit(ops: readonly Op[]): Promise<CommitResult>

  /** 尝试补传离线队列 */
  flushPending(): Promise<CommitResult>

  /** 从远端重新拉取（full 为 true 时忽略缓存，全量重取） */
  refresh(opts?: { full?: boolean }): Promise<void>

  /**
   * 当前时间（epoch 毫秒）。
   *
   * 放在适配器上而不是让调用方直接用 `Date.now()`，是因为 GitHub 适配器会从响应头
   * 采样时钟偏移并校正 —— 两台手机时钟不一致时，记账会落到错误的那一天，
   * 「今天」的日榜也就错了。
   */
  nowMs(): number

  getStatus(): AdapterStatus
  subscribe(fn: (doc: FamilyDoc, status: AdapterStatus) => void): () => void

  exportAll(): Promise<FamilyDoc>
  importAll(doc: FamilyDoc): Promise<void>
  dispose(): void
}

// ---------------------------------------------------------------------------
// 类型化错误
//
// 用类型而不是字符串匹配来区分失败原因 —— GitHub 的 409 既可能是真正的版本冲突，
// 也可能是 base64 编码错误，靠解析错误消息来分流非常不可靠。
// ---------------------------------------------------------------------------

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'auth'
      | 'rateLimit'
      | 'conflict'
      | 'notFound'
      | 'validation'
      | 'network'
      | 'unknown',
  ) {
    super(message)
    this.name = 'AdapterError'
  }
}

export class AuthError extends AdapterError {
  constructor(message = 'Token 无效或已过期') {
    super(message, 'auth')
    this.name = 'AuthError'
  }
}

export class RateLimitError extends AdapterError {
  constructor(
    message = 'GitHub 接口调用次数已达上限',
    /** 额度恢复时间（epoch 毫秒） */
    readonly resetAt: number | null = null,
  ) {
    super(message, 'rateLimit')
    this.name = 'RateLimitError'
  }
}

export class ConflictError extends AdapterError {
  constructor(
    message = '数据被另一台设备同时修改，重试后仍未成功',
    readonly attempts = 0,
  ) {
    super(message, 'conflict')
    this.name = 'ConflictError'
  }
}

export class NotFoundError extends AdapterError {
  constructor(message = '找不到指定的文件或仓库') {
    super(message, 'notFound')
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends AdapterError {
  constructor(message = '请求内容不合法') {
    super(message, 'validation')
    this.name = 'ValidationError'
  }
}

export class NetworkError extends AdapterError {
  constructor(message = '网络不可用') {
    super(message, 'network')
    this.name = 'NetworkError'
  }
}

// ---------------------------------------------------------------------------
// 配置
//
// 只支持 GitHub 仓库存储 —— 需求就是「两台手机读写同一份」，本机存储做不到这件事，
// 留着只会让人误以为数据同步了。
// ---------------------------------------------------------------------------

/**
 * localStorage 的最小接口。
 *
 * 抽成接口而不是直接用 `Storage`，是为了让适配器和测试可以注入一个内存实现 ——
 * node 环境下没有 localStorage。
 */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface GithubConfig {
  owner: string
  repo: string
  branch: string
  /** 数据目录，默认 'data' */
  basePath: string
  /** 留空 = 只读模式（公开仓库匿名可读） */
  token: string
}

export const DEFAULT_STORAGE_CONFIG: GithubConfig = {
  owner: '',
  repo: '',
  branch: 'main',
  basePath: 'data',
  token: '',
}
