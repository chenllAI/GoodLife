/**
 * 测试环境准备
 *
 * 领域层与存储层跑在 node 环境（更快，且能暴露对 DOM 的意外依赖）；
 * 需要 DOM 的组件测试在文件头部用 `// @vitest-environment jsdom` 单独切换。
 */
import '@testing-library/jest-dom/vitest'
