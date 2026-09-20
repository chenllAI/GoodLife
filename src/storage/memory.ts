/**
 * 内存适配器 —— 测试与演示用
 *
 * 支持注入读写失败，用于验证调用方对持久化失败的降级行为。
 */

import type { FamilyDoc } from '@/types'
import { createInitialDoc } from '@/domain/doc'
import { SimpleAdapter } from './simple'
import type { StorageCapabilities } from './types'

export interface MemoryAdapterOptions {
  initial?: FamilyDoc
  /** 让 persist 抛错，用于测试失败路径 */
  failOnPersist?: boolean
  failOnLoad?: boolean
  capabilities?: Partial<StorageCapabilities>
}

export class MemoryAdapter extends SimpleAdapter {
  private failOnPersist: boolean
  private failOnLoad: boolean

  constructor(opts: MemoryAdapterOptions = {}) {
    super(
      'memory',
      {
        multiDevice: false,
        canWrite: true,
        needsToken: false,
        offlineQueue: false,
        ...opts.capabilities,
      },
      opts.initial ?? createInitialDoc(),
    )
    this.failOnPersist = opts.failOnPersist ?? false
    this.failOnLoad = opts.failOnLoad ?? false
  }

  /** 测试辅助：切换持久化失败开关 */
  setFailure(opts: { persist?: boolean; load?: boolean }): void {
    if (opts.persist !== undefined) this.failOnPersist = opts.persist
    if (opts.load !== undefined) this.failOnLoad = opts.load
  }

  protected async persist(doc: FamilyDoc): Promise<void> {
    if (this.failOnPersist) throw new Error('模拟的持久化失败')
    this.snapshot = JSON.parse(JSON.stringify(doc)) as FamilyDoc
  }

  protected async load(): Promise<FamilyDoc | null> {
    if (this.failOnLoad) throw new Error('模拟的读取失败')
    return this.snapshot
  }

  private snapshot: FamilyDoc | null = null
}
