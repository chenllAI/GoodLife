/**
 * GitHub 适配器 —— 把仓库当作共享存储
 *
 * 三件事让它能在两台手机上正确工作：
 *
 * 1. **冲突重试基于「重新读取」而不是「重放旧内容」。**
 *    遇到 409 时重新 GET 拿到最新内容（顺带把对方刚写的记录也拿到），把操作
 *    叠加到这份新内容上再写。若重放本地缓存的旧文档，就会把对方的写入抹掉。
 *
 * 2. **写请求严格串行。** GitHub 文档明确说 PUT/DELETE 并发会冲突，
 *    必须串行执行。这里用一条 Promise 链把所有写入排队。
 *
 * 3. **操作流而非文档快照。** 离线队列里存的是 Op 对象，联网后叠加到刚读到的
 *    远端状态上，而不是覆盖。
 *
 * 另外：**历史月份分片缓存后不再重复拉取**（过去的月份事实上不会变），
 * 稳态刷新通常只需 3 次请求，对匿名限流（60 次/小时）友好。
 */

import type { DayRange, FamilyDoc, MonthKey, Op, PointsRecord, Shard } from '@/types'
import { applyOps } from '@/domain/apply'
import { recordsInRange } from '@/domain/aggregate'
import { createInitialDoc } from '@/domain/doc'
import { SCHEMA_VERSION } from '@/domain/presets'
import { mergeRecords } from '@/domain/merge'
import { canonicalStringify, serializeShard } from '@/domain/serialize'
import { addMonths, dayKeyOf, monthKeyOf, todayKey } from '@/domain/time'
import { SimpleAdapter } from '../simple'
import {
  AdapterError,
  ConflictError,
  NetworkError,
  RateLimitError,
  type AdapterStatus,
  type CommitResult,
  type GithubConfig,
  type InitResult,
  type KeyValueStore,
  type StorageCapabilities,
} from '../types'
import { GithubClient } from './client'
import { metaPath, monthFromShardName, recordsDir, shardPath } from './paths'

export interface GithubAdapterOptions {
  config: GithubConfig
  store?: KeyValueStore | null
  fetchImpl?: typeof fetch
  now?: () => Date
  /** 注入 sleep，便于测试退避而不真的等待 */
  sleep?: (ms: number) => Promise<void>
  maxConflictRetries?: number
}

interface ShardEntry {
  etag: string | null
  sha: string | null
  records: PointsRecord[]
}

