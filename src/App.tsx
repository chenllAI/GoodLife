/**
 * 应用外壳
 *
 * 底部导航：榜单 / 明细 / [记一笔] / 家务 / 设置。
 * 「记一笔」放在正中并抬高，是拇指最容易够到的位置，也是这个应用最高频的动作。
 *
 * 同步状态**只在出问题时出现**（顶部那个小角标）。正常情况下同步是用户不该操心的
 * 事，把它做成常驻信息只会让人以为出了问题。
 */

import { useEffect, useState } from 'react'
import { useApp } from '@/state/store'
import { LeaderboardScreen } from '@/screens/LeaderboardScreen'
import { HistoryScreen } from '@/screens/HistoryScreen'
import { ChoresScreen } from '@/screens/ChoresScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { SetupScreen } from '@/screens/SetupScreen'
import { AddRecordSheet } from '@/screens/AddRecordSheet'
import { Banner, SyncBadge, ToastHost } from '@/components/ui'

type Tab = 'board' | 'history' | 'chores' | 'settings'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'board', label: '榜单', icon: '🏆' },
  { id: 'history', label: '明细', icon: '📋' },
  // 中间是「记一笔」按钮，见下方 JSX
  { id: 'chores', label: '家务', icon: '🧹' },
  { id: 'settings', label: '设置', icon: '⚙️' },
]

export default function App() {
  const ready = useApp((s) => s.ready)
  const needsSetup = useApp((s) => s.needsSetup)
  const bootError = useApp((s) => s.bootError)
  const status = useApp((s) => s.status)
  const toasts = useApp((s) => s.toasts)
  const bootstrap = useApp((s) => s.bootstrap)
  const refresh = useApp((s) => s.refresh)
  const doc = useApp((s) => s.doc)

  const [tab, setTab] = useState<Tab>('board')
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  // 回到前台时刷新一次，顺便带上离线队列的补传
  useEffect(() => {
    if (needsSetup) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh, needsSetup])

  if (!ready) {
    return (
      <div className="app">
        <div className="app__loading">
          <div className="loading-emoji" aria-hidden="true">
            🧹
          </div>
          <p>正在准备家务积分榜…</p>
        </div>
      </div>
    )
  }

  if (needsSetup) return <SetupScreen />

  // 只在真的有事要说时才占位置
  const trouble =
    status.pendingOps > 0
      ? { tone: 'busy' as const, text: `${status.pendingOps} 条待同步` }
      : status.state === 'offline'
        ? { tone: 'error' as const, text: '离线' }
        : status.state === 'error'
          ? { tone: 'error' as const, text: '同步出错' }
          : status.readOnly
            ? { tone: 'idle' as const, text: '只读' }
            : null

  const title = doc.meta.settings.appTitle || '家务积分榜'

  return (
    <div className="app">
      <header className="app__header">
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h1 className="app__title">
              <span className="app__title-emoji" aria-hidden="true">
                🏆
              </span>
              {title}
            </h1>
            <div className="app__subtitle">
              {doc.meta.members.map((m) => m.name).join(' 和 ')} 的家务小账本
            </div>
          </div>
          {trouble && <SyncBadge tone={trouble.tone} text={trouble.text} />}
        </div>
      </header>

      <main className="app__main">
        {bootError && (
          <Banner tone={status.state === 'offline' ? 'warn' : 'error'}>{bootError}</Banner>
        )}

        {status.readOnly && !bootError && (
          <Banner tone="info">
            当前是只读模式，可以查看榜单。想记分的话，去「设置」里填入访问令牌。
          </Banner>
        )}

        {tab === 'board' && <LeaderboardScreen />}
        {tab === 'history' && <HistoryScreen />}
        {tab === 'chores' && <ChoresScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>

      <nav className="tabbar" aria-label="主导航">
        {TABS.slice(0, 2).map((t) => (
          <TabButton key={t.id} tab={t} current={tab} onSelect={setTab} />
        ))}

        <button
          type="button"
          className="tabbar__fab"
          aria-label="记一笔家务"
          onClick={() => setAddOpen(true)}
        >
          ＋
        </button>

        {TABS.slice(2).map((t) => (
          <TabButton key={t.id} tab={t} current={tab} onSelect={setTab} />
        ))}
      </nav>

      <AddRecordSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <ToastHost toasts={toasts} />
    </div>
  )
}

function TabButton({
  tab,
  current,
  onSelect,
}: {
  tab: { id: Tab; label: string; icon: string }
  current: Tab
  onSelect: (t: Tab) => void
}) {
  const active = current === tab.id
  return (
    <button
      type="button"
      className="tabbar__item"
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(tab.id)}
    >
      <span className="tabbar__icon" aria-hidden="true">
        {tab.icon}
      </span>
      {tab.label}
    </button>
  )
}
