/// <reference types="vite/client" />

/**
 * 全局声明
 *
 * `vite/client` 提供了 CSS 副作用导入、`import.meta.env`、`?raw` 等 Vite 专有的
 * 模块类型声明 —— 缺了它，`import './styles/app.css'` 会报「找不到模块」。
 */

interface ImportMetaEnv {
  /** 数据仓库所有者（构建时注入，见 src/config/deployment.ts） */
  readonly VITE_GH_OWNER?: string
  /** 数据仓库名 */
  readonly VITE_GH_REPO?: string
  /** 数据所在分支 */
  readonly VITE_GH_BRANCH?: string
  /** 数据所在目录 */
  readonly VITE_GH_BASE_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
