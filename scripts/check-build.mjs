/**
 * 构建产物检查
 *
 * 这里断言的都是**部署到 GitHub Pages 时才会暴露**的问题：
 *
 *   1. `404.html` 必须存在且与 index.html 一致 —— Pages 没有 URL 重写，
 *      未知路径会 404，没有回落文件的话用户看到的是 GitHub 的默认 404 页。
 *   2. `.nojekyll` 必须存在 —— 否则 Jekyll 会吞掉带下划线的产物目录。
 *   3. 资源引用必须是**相对路径** —— 项目站点的地址是 `user.github.io/<仓库名>/`，
 *      绝对路径 `/assets/...` 会直接 404。
 *   4. **产物里绝不能出现 Token。** 这是「Token 只存在用户手机上、不会被打包进
 *      网页」这个承诺的唯一硬性保证 —— 网页是公开的，一旦打进去就等于公开泄露。
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const DIST = 'dist'
const problems = []
const notes = []

function fail(msg) {
  problems.push(msg)
}
function ok(msg) {
  notes.push(`  ✓ ${msg}`)
}

// ---------------------------------------------------------------------------
// 1. 关键文件存在
// ---------------------------------------------------------------------------

if (!existsSync(DIST)) {
  console.error('✗ 找不到 dist/ —— 请先运行 npm run build')
  process.exit(1)
}

const indexPath = join(DIST, 'index.html')
if (!existsSync(indexPath)) {
  fail('缺少 dist/index.html')
} else {
  ok('dist/index.html 存在')
}

const notFoundPath = join(DIST, '404.html')
if (!existsSync(notFoundPath)) {
  fail('缺少 dist/404.html —— GitHub Pages 上未知路径会显示 GitHub 默认 404 页而不是应用')
} else {
  const a = readFileSync(indexPath, 'utf8')
  const b = readFileSync(notFoundPath, 'utf8')
  if (a !== b) {
    fail('dist/404.html 与 index.html 内容不一致 —— 用户会看到一个空白或报错的页面')
  } else {
    ok('dist/404.html 是 index.html 的副本')
  }
}

if (!existsSync(join(DIST, '.nojekyll'))) {
  fail('缺少 dist/.nojekyll —— GitHub Pages 的 Jekyll 处理会吞掉带下划线的目录')
} else {
  ok('dist/.nojekyll 存在')
}

// ---------------------------------------------------------------------------
// 2. 资源引用必须是相对路径
// ---------------------------------------------------------------------------

if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, 'utf8')
  // 抓 src="..." / href="..." 里指向本地资源的值
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((v) => v && !/^(https?:)?\/\//.test(v) && !v.startsWith('data:'))

  const absolute = refs.filter((r) => r.startsWith('/'))
  if (absolute.length > 0) {
    fail(
      `index.html 里有绝对路径引用：${absolute.join(', ')}\n` +
        '      项目站点部署在 user.github.io/<仓库名>/ 下，绝对路径会 404。' +
        'vite.config.ts 里的 base 应为 "./"',
    )
  } else {
    ok(`资源引用都是相对路径（共 ${refs.length} 处）`)
  }

  // 引用到的产物必须真的存在
  const missing = refs
    .filter((r) => !/^https?:/.test(r))
    .map((r) => r.replace(/^\.\//, ''))
    .filter((r) => r && !existsSync(join(DIST, r)))
  if (missing.length > 0) {
    fail(`index.html 引用了不存在的文件：${missing.join(', ')}`)
  } else if (refs.length > 0) {
    ok('引用的产物文件都存在')
  }
}

// ---------------------------------------------------------------------------
// 3. Token 泄漏扫描 —— 最重要的一项
// ---------------------------------------------------------------------------

const TOKEN_PATTERNS = [
  { name: 'GitHub 细粒度 Token', re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'GitHub 经典 Token', re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'Authorization 头硬编码', re: /Bearer\s+[A-Za-z0-9_\-.]{25,}/ },
]

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const files = walk(DIST)
const scannable = files.filter((f) => ['.js', '.css', '.html', '.json', '.map'].includes(extname(f)))

const leaks = []
for (const file of scannable) {
  const text = readFileSync(file, 'utf8')
  for (const { name, re } of TOKEN_PATTERNS) {
    const m = re.exec(text)
    if (m) leaks.push(`${file}: 疑似${name}（${m[0].slice(0, 14)}…）`)
  }
}

if (leaks.length > 0) {
  fail(
    `构建产物里发现疑似 Token：\n${leaks.map((l) => `        ${l}`).join('\n')}\n` +
      '      Token 绝不能进入产物 —— 网页是公开的，打进去就等于公开泄露。',
  )
} else {
  ok(`产物中无 Token 泄漏（扫描了 ${scannable.length} 个文件）`)
}

// ---------------------------------------------------------------------------
// 结果
// ---------------------------------------------------------------------------

console.log('\n构建产物检查')
console.log('─'.repeat(56))
for (const n of notes) console.log(n)

if (problems.length > 0) {
  console.log('')
  for (const p of problems) console.log(`  ✗ ${p}`)
  console.log('─'.repeat(56))
  console.log(`\n✗ 不通过：${problems.length} 项问题\n`)
  process.exit(1)
}

console.log('─'.repeat(56))
console.log('\n✓ 全部通过 —— 产物可以直接部署到 GitHub Pages\n')
