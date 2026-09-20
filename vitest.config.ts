import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    // 领域层与存储层跑在 node 下（更快，也更能暴露对 DOM 的意外依赖）；
    // 组件测试通过文件头部的 `// @vitest-environment jsdom` 单独切换。
    environment: 'node',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      include: ['src/domain/**', 'src/storage/**'],
    },
  },
})
