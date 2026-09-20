/**
 * 设置
 *
 * 仓库地址是构建时烘焙好的，所以这一页只剩两件事：
 *
 *   1. **记分权限（令牌）** —— 每台要记分的设备填一次
 *   2. **成员名字**
 *
 * 这里刻意不放同步状态面板 —— 正常情况下同步是用户不该操心的事，把它做成常驻
 * 信息只会让人以为出了问题。真的出错时，应用顶部会弹提示条（见 App.tsx）。
 */

import { useEffect, useState } from 'react'
import { DEPLOYMENT, repoLabel } from '@/config/deployment'
import { buildInviteLink } from '@/config/invite'
import { useApp } from '@/state/store'
import { Banner, Sheet } from '@/components/ui'

export function SettingsScreen() {
  const config = useApp((s) => s.config)
  const doc = useApp((s) => s.doc)
  const connect = useApp((s) => s.connect)
  const renameMember = useApp((s) => s.renameMember)
  const refresh = useApp((s) => s.refresh)
  const status = useApp((s) => s.status)
  const pushToast = useApp((s) => s.pushToast)

  const [tokenDraft, setTokenDraft] = useState(config.token)
  const [showToken, setShowToken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [invite, setInvite] = useState<string | null>(null)

  useEffect(() => {
    setTokenDraft(config.token)
  }, [config.token])

  const hasToken = config.token.trim() !== ''
  const dirty = tokenDraft.trim() !== config.token.trim()

  const handleSaveToken = async () => {
    setBusy(true)
    await connect({ ...config, token: tokenDraft.trim() })
    setBusy(false)
    pushToast(tokenDraft.trim() ? '已保存，现在可以记分了' : '已清除令牌', 'ok')
  }

  const handleMakeInvite = () => {
    if (!hasToken) return
    setInvite(buildInviteLink(config.token))
  }

  const copyInvite = async () => {
    if (!invite) return
    try {
      await navigator.clipboard.writeText(invite)
      pushToast('链接已复制，发给家人即可', 'ok')
    } catch {
      // 非安全上下文或用户拒绝授权时，让用户手动复制（下面的输入框里能看到）
      pushToast('复制失败，请长按下面的链接手动复制', 'info')
    }
  }

  return (
    <>
      {/* 记分权限 */}
      <section className="card">
        <div className="card__head">
          <h3 className="card__title">🔑 记分权限</h3>
          {hasToken ? (
            <span className="sync-badge sync-badge--ok">
              <span className="sync-dot" aria-hidden="true" />
              可以记分
            </span>
          ) : (
            <span className="sync-badge">
              <span className="sync-dot" aria-hidden="true" />
              只能查看
            </span>
          )}
        </div>

        <Banner tone={hasToken ? 'ok' : 'info'}>
          {hasToken ? (
            <>这台设备已经能记分了。家人的手机如果还只能看，用下面的「邀请链接」发给他们。</>
          ) : (
            <>
              现在<strong>只能查看榜单</strong>。想记分需要填一个访问令牌 ——
              只在这台设备上填一次，之后就不用再管了。
            </>
          )}
        </Banner>

        <div className="field" style={{ marginTop: 14 }}>
          <label className="field__label" htmlFor="gh-token">
            访问令牌
          </label>
          <input
            id="gh-token"
            className="input input--mono"
            type={showToken ? 'text' : 'password'}
            value={tokenDraft}
            placeholder="github_pat_…"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setTokenDraft(e.target.value)}
          />
          <span className="field__hint">
            令牌只保存在这台设备上，<strong>不会</strong>进到网页里 ——
            任何人拿到链接也看不到它。
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {dirty && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleSaveToken}
              disabled={busy}
            >
              {busy ? '保存中…' : '保存'}
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setShowToken((v) => !v)}
          >
            {showToken ? '隐藏' : '显示'}
          </button>
          {hasToken && (
            <>
              <button type="button" className="btn btn--ghost btn--sm" onClick={handleMakeInvite}>
                🔗 邀请链接
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setTokenDraft('')}
              >
                清除
              </button>
            </>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowHelp(true)}>
            怎么申请？
          </button>
        </div>

        {invite && (
          <div style={{ marginTop: 14 }}>
            <Banner tone="warn">
              这条链接等同于仓库的写入权限，<strong>只发给家里人</strong>。
              对方打开一次就会自动配置好，之后可以随时在 GitHub 上撤销该令牌。
            </Banner>
            <textarea
              className="input input--mono"
              readOnly
              rows={3}
              value={invite}
              style={{ marginTop: 10, resize: 'vertical' }}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="邀请链接"
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn--primary btn--sm" onClick={copyInvite}>
                复制链接
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setInvite(null)}
              >
                收起
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 成员 */}
      <section className="card">
        <div className="card__head">
          <h3 className="card__title">👨👩👧 成员</h3>
        </div>
        {doc.meta.members.map((m) => (
          <div className="switch-row" key={m.id}>
            <div className="switch-row__text" style={{ flex: 1 }}>
              <div className="switch-row__title">{m.avatarEmoji} 名字</div>
            </div>
            <input
              className="input"
              style={{ maxWidth: 160 }}
              defaultValue={m.name}
              maxLength={8}
              aria-label={`修改 ${m.name} 的名字`}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== m.name) renameMember(m.id, v)
              }}
            />
          </div>
        ))}
      </section>

      {/* 数据位置 */}
      <section className="card">
        <div className="card__head">
          <h3 className="card__title">🗄️ 数据存在哪</h3>
          {status.pendingOps > 0 && (
            <span className="card__hint tnum">{status.pendingOps} 条待同步</span>
          )}
        </div>
        <p className="field__hint">
          全家人的记录都存在 <span className="mono-hint">{repoLabel(DEPLOYMENT)}</span> 这个
          GitHub 仓库里，两台手机读写同一份 —— 没有服务器，也没有数据库。
        </p>
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => refresh(true)}>
            🔄 手动同步一次
          </button>
        </div>
      </section>

      <p className="field__hint" style={{ textAlign: 'center', padding: '0 12px 20px' }}>
        家务积分榜 · 给小良和小影
      </p>

      {/* 申请指引 */}
      <Sheet open={showHelp} onClose={() => setShowHelp(false)} title="怎么申请令牌">
        <div className="sheet__body">
          <Banner tone="info">
            只是想让家人查看榜单？<strong>不用申请令牌</strong> —— 直接把这个网页的链接
            发给他们就能看。只有需要记分的设备才要填。
          </Banner>
          <ol
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              fontSize: 14,
              lineHeight: 1.6,
              paddingLeft: 20,
              listStyle: 'decimal',
            }}
          >
            <li>
              打开 GitHub，点右上角头像 → <strong>Settings</strong>
            </li>
            <li>
              左侧拉到最底 → <strong>Developer settings</strong>
            </li>
            <li>
              <strong>Personal access tokens</strong> → <strong>Fine-grained tokens</strong> →{' '}
              <strong>Generate new token</strong>
            </li>
            <li>
              <strong>Expiration</strong> 建议选最长或不过期（否则到期后要重新填一次）
            </li>
            <li>
              <strong>Repository access</strong> 选 <strong>Only select repositories</strong>，
              只勾选 <strong>{repoLabel(DEPLOYMENT)}</strong>
            </li>
            <li>
              <strong>Permissions</strong> → <strong>Repository permissions</strong> → 找到{' '}
              <strong>Contents</strong>，设为 <strong>Read and write</strong>
            </li>
            <li>生成后复制那串 github_pat_… 开头的字符串，粘贴到上面</li>
          </ol>
          <Banner tone="warn">
            一台设备填好之后，用「邀请链接」发给其他家人的手机，对方打开就能自动配置，
            不需要重复这些步骤。
          </Banner>
        </div>
      </Sheet>
    </>
  )
}
