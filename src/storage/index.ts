/**
 * 适配器工厂与配置持久化
 *
 * 应用只支持 GitHub 仓库存储 —— 需求是「两台手机读写同一份」，本机存储做不到这件事。
 * 配置存在本机 localStorage 里（仓库地址和 Token 都属于「这台设备」的信息，
 * 不该写进共享仓库）。
 */

import type { StorageAdapter } from './types'
import type { GithubConfig, KeyValueStore } from './types'
import { DEPLOYMENT } from '@/config/deployment'
import { MemoryAdapter } from './memory'
import { GithubAdapter } from './github/adapter'

const CONFIG_KEY = 'chore.storageConfig.v2'

function resolveStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * 读取配置。
 *
 * 仓库地址（owner/repo/branch/basePath）来自**构建时烘焙的部署配置**，
 * 所以随便谁打开链接都是直接进入应用，不需要填任何东西。
 * 本机存储里只可能有一项用户数据：**Token**（每台记分的设备各自填一次）。
 *
 * 本机存过完整配置时以本机为准 —— 这样开发时可以指向别的仓库。
 */
export function loadStorageConfig(store: KeyValueStore | null = resolveStore()): GithubConfig {
  const fallback: GithubConfig = { ...DEPLOYMENT, token: '' }

  if (!store) return fallback
  // 兼容旧版本存下来的 { mode, github } 结构
  const raw = store.getItem(CONFIG_KEY) ?? store.getItem('chore.storageConfig.v1')
  if (!raw) return fallback

  try {
    const parsed = JSON.parse(raw) as Partial<GithubConfig> & {
      github?: Partial<GithubConfig>
    }
    const source = (parsed.github ?? parsed) as Partial<GithubConfig>
    const merged: GithubConfig = {
      owner: source.owner?.trim() || fallback.owner,
      repo: source.repo?.trim() || fallback.repo,
      branch: source.branch?.trim() || fallback.branch,
      basePath: source.basePath?.trim() || fallback.basePath,
      token: source.token ?? '',
    }
    return merged
  } catch {
    return fallback
  }
}

export function saveStorageConfig(
  config: GithubConfig,
  store: KeyValueStore | null = resolveStore(),
): void {
  if (!store) return
  try {
    store.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch {
    /* 配额不足时忽略：下次打开会回到未配置状态，但不会崩 */
  }
}

/** 配置是否完整到可以尝试连接 */
export function isGithubConfigUsable(c: GithubConfig): boolean {
  return c.owner.trim() !== '' && c.repo.trim() !== ''
}

export interface CreateAdapterOptions {
  config: GithubConfig
  fetchImpl?: typeof fetch
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  /** 测试用：强制使用内存适配器 */
  forceMemory?: boolean
}

export function createAdapter(opts: CreateAdapterOptions): StorageAdapter {
  if (opts.forceMemory) return new MemoryAdapter()

  return new GithubAdapter({
    config: opts.config,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  })
}

export { MemoryAdapter, GithubAdapter }
export type { StorageAdapter }
export * from './types'
