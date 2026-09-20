/**
 * 视觉自查截图
 *
 * 应用只支持 GitHub 仓库存储，本机没有任何数据。所以这个脚本做两件事：
 *
 *   1. 在页面加载前往 localStorage 里写入一份仓库配置
 *   2. **stub 掉 `window.fetch`**，伪造一个 GitHub Contents API 的响应，喂进
 *      一段家务记录
 *
 * 好处是截出来的图走的是**真实的 GitHub 适配器路径**（分片解析、base64 解码、
 * 合并），而不是绕过存储层塞一份假数据。
 *
 * 用本机已装的 Chrome（puppeteer-core，零下载）。产物在 screenshots/（已 gitignore）。
 *
 * 用法：先 `npm run dev`，再 `node scripts/screenshot.mjs`
 */

import puppeteer from 'puppeteer-core'
import { existsSync, mkdirSync, rmSync } from 'node:fs'

const URL_BASE = process.env.PREVIEW_URL ?? 'http://localhost:5173'
const OUT = 'screenshots'

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

const executablePath = CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error('✗ 找不到 Chrome 或 Edge，无法截图')
  process.exit(1)
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
})

const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })

const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

/**
 * 装载假仓库 + 假 fetch。
 * 这段在页面上下文里执行，所以只能用浏览器里有的 API。
 */
await page.evaluateOnNewDocument(() => {
  // 注意：**故意不注入任何仓库配置**。
  //
  // 仓库地址是构建时烘焙进产物的，所以一个全新用户（本机存储为空）打开页面
  // 就应该直接看到榜单。这个脚本顺带就在验证这条 —— 如果哪天有人把烘焙配置
  // 改坏了，这里会立刻失败。

  localStorage.setItem('chore.deviceId', 'screenshot-device')

  // ---- 造一段两周的家务记录 ----
  const pad = (n) => (n < 10 ? '0' + n : String(n))
  const dayKey = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const daysAgo = (n) => {
    const d = new Date()
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() - n)
    return dayKey(d)
  }

  // [家务id, 名称, 图标, 分类, 难度, 分值, 成员, 几天前]
  const PLAN = [
    ['preset-sweep-floor', '扫地', '🧹', '清洁打扫', 1, 2, 0, 0],
    ['preset-wash-dishes', '洗碗', '🍽️', '厨房餐食', 2, 3, 1, 0],
    ['preset-mop-floor', '拖地', '🧽', '清洁打扫', 3, 5, 1, 0],
    ['preset-take-out-trash', '倒垃圾', '🗑️', '清洁打扫', 1, 2, 0, 1],
    ['preset-hang-laundry', '晾衣服', '🧺', '洗衣晾晒', 1, 2, 0, 1],
    ['preset-cook-meal', '做饭炒菜', '🍳', '厨房餐食', 4, 7, 1, 1],
    ['preset-water-plants', '浇花', '🪴', '宠物花草', 1, 2, 1, 1],
    ['preset-fold-clothes', '收衣服叠衣服', '👚', '洗衣晾晒', 2, 3, 0, 2],
    ['preset-feed-fish', '喂鱼', '🐟', '宠物花草', 1, 2, 0, 2],
    ['preset-cook-rice', '淘米煮饭', '🍚', '厨房餐食', 1, 2, 1, 2],
    ['preset-clean-stove', '清理灶台', '🔥', '厨房餐食', 3, 5, 0, 3],
    ['preset-make-bed', '叠被子铺床', '🛌', '整理收纳', 1, 2, 1, 3],
    ['preset-clean-shoes', '刷鞋', '👟', '洗衣晾晒', 3, 4, 1, 3],
    ['preset-wipe-table', '擦桌子', '🧴', '清洁打扫', 1, 2, 0, 4],
    ['preset-wash-clothes', '洗衣服', '👕', '洗衣晾晒', 2, 3, 1, 4],
    ['preset-grocery-shopping', '买菜', '🛒', '厨房餐食', 3, 4, 0, 5],
    ['preset-clean-fish-tank', '清洗鱼缸', '🐠', '宠物花草', 4, 6, 1, 5],
    ['preset-change-bedding', '换床单被套', '🛏️', '清洁打扫', 3, 5, 0, 6],
    ['preset-scrub-toilet', '刷马桶', '🚽', '清洁打扫', 4, 6, 1, 6],
    // 上一周，让环比有数
    ['preset-clean-bathroom', '清洁卫生间', '🚿', '清洁打扫', 5, 8, 0, 8],
    ['preset-wipe-window', '擦窗户', '🪟', '清洁打扫', 3, 5, 1, 8],
    ['preset-pickup-parcel', '取快递', '📦', '其他杂项', 1, 2, 1, 9],
    ['preset-organize-wardrobe', '整理衣柜', '👗', '整理收纳', 4, 6, 0, 10],
    ['preset-bills', '交水电费记账', '💡', '其他杂项', 2, 3, 1, 12],
    ['preset-organize-shoes', '整理鞋柜', '🥾', '整理收纳', 3, 5, 0, 14],
  ]

  const members = ['member-xiaoliang', 'member-xiaoying']
  const perDay = {}
  const records = PLAN.map((p, i) => {
    const [choreId, name, emoji, category, difficulty, points, mi, ago] = p
    const day = daysAgo(ago)
    const n = (perDay[day] = (perDay[day] ?? 0) + 1)
    const [y, m, d] = day.split('-').map(Number)
    const at = new Date(y, m - 1, d, 9 + Math.floor(n / 3), (n % 3) * 20, 0, 0).toISOString()
    return {
      id: `demo-${String(i).padStart(3, '0')}`,
      memberId: members[mi],
      choreId,
      choreName: name,
      choreEmoji: emoji,
      category,
      difficulty,
      points,
      at,
      day,
      createdBy: 'screenshot-device',
      createdAt: at,
      updatedAt: at,
    }
  })

  // 按月份分片（与适配器的分片规则一致）
  const shards = {}
  for (const r of records) {
    const month = r.day.slice(0, 7)
    ;(shards[month] ??= []).push(r)
  }

  const b64 = (s) => {
    const bytes = new TextEncoder().encode(s)
    let bin = ''
    for (const byte of bytes) bin += String.fromCharCode(byte)
    return btoa(bin)
  }

  // ---- 假 fetch ----
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (!url.includes('api.github.com')) return realFetch(input, init)

    const method = (init?.method ?? 'GET').toUpperCase()
    const u = new URL(url)
    const json = (status, body) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          'content-type': 'application/json',
          date: new Date().toUTCString(),
          etag: `"demo-${url.length}"`,
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-limit': '5000',
        },
      })

    // 仓库信息
    if (/^\/repos\/[^/]+\/[^/]+$/.test(u.pathname)) {
      return json(200, { private: false, default_branch: 'main' })
    }

    const contents = /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.*)$/.exec(u.pathname)
    if (!contents) return json(404, { message: 'Not Found' })

    const path = contents[3]

    if (method === 'PUT') {
      return json(200, { commit: { sha: 'demo-commit', html_url: '' } })
    }

    // 目录：records
    if (path === 'data/records' || path === 'data/records/') {
      return json(
        200,
        Object.keys(shards).map((month) => ({
          name: `records-${month}.json`,
          path: `data/records/records-${month}.json`,
          sha: `sha-${month}`,
          size: 100,
          type: 'file',
        })),
      )
    }

    const shardMatch = /^data\/records\/records-(\d{4}-\d{2})\.json$/.exec(path)
    if (shardMatch) {
      const month = shardMatch[1]
      const body = JSON.stringify({
        schemaVersion: 1,
        month,
        records: shards[month] ?? [],
      })
      return json(200, {
        name: `records-${month}.json`,
        path,
        sha: `sha-${month}`,
        size: body.length,
        type: 'file',
        content: b64(body),
        encoding: 'base64',
      })
    }

    // meta.json 故意返回 404 —— 应用会用它内置的成员与预置家务目录
    return json(404, { message: 'Not Found' })
  }
})

