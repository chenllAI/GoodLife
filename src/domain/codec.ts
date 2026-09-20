/**
 * 基础工具：id 生成、base64 编解码。
 *
 * base64 这一块看似琐碎，但有一个**会直接让功能挂掉**的陷阱：
 * 浏览器的 `btoa` 只接受 Latin1 字符，遇到中文会抛 InvalidCharacterError。
 * 也就是说 `btoa(JSON.stringify({ name: '小良' }))` 必然失败 —— 而这个应用的
 * 每一条数据里都有中文。必须走 TextEncoder 转字节再编码。
 */

// ---------------------------------------------------------------------------
// id
// ---------------------------------------------------------------------------

/**
 * 生成 uuid v4。跨设备合并依赖它作为唯一主键。
 * 优先用 crypto.randomUUID（需要安全上下文：https 或 localhost），
 * 退化路径用 getRandomValues 手工拼装。
 */
export function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()

  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  // 版本 4 + 变体 10xx
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80

  const hex: string[] = []
  for (let i = 0; i < 16; i++) hex.push((bytes[i] as number).toString(16).padStart(2, '0'))
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  )
}

/** 设备标识：用于区分两台手机各自记的账（提交者都是同一个 GitHub 账号） */
export function getDeviceId(): string {
  const KEY = 'chore.deviceId'
  try {
    const existing = localStorage.getItem(KEY)
    if (existing) return existing
    const id = newId()
    localStorage.setItem(KEY, id)
    return id
  } catch {
    // 隐私模式 / 无 localStorage —— 退化为进程内随机值
    return newId()
  }
}

// ---------------------------------------------------------------------------
// base64（UTF-8 安全）
// ---------------------------------------------------------------------------

/**
 * UTF-8 字符串 → base64。
 *
 * 路径：字符串 → UTF-8 字节 → 二进制字符串 → btoa。
 * 不能直接 `btoa(str)`，中文会抛异常。
 */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  // 分块处理，避免超长内容触发 String.fromCharCode 的参数个数上限
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK)
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

/**
 * base64 → UTF-8 字符串。
 *
 * GitHub Contents API 返回的 base64 里**带换行符**，直接 atob 不可靠，先剥掉
 * 所有空白字符。
 */
export function decodeBase64(b64: string): string {
  const cleaned = b64.replace(/\s/g, '')
  const binary = atob(cleaned)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}
