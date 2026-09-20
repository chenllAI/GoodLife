import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

/**
 * GitHub Pages 部署要点（这三条都是上线时最容易翻车的地方）：
 *
 * 1. `base: './'` —— 用相对路径，这样无论仓库叫什么名字（用户站点
 *    `user.github.io` 还是项目站点 `user.github.io/<repo>/`）都能正确加载资源。
 *    本应用没有客户端路由，页面 URL 只有根路径一个，相对路径完全安全。
 * 2. `public/.nojekyll` —— 阻止 GitHub Pages 的 Jekyll 处理，否则带下划线的
 *    构建产物目录会被吞掉。
 * 3. `dist/404.html` —— Pages 没有 URL 重写，未知路径会返回 404。复制一份
 *    index.html 作为 404 页面，任何路径都能回落到应用外壳。
 *
 * 另外：生产构建会注入 CSP meta。Pages 无法设置响应头，meta 是唯一手段。
 * 只在生产注入 —— 开发模式下 Vite 的 HMR 依赖内联脚本，严格 CSP 会把它拦掉。
 */
export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    react(),
    // 构建后把 index.html 复制为 404.html。
    //
    // GitHub Pages 没有 URL 重写：未知路径返回 404，此时 Pages 会去找 404.html。
    // 没有这个文件，用户看到的是 GitHub 的默认 404 页，而不是应用。
    //
    // 用 writeBundle 而不是 generateBundle —— 后者触发时 Vite 的 html 插件
    // 还没把处理好的 index.html 放进 bundle，拿到的会是 undefined。
    {
      name: 'emit-404-fallback',
      apply: 'build',
      writeBundle(options) {
        const outDir = options.dir ?? 'dist'
        const index = path.join(outDir, 'index.html')
        if (fs.existsSync(index)) {
          fs.copyFileSync(index, path.join(outDir, '404.html'))
        }
      },
    },
    // 生产环境注入 CSP。
    //
    // Pages 无法设置响应头，meta 是唯一手段。这条策略的意义在于收紧 XSS 面：
    // Token 存在 localStorage 里，任何能执行脚本的注入都能把它读走。
    //
    // 只在构建时注入 —— 开发模式下 Vite 的 HMR 依赖内联脚本，严格 CSP 会把它拦掉。
    // 同理 connect-src 只放行 api.github.com，因为那是唯一需要访问的外部域。
    {
      name: 'inject-csp',
      apply: 'build',
      transformIndexHtml(html) {
        const csp = [
          "default-src 'self'",
          "script-src 'self'",
          // 组件里用了内联 style（进度条宽度、热力图色阶），所以 style-src 必须放开
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "font-src 'self'",
          "connect-src 'self' https://api.github.com",
          "base-uri 'self'",
          "form-action 'none'",
          "object-src 'none'",
        ].join('; ')
        return html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        )
      },
    },
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    // 数据文件按月分片，应用本身很小，不需要更细的拆包
    chunkSizeWarningLimit: 900,
  },
  define: {
    __IS_PROD__: JSON.stringify(command === 'build'),
  },
}))