async function shoot(name, { fullPage = true } = {}) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage })
  console.log(`  ✓ ${OUT}/${name}.png`)
}

async function clickTab(label) {
  const ok = await page.evaluate((l) => {
    const btn = [...document.querySelectorAll('.tabbar__item')].find((b) =>
      b.textContent?.includes(l),
    )
    if (!btn) return false
    btn.click()
    return true
  }, label)
  if (!ok) throw new Error(`找不到页签：${label}`)
  await new Promise((r) => setTimeout(r, 450))
}

console.log(`\n视觉自查截图（${executablePath.split('/').pop()}）`)
console.log('─'.repeat(56))

await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 30_000 })
await page.waitForSelector('.member-grid', { timeout: 15_000 })
await new Promise((r) => setTimeout(r, 800))

// 首次打开应当**直接进入榜单** —— 不需要任何 GitHub 配置操作。
// 这是本次改动的核心诉求，所以在这里硬性断言一次。
const boot = await page.evaluate(() => ({
  hasMemberGrid: !!document.querySelector('.member-grid'),
  hasSetupScreen: /还没配置数据仓库/.test(document.body.innerText),
  repoFromStoredConfig: localStorage.getItem('chore.storageConfig.v2'),
  url: location.href,
}))
if (boot.hasSetupScreen || !boot.hasMemberGrid) {
  console.error('\n✗ 打开后没有直接进入榜单 —— 烘焙的仓库配置可能失效了')
  console.error('  ', JSON.stringify(boot))
  await browser.close()
  process.exit(1)
}
console.log('  ✓ 全新用户打开即进入榜单（无需任何配置操作）\n')

await shoot('01-榜单')

await clickTab('明细')
await shoot('02-明细')

await clickTab('家务')
await shoot('03-家务')

await clickTab('设置')
await shoot('04-设置')

// 新增家务弹层
await clickTab('家务')
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('新增家务'),
  )
  if (btn) btn.click()
})
await new Promise((r) => setTimeout(r, 400))
await shoot('05-新增家务', { fullPage: false })

// 记一笔
await page.keyboard.press('Escape')
await new Promise((r) => setTimeout(r, 300))
await page.evaluate(() => {
  const fab = document.querySelector('.tabbar__fab')
  if (fab) fab.click()
})
await new Promise((r) => setTimeout(r, 400))
await page.evaluate(() => {
  const opts = document.querySelectorAll('.member-option')
  if (opts[1]) opts[1].click()
  const tiles = document.querySelectorAll('.chore-tile')
  if (tiles[2]) tiles[2].click()
})
await new Promise((r) => setTimeout(r, 350))
await shoot('06-记一笔', { fullPage: false })

await browser.close()

console.log('─'.repeat(56))
if (consoleErrors.length > 0) {
  console.log(`\n⚠️  浏览器控制台有 ${consoleErrors.length} 条错误：`)
  for (const e of consoleErrors.slice(0, 10)) console.log(`   ${e}`)
} else {
  console.log('\n✓ 浏览器控制台无错误')
}
console.log('')
