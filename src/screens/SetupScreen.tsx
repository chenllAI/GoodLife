/**
 * 异常兜底页
 *
 * 仓库地址是构建时烘焙好的，所以正常情况下**永远不会**走到这里。
 * 唯一可能的触发方式是构建时把仓库地址配成了空值（比如 CI 里
 * `VITE_GH_OWNER=` 被显式设成空字符串）。
 *
 * 与其对着一个连不上任何地方的界面报奇怪的错，不如把原因说清楚。
 */

import { DEPLOYMENT, repoLabel } from '@/config/deployment'

export function SetupScreen() {
  return (
    <div className="app">
      <div
        className="app__main"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 40px)' }}
      >
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 52, lineHeight: 1.1 }} aria-hidden="true">
            🔧
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 900, marginTop: 10 }}>还没配置数据仓库</h1>
        </div>

        <section className="card">
          <p className="field__hint">
            这个页面在构建时没有指定 GitHub 数据仓库地址，所以不知道该去哪里读写数据。
          </p>
          <p className="field__hint" style={{ marginTop: 12 }}>
            如果你是部署这个页面的人：在构建时设置环境变量{' '}
            <span className="mono-hint">VITE_GH_OWNER</span> 和{' '}
            <span className="mono-hint">VITE_GH_REPO</span>，然后重新构建即可。
            具体步骤见项目根目录的 <span className="mono-hint">README.md</span>。
          </p>
          <p className="field__hint" style={{ marginTop: 12 }}>
            当前解析到的配置是 <span className="mono-hint">{repoLabel(DEPLOYMENT)}</span>
            {DEPLOYMENT.owner === '' || DEPLOYMENT.repo === '' ? '（不完整）' : ''}。
          </p>
        </section>
      </div>
    </div>
  )
}
