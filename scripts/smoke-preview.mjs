/**
 * 预览冒烟检查
 *
 * 起一个 `vite preview`，用真实的 HTTP 请求验证构建产物能跑起来。
 * 这一层专抓**单元测试看不见的问题**：base 路径错了、产物没引用上、
 * SPA 回落到不了 —— 恰好都是部署到 GitHub Pages 之后才会暴露的那一类。
 */

import { spawn, execSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 4319
const BASE = `http://localhost:${PORT}`

const problems = []
const notes = []

function ok(m) {
  notes.push(`  ✓ ${m}`)
}
function fail(m) {
  problems.push(m)
}

async function waitForServer(url, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.status > 0) return true
    } catch {
      /* 还没起来 */
    }
    await sleep(300)
  }
  return false
}

const isWin = process.platform === 'win32'

// Windows 上把整条命令作为字符串交给 shell，避免 args 转义问题与弃用警告
const server = isWin
  ? spawn(`npx vite preview --port ${PORT} --strictPort`, {
      stdio: 'ignore',
      shell: true,
      windowsHide: true,
    })
  : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
      stdio: 'ignore',
    })

let exitCode = 0

/**
 * Windows 上 npx 会派生孙进程，必须连整棵进程树一起杀，否则端口不释放。
 *
 * 用**同步**的 execSync 而不是 spawn：异步子进程的句柄在 Node 退出时可能还没关闭，
 * 会触发 libuv 的 `!(handle->flags & UV_HANDLE_CLOSING)` 断言刷屏。
 * 同步执行能保证清理在退出前彻底完成。
 */
function shutdown() {
  if (isWin) {
    try {
      execSync(`taskkill /pid ${server.pid} /f /t`, { stdio: 'ignore' })
    } catch {
      /* 进程可能已经退出了 */
    }
  } else {
    server.kill()
  }
}

try {
  const up = await waitForServer(BASE + '/')
  if (!up) {
    console.error(`✗ 预览服务没能在超时时间内启动（端口 ${PORT} 可能被占用）`)
    process.exit(1)
  }

  // 1. 首页可达
  const home = await fetch(BASE + '/')
  if (home.status !== 200) {
    fail(`首页返回 ${home.status}，期望 200`)
  } else {
    ok('首页返回 200')
  }

  const html = await home.text()
  if (!html.includes('id="root"')) {
    fail('首页里找不到 #root 挂载点')
  } else {
    ok('首页包含 #root 挂载点')
  }

  // 2. 首页引用的脚本与样式能取到（base 路径是否正确）
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((v) => v && !/^(https?:)?\/\//.test(v) && !v.startsWith('data:'))

  let assetCount = 0
  for (const ref of refs) {
    const url = new URL(ref, BASE + '/').href
    const res = await fetch(url)
    if (res.status !== 200) {
      fail(`资源 ${ref} 返回 ${res.status} —— base 路径可能配错了`)
    } else {
      assetCount++
    }
  }
  if (assetCount > 0) ok(`首页引用的 ${assetCount} 个资源都能取到（base 路径正确）`)

  // 3. 产物里确实有构建好的 JS
  const scripts = refs.filter((r) => r.endsWith('.js'))
  if (scripts.length === 0) {
    fail('首页没有引用任何 JS 产物 —— 可能用了开发模式的入口')
  } else {
    ok(`引用了 ${scripts.length} 个构建后的 JS 文件`)
  }

  // 4. 未知路径的回落（Pages 靠 404.html 实现）
  const unknown = await fetch(BASE + '/some/unknown/path')
  if (unknown.status !== 404 && unknown.status !== 200) {
    fail(`未知路径返回 ${unknown.status}，期望 200（SPA 回落）或 404`)
  } else {
    const body = await unknown.text()
    if (unknown.status === 404 && !body.includes('id="root"')) {
      fail('未知路径返回了 404，但内容不是应用外壳 —— 检查 vite 插件的 404.html 生成')
    } else {
      ok(`未知路径能回落到应用外壳（HTTP ${unknown.status}）`)
    }
  }

  // 5. favicon 存在（Pages 上 404 的 favicon 会在控制台刷错误，很难看）
  const icon = await fetch(BASE + '/favicon.svg')
  if (icon.status !== 200) {
    fail(`favicon.svg 返回 ${icon.status}`)
  } else {
    ok('favicon.svg 可访问')
  }
} catch (err) {
  fail(`冒烟过程中抛错：${err instanceof Error ? err.message : String(err)}`)
} finally {
  shutdown()
}

console.log('\n预览冒烟检查')
console.log('─'.repeat(56))
for (const n of notes) console.log(n)

if (problems.length > 0) {
  console.log('')
  for (const p of problems) console.log(`  ✗ ${p}`)
  console.log('─'.repeat(56))
  console.log(`\n✗ 不通过：${problems.length} 项问题\n`)
  exitCode = 1
} else {
  console.log('─'.repeat(56))
  console.log('\n✓ 全部通过 —— 构建产物在真实 HTTP 下能正常运行\n')
}

process.exit(exitCode)
