/**
 * 邀请链接
 *
 * 用来把「令牌」这件事从每台设备的手工填写，变成**一次点击**：
 * 已配置好的设备生成一条链接，发给另一台设备打开，令牌就自动填好了。
 *
 * 关键实现细节：令牌放在 URL 的 **fragment**（`#` 之后）而不是查询参数里。
 *
 *   - fragment **不会发给服务器**。GitHub Pages 的访问日志里不会有它；
 *     查询参数（`?t=...`）则会出现在日志里。
 *   - fragment 不参与 HTTP 请求，也不会被 CDN／反向代理记录。
 *
 * 应用读到之后会立刻把 fragment 从地址栏清掉（`replaceState`），避免它留在
 * 用户可见的地方或被再次分享出去。
 *
 * 仍然要提醒用户：这条链接等同于仓库的写入权限，请只发给家里人，
 * 发完可以让对方确认已生效，必要时随时在 GitHub 上撤销该令牌。
 */

const TOKEN_KEY = 't'

/** 生成邀请链接（在已配置令牌的设备上调用） */
export function buildInviteLink(token: string, base?: string): string {
  const origin =
    base ?? (typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '')
  return `${origin}#${TOKEN_KEY}=${encodeURIComponent(token)}`
}

/**
 * 从当前地址里取出邀请令牌，并立即把 fragment 从地址栏清除。
 * 没有则返回 null。
 */
export function consumeInviteToken(): string | null {
  if (typeof location === 'undefined' || typeof history === 'undefined') return null

  const hash = location.hash
  if (!hash || !hash.includes(`${TOKEN_KEY}=`)) return null

  let token: string | null = null
  try {
    const params = new URLSearchParams(hash.replace(/^#/, ''))
    token = params.get(TOKEN_KEY)
  } catch {
    token = null
  }

  // 无论解析成功与否都清掉 fragment —— 它带着凭据，不该留在地址栏里
  try {
    history.replaceState(null, '', location.pathname + location.search)
  } catch {
    /* 某些环境下 replaceState 不可用，忽略即可 */
  }

  const trimmed = token?.trim()
  return trimmed ? trimmed : null
}