const CAPS: StorageCapabilities = {
  multiDevice: true,
  canWrite: true,
  needsToken: true,
  offlineQueue: true,
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class GithubAdapter extends SimpleAdapter {
  private readonly client: GithubClient
  private readonly cfg: GithubConfig
  private readonly store: KeyValueStore | null
  private readonly sleep: (ms: number) => Promise<void>
  private readonly maxConflictRetries: number
  private readonly nowFn: () => Date

  /** 每个月份分片的缓存（含 ETag 与 blob sha） */
  private shards = new Map<MonthKey, ShardEntry>()
  private metaEtag: string | null = null
  private metaSha: string | null = null

  /** 离线队列 */
  private outbox: Op[] = []
  /** 写请求串行队列的尾指针 */
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(opts: GithubAdapterOptions) {
    super('github', CAPS, createInitialDoc())
    this.cfg = opts.config
    this.store = opts.store === undefined ? safeLocalStorage() : opts.store
    this.sleep = opts.sleep ?? defaultSleep
    this.maxConflictRetries = opts.maxConflictRetries ?? 3
    this.nowFn = opts.now ?? (() => new Date())
    this.client = new GithubClient({
      owner: opts.config.owner,
      repo: opts.config.repo,
      branch: opts.config.branch,
      token: opts.config.token,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    })
    this.setStatus({ readOnly: this.client.readOnly })
  }

  get clientRef(): GithubClient {
    return this.client
  }

  // -------------------------------------------------------------------------
  // 缓存键
  // -------------------------------------------------------------------------

  private get cacheKey(): string {
    const c = this.cfg
    return `chore.ghCache.v1:${c.owner}/${c.repo}@${c.branch}:${c.basePath}`
  }

  private get outboxKey(): string {
    const c = this.cfg
    return `chore.ghOutbox.v1:${c.owner}/${c.repo}@${c.branch}`
  }

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  override async init(): Promise<InitResult> {
    this.setStatus({ state: 'loading', message: null })

    // 先读本地缓存让界面立刻有内容，再尝试联网
    this.loadCache()
    this.loadOutbox()
    this.rebuildDoc()
    this.emit()

    try {
      await this.refresh()
      if (this.outbox.length > 0) await this.flushPending()
      return { ok: true, readOnly: this.client.readOnly, message: null }
    } catch (err) {
      const message = describeError(err)
      // 联网失败不算致命：有缓存就继续用，只是标记为离线
      const hasCache = this.shards.size > 0 || this.doc.meta.chores.length > 0
      this.setStatus({
        state: hasCache ? 'offline' : 'error',
        message,
        rateLimitResetAt: err instanceof RateLimitError ? err.resetAt : null,
        pendingOps: this.outbox.length,
      })
      this.emit()
      return { ok: hasCache, readOnly: this.client.readOnly, message }
    }
  }

  /**
   * 从远端重新拉取。
   *
   * 读取策略：目录列表 1 次 + meta 1 次 + **只拉变化了的分片**。
   * 「热窗口」（当月与上月）每次都校验；更早的月份只在本地没有缓存时才拉 ——
   * 过去的月份事实上不会变，重复拉取纯属浪费限流额度。
   */
  override async refresh(opts: { full?: boolean } = {}): Promise<void> {
    const full = opts.full ?? false
    this.setStatus({ state: 'syncing', message: null })
    this.emit()

    const dir = recordsDir(this.cfg.basePath)
    const entries = await this.client.listDir(dir)
    const remoteMonths = new Set<MonthKey>()
    const remoteShas = new Map<MonthKey, string>()
    for (const e of entries) {
      const m = monthFromShardName(e.name)
      if (m) {
        remoteMonths.add(m)
        remoteShas.set(m, e.sha)
      }
    }

    // 远端已删除的分片，本地也要清掉
    for (const m of [...this.shards.keys()]) {
      if (!remoteMonths.has(m)) this.shards.delete(m)
    }

    const hot = hotMonths(this.nowFn())

    for (const month of remoteMonths) {
      const cached = this.shards.get(month)
      const shaChanged = !cached || cached.sha !== remoteShas.get(month)
      const isHot = hot.has(month)

      // 冷月份、本地已有、且 sha 未变 → 直接跳过，一个请求都不发
      if (!full && !isHot && cached && !shaChanged) continue

      const path = shardPath(this.cfg.basePath, month)
      const res = await this.client.getFile<Shard>(path, full ? null : cached?.etag ?? null)

      if (res.kind === 'notModified') {
        // 304：正文没变，但要把 sha 记上（它可能因为别的字段变化而不同）
        if (cached) cached.sha = remoteShas.get(month) ?? cached.sha
        continue
      }
      if (res.kind === 'missing') {
        this.shards.delete(month)
        continue
      }

      this.shards.set(month, {
        etag: res.etag,
        sha: res.sha,
        records: normalizeRecords(res.data.records),
      })
    }

    // meta.json
    const metaRes = await this.client.getFile<FamilyDoc['meta']>(
      metaPath(this.cfg.basePath),
      full ? null : this.metaEtag,
    )

    if (metaRes.kind === 'ok') {
      this.metaEtag = metaRes.etag
      this.metaSha = metaRes.sha
      this.doc = { ...this.doc, meta: metaRes.data }
    } else if (metaRes.kind === 'missing') {
      this.metaEtag = null
      this.metaSha = null
    }

    this.rebuildDoc()
    this.setStatus({
      state: 'ready',
      lastSyncedAt: new Date().toISOString(),
      message: null,
      rateLimitResetAt: null,
      pendingOps: this.outbox.length,
    })
    this.persistCache()
    this.emit()
  }

  // -------------------------------------------------------------------------
  // 写入
  // -------------------------------------------------------------------------

  override async commit(ops: readonly Op[]): Promise<CommitResult> {
    if (ops.length === 0) return { applied: true, queued: false, conflicts: 0 }

    if (this.client.readOnly) {
      const message = '当前是只读模式：请在设置里填入 Token 才能记分'
      this.setStatus({ state: 'error', message })
      this.emit()
      return { applied: false, queued: false, conflicts: 0 }
    }

    // 先乐观应用，UI 立刻响应
    this.applyLocally(ops)
    this.setStatus({ state: 'syncing', message: null, pendingOps: this.outbox.length })
    this.emit()

    try {
      const conflicts = await this.enqueueWrite(() => this.persistOps(ops))
      this.setStatus({
        state: 'ready',
        lastSyncedAt: new Date().toISOString(),
        message: null,
        rateLimitResetAt: null,
        pendingOps: this.outbox.length,
      })
      this.persistCache()
      this.emit()
      return { applied: true, queued: false, conflicts }
    } catch (err) {
      // 失败则入队，等联网后补传
      this.outbox.push(...ops)
      this.saveOutbox()
      const isOffline = err instanceof NetworkError
      this.setStatus({
        state: isOffline ? 'offline' : 'error',
        message: describeError(err),
        rateLimitResetAt: err instanceof RateLimitError ? err.resetAt : null,
        pendingOps: this.outbox.length,
      })
      this.persistCache()
      this.emit()
      return { applied: false, queued: true, conflicts: 0 }
    }
  }

  override async flushPending(): Promise<CommitResult> {
    if (this.outbox.length === 0) {
      return { applied: true, queued: false, conflicts: 0 }
    }
    if (this.client.readOnly) {
      return { applied: false, queued: true, conflicts: 0 }
    }

    const pending = [...this.outbox]
    try {
      const conflicts = await this.enqueueWrite(() => this.persistOps(pending))
      // 只有全部成功才清空队列
      this.outbox = this.outbox.filter((op) => !pending.includes(op))
      this.saveOutbox()
      this.setStatus({
        state: 'ready',
        lastSyncedAt: new Date().toISOString(),
        message: null,
        pendingOps: this.outbox.length,
      })
      this.emit()
      return { applied: true, queued: false, conflicts }
    } catch (err) {
      this.setStatus({
        state: err instanceof NetworkError ? 'offline' : 'error',
        message: describeError(err),
        rateLimitResetAt: err instanceof RateLimitError ? err.resetAt : null,
        pendingOps: this.outbox.length,
      })
      this.emit()
      return { applied: false, queued: true, conflicts: 0 }
    }
  }

  /** 把所有写入串到一条 Promise 链上 —— GitHub 要求 PUT 必须串行 */
  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(fn, fn)
    // 吞掉拒绝，避免链条因一次失败而永久中断
    this.writeChain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /** 把一批操作按目标文件分组并落盘，返回累计冲突次数 */
  private async persistOps(ops: readonly Op[]): Promise<number> {
    let conflicts = 0

    const recordOps = ops.filter(
      (o): o is Extract<Op, { type: 'addRecord' | 'deleteRecord' }> =>
        o.type === 'addRecord' || o.type === 'deleteRecord',
    )
    const metaOps = ops.filter(
      (o) => o.type === 'upsertChore' || o.type === 'deleteChore' || o.type === 'upsertMember' || o.type === 'putSettings',
    )

    // 记录操作按所属月份分组 —— 不同月份写不同文件，天然分流
    const byMonth = new Map<MonthKey, typeof recordOps>()
    for (const op of recordOps) {
      const month = this.monthOfOp(op)
      if (!month) continue
      const list = byMonth.get(month) ?? []
      list.push(op)
      byMonth.set(month, list)
    }

    for (const [month, monthOps] of byMonth) {
      conflicts += await this.writeShard(month, monthOps)
    }

    if (metaOps.length > 0) {
      conflicts += await this.writeMeta(metaOps)
    }

    return conflicts
  }

  /** 找出删除操作对应的记录在哪个月 */
  private monthOfOp(op: Op): MonthKey | null {
    if (op.type === 'addRecord') return monthKeyOf(op.record.day)
    if (op.type === 'deleteRecord') {
      for (const [month, entry] of this.shards) {
        if (entry.records.some((r) => r.id === op.id)) return month
      }
      // 本地找不到就退回「当月」，至少不会丢
      return monthKeyOf(todayKey(this.nowFn()))
    }
    return null
  }

  /**
   * 写一个月份分片，带冲突重试。
   *
   * 核心：每次重试都**重新读取远端内容**，然后把操作叠加到新内容上。
   * 这样对方设备刚写入的记录不会丢。
   */
  private async writeShard(month: MonthKey, ops: readonly Op[]): Promise<number> {
    const path = shardPath(this.cfg.basePath, month)
    let conflicts = 0

    for (let attempt = 0; ; attempt++) {
      const res = await this.client.getFile<Shard>(path)
      const remoteRecords = res.kind === 'ok' ? normalizeRecords(res.data.records) : []
      const baseSha = res.kind === 'ok' ? res.sha : null

      // 把操作叠加到刚读到的远端内容上（而不是本地缓存）
      const baseDoc: FamilyDoc = {
        meta: this.doc.meta,
        records: remoteRecords,
      }
      const merged = applyOps(baseDoc, ops)
      const nextShard: Shard = {
        schemaVersion: SCHEMA_VERSION,
        month,
        records: merged.records,
      }

      // 内容没变就不写 —— 省额度、少提交、少冲突
      if (res.kind === 'ok' && serializeShard(nextShard) === serializeShard({
        schemaVersion: res.data.schemaVersion ?? SCHEMA_VERSION,
        month,
        records: remoteRecords,
      })) {
        this.shards.set(month, {
          etag: res.etag,
          sha: res.sha,
          records: remoteRecords,
        })
        return conflicts
      }

      try {
        await this.client.putFile(path, nextShard, {
          message: `记录家务：${month}（${ops.length} 项变更）`,
          sha: baseSha,
        })
        // 写成功后本地即为权威内容，但 ETag/sha 已失效，置空迫使下次刷新重新校验
        this.shards.set(month, {
          etag: null,
          sha: null,
          records: nextShard.records,
        })
        return conflicts
      } catch (err) {
        if (err instanceof ConflictError && attempt < this.maxConflictRetries) {
          conflicts++
          await this.sleep(backoffMs(attempt))
          continue
        }
        throw err
      }
    }
  }

  /** 写 meta.json，同样带冲突重试 */
  private async writeMeta(ops: readonly Op[]): Promise<number> {
    const path = metaPath(this.cfg.basePath)
    let conflicts = 0

    for (let attempt = 0; ; attempt++) {
      const res = await this.client.getFile<FamilyDoc['meta']>(path)
      const baseMeta = res.kind === 'ok' ? res.data : this.doc.meta
      const baseSha = res.kind === 'ok' ? res.sha : null

      const baseDoc: FamilyDoc = { meta: baseMeta, records: [] }
      const merged = applyOps(baseDoc, ops)
      const nextMeta = { ...merged.meta, updatedAt: new Date().toISOString() }

      try {
        await this.client.putFile(path, nextMeta, {
          message: `更新家务设置（${ops.length} 项变更）`,
          sha: baseSha,
        })
        this.metaEtag = null
        this.metaSha = null
        this.doc = { ...this.doc, meta: nextMeta }
        return conflicts
      } catch (err) {
        if (err instanceof ConflictError && attempt < this.maxConflictRetries) {
          conflicts++
          await this.sleep(backoffMs(attempt))
          continue
        }
        throw err
      }
    }
  }

  // -------------------------------------------------------------------------
  // 本地状态
  // -------------------------------------------------------------------------

  /** 把操作叠加到本地内存（乐观更新） */
  private applyLocally(ops: readonly Op[]): void {
    // 记录操作进各自月份的分片缓存
    for (const op of ops) {
      if (op.type === 'addRecord') {
        const month = monthKeyOf(op.record.day)
        const entry = this.shards.get(month) ?? { etag: null, sha: null, records: [] }
        entry.records = mergeRecords(entry.records, [op.record])
        this.shards.set(month, entry)
      } else if (op.type === 'deleteRecord') {
        for (const [month, entry] of this.shards) {
          if (entry.records.some((r) => r.id === op.id)) {
            this.shards.set(month, {
              ...entry,
              records: applyOps({ meta: this.doc.meta, records: entry.records }, [op]).records,
            })
            break
          }
        }
      }
    }
    this.rebuildDoc()

    // meta 类操作
    const metaOps = ops.filter(
      (o) => o.type === 'upsertChore' || o.type === 'deleteChore' || o.type === 'upsertMember' || o.type === 'putSettings',
    )
    if (metaOps.length > 0) {
      this.doc = applyOps(this.doc, metaOps)
    }
  }

  /** 用分片缓存重建 doc.records */
  private rebuildDoc(): void {
    let records: PointsRecord[] = []
    for (const entry of this.shards.values()) {
      records = mergeRecords(records, entry.records)
    }
    this.doc = { ...this.doc, records }
  }

  override readRecords(range: DayRange): PointsRecord[] {
    return recordsInRange(this.doc.records, range)
  }

  /** 用采样到的时钟偏移校正过的当前时间 */
  override nowMs(): number {
    return this.client.nowMs()
  }

  // -------------------------------------------------------------------------
  // 持久化（本地缓存与离线队列）
  // -------------------------------------------------------------------------

  /**
   * 基类要求的持久化钩子。
   *
   * GitHub 适配器覆写了 init/commit/refresh，实际路径走的是下面的
   * persistCache / loadCache（它们按分片分别缓存，还带 ETag 与 blob sha）。
   * 这两个方法只是把基类的抽象契约接上，语义与缓存保持一致。
   */
  protected async persist(doc: FamilyDoc): Promise<void> {
    this.doc = doc
    this.persistCache()
  }

  protected async load(): Promise<FamilyDoc | null> {
    this.loadCache()
    this.loadOutbox()
    this.rebuildDoc()
    return this.doc
  }

  private persistCache(): void {
    if (!this.store) return
    try {
      const payload = {
        meta: this.doc.meta,
        metaEtag: this.metaEtag,
        shards: [...this.shards.entries()].map(([month, e]) => ({
          month,
          etag: e.etag,
          sha: e.sha,
          records: e.records,
        })),
      }
      this.store.setItem(this.cacheKey, canonicalStringify(payload))
    } catch {
      /* 配额不足时静默降级 */
    }
  }

  private loadCache(): void {
    if (!this.store) return
    const raw = this.store.getItem(this.cacheKey)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as {
        meta: FamilyDoc['meta']
        metaEtag: string | null
        shards: { month: MonthKey; etag: string | null; sha: string | null; records: PointsRecord[] }[]
      }
      if (parsed.meta) this.doc = { ...this.doc, meta: parsed.meta }
      this.metaEtag = parsed.metaEtag ?? null
      this.shards.clear()
      for (const s of parsed.shards ?? []) {
        this.shards.set(s.month, {
          etag: s.etag,
          sha: s.sha,
          records: normalizeRecords(s.records),
        })
      }
    } catch {
      /* 缓存损坏就当没有 */
    }
  }

  private saveOutbox(): void {
    if (!this.store) return
    try {
      if (this.outbox.length === 0) {
        this.store.removeItem(this.outboxKey)
      } else {
        this.store.setItem(this.outboxKey, JSON.stringify(this.outbox))
      }
    } catch {
      /* 忽略 */
    }
  }

  private loadOutbox(): void {
    if (!this.store) return
    const raw = this.store.getItem(this.outboxKey)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as Op[]
      if (Array.isArray(parsed)) this.outbox = parsed
    } catch {
      this.outbox = []
    }
  }

  /** 待同步条数（设置页展示） */
  get pendingCount(): number {
    return this.outbox.length
  }

  /** 冲突诊断用：当前 meta 的 blob sha（未同步过则为 null） */
  get metaBlobSha(): string | null {
    return this.metaSha
  }

  override async exportAll(): Promise<FamilyDoc> {
    // 导出前尽量拉全量，保证备份完整
    try {
      await this.refresh({ full: true })
    } catch {
      /* 拉不动就用现有缓存 */
    }
    return this.doc
  }

  override async importAll(doc: FamilyDoc): Promise<void> {
    // 导入即当作一批操作写出去 —— 走同一条操作流，合并语义一致
    const ops: Op[] = []
    for (const rec of doc.records) ops.push({ type: 'addRecord', record: rec })
    for (const chore of doc.meta.chores) ops.push({ type: 'upsertChore', chore })
    for (const member of doc.meta.members) ops.push({ type: 'upsertMember', member })
    ops.push({ type: 'putSettings', settings: doc.meta.settings })
    await this.commit(ops)
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 指数退避 + 抖动，避免两台设备同时重试又撞在一起 */
function backoffMs(attempt: number): number {
  const base = Math.min(200 * 2 ** attempt, 4_000)
  const jitter = Math.floor(Math.random() * 150)
  return base + jitter
}

/** 当月与上月 —— 这两个月的分片每次刷新都要校验，其余靠缓存 */
function hotMonths(now: Date): Set<MonthKey> {
  const today = dayKeyOf(now)
  return new Set<MonthKey>([monthKeyOf(today), monthKeyOf(addMonths(today, -1))])
}

/** 读进来的记录做一次防御性规范化，避免旧版本或损坏数据带崩聚合 */
function normalizeRecords(input: unknown): PointsRecord[] {
  if (!Array.isArray(input)) return []
  return input.filter(
    (r): r is PointsRecord =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as PointsRecord).id === 'string' &&
      typeof (r as PointsRecord).day === 'string' &&
      typeof (r as PointsRecord).points === 'number',
  )
}

function describeError(err: unknown): string {
  if (err instanceof AdapterError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}

function safeLocalStorage(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export type { AdapterStatus }
