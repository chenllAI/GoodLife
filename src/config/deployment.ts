/**
 * 部署配置
 *
 * 把数据仓库地址**烘焙进构建产物**，这样任何人打开链接就直接进入榜单，
 * 不需要自己去填仓库信息。
 *
 * 可以在构建时用环境变量覆盖（见 .env.example）：
 *
 *     VITE_GH_OWNER=your-name
 *     VITE_GH_REPO=chore-data
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这里**只放仓库地址，绝不放 Token**。
 *
 * 仓库地址是公开信息，写进产物没有风险。但 Token 是凭据 —— 网页是公开的，
 * 一旦写进代码，任何人查看源码就能拿到它，等于把仓库的写权限公开送出，
 * 而且它会永久留在 git 历史里，撤销都撤不干净。
 *
 * 所以分工是：
 *   - **查看**：零配置。打开链接即可，匿名读公开仓库。
 *   - **记分**：每台设备要有 Token。用设置页的「邀请链接」把它变成一次点击。
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface DeploymentConfig {
  owner: string
  repo: string
  branch: string
  basePath: string
  /**
   * 仓库地址是否由部署固定。
   * 固定时设置页不再展示仓库输入框 —— 普通用户不需要也不应该改它。
   */
  locked: boolean
}

function env(name: string): string {
  const v = (import.meta.env as Record<string, string | undefined>)[name]
  return typeof v === 'string' ? v.trim() : ''
}

export const DEPLOYMENT: DeploymentConfig = {
  owner: env('VITE_GH_OWNER') || 'chenllAI',
  repo: env('VITE_GH_REPO') || 'GoodLife',
  branch: env('VITE_GH_BRANCH') || 'main',
  basePath: env('VITE_GH_BASE_PATH') || 'data',
  locked: true,
}

/** 仓库的可读描述，设置页用来展示「数据存在哪」 */
export function repoLabel(c: { owner: string; repo: string }): string {
  return `${c.owner}/${c.repo}`
}
