/**
 * 简单适配器基类
 *
 * 「简单」指的是同步语义简单：没有远端、没有冲突、没有离线队列。本地存储和
 * 内存存储都适用，它们与 GitHub 适配器的差别只在持久化方式上。
 *
 * 关键点是：**所有写入都必须经过 domain/apply 里的纯函数 applyOps。**
 * 这样本地模式和共享模式的合并语义是同一套，不会出现「本地删掉的记录同步后
 * 又冒出来」这类只在某一种模式下才有的怪问题。
 */

import type { DayRange, FamilyDoc, Op, PointsRecord } from '@/types'
import { applyOps } from '@/domain/apply'
import { recordsInRange } from '@/domain/aggregate'
import { createInitialDoc } from '@/domain/doc'
import type {
  AdapterKind,
  AdapterStatus,
  CommitResult,
  InitResult,
  StorageAdapter,
  StorageCapabilities,
} from './types'

type Listener = (doc: FamilyDoc, status: AdapterStatus) => void

export abstract class SimpleAdapter implements StorageAdapter {
  protected doc: FamilyDoc
  protected status: AdapterStatus
  private listeners = new Set<Listener>()

  constructor(
    readonly kind: AdapterKind,
    readonly capabilities: StorageCapabilities,
    initial: FamilyDoc,
  ) {
    this.doc = initial
    this.status = {
      kind,
      state: 'idle',
      pendingOps: 0,
      lastSyncedAt: null,
      readOnly: !capabilities.canWrite,
      message: null,
      rateLimitResetAt: null,
    }
  }

  /** 子类实现：把文档写到持久层 */
  protected abstract persist(doc: FamilyDoc): Promise<void>
  /** 子类实现：从持久层读文档；返回 null 表示尚无数据 */
  protected abstract load(): Promise<FamilyDoc | null>

  async init(): Promise<InitResult> {
    this.setStatus({ state: 'loading' })
    try {
      const loaded = await this.load()
      if (loaded) {
        this.doc = loaded
      } else {
        await this.persist(this.doc)
      }
      this.setStatus({
        state: 'ready',
        lastSyncedAt: new Date().toISOString(),
        message: null,
      })
      this.emit()
      return { ok: true, readOnly: !this.capabilities.canWrite, message: null }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setStatus({ state: 'error', message })
      this.emit()
      return { ok: false, readOnly: !this.capabilities.canWrite, message }
    }
  }

  read(): FamilyDoc {
    return this.doc
  }

  readRecords(range: DayRange): PointsRecord[] {
    return recordsInRange(this.doc.records, range)
  }

  async commit(ops: readonly Op[]): Promise<CommitResult> {
    // 先乐观应用，UI 立刻响应
    this.doc = applyOps(this.doc, ops)
    this.setStatus({ state: 'syncing' })
    this.emit()

    try {
      await this.persist(this.doc)
      this.setStatus({
        state: 'ready',
        lastSyncedAt: new Date().toISOString(),
        message: null,
        pendingOps: 0,
      })
      this.emit()
      return { applied: true, queued: false, conflicts: 0 }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setStatus({ state: 'error', message })
      this.emit()
      return { applied: false, queued: false, conflicts: 0 }
    }
  }

  async flushPending(): Promise<CommitResult> {
    // 简单适配器没有离线队列，写入即持久化
    return { applied: true, queued: false, conflicts: 0 }
  }

  async refresh(): Promise<void> {
    try {
      const loaded = await this.load()
      if (loaded) {
        this.doc = loaded
        this.setStatus({ state: 'ready', lastSyncedAt: new Date().toISOString(), message: null })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setStatus({ state: 'error', message })
    }
    this.emit()
  }

  getStatus(): AdapterStatus {
    return this.status
  }

  /** 本地类适配器没有远端可采样，直接用本机时钟 */
  nowMs(): number {
    return Date.now()
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  async exportAll(): Promise<FamilyDoc> {
    return this.doc
  }

  async importAll(doc: FamilyDoc): Promise<void> {
    this.doc = doc
    await this.persist(this.doc)
    this.setStatus({ state: 'ready', lastSyncedAt: new Date().toISOString(), message: null })
    this.emit()
  }

  dispose(): void {
    this.listeners.clear()
  }

  protected setStatus(patch: Partial<AdapterStatus>): void {
    this.status = { ...this.status, ...patch }
  }

  protected emit(): void {
    for (const fn of this.listeners) fn(this.doc, this.status)
  }

  protected static freshDoc(): FamilyDoc {
    return createInitialDoc()
  }
}
