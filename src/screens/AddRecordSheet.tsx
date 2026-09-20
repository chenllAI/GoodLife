/**
 * 记一笔
 *
 * 表单顺序刻意做成「先选人、再选家务」。成员**不预选** —— 两台设备共用一个链接，
 * 默认选中某人会让另一个人拿起手机就记错账，而需求里的「删除改错」本就是在补救
 * 这类问题。多一次点击换掉一整类错误，划算。
 *
 * 家务改动快照：分值取自选中那一刻的家务定义，之后改分值不会改写这条历史。
 */

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Chore, ChoreCategory } from '@/types'
import { CHORE_CATEGORIES } from '@/types'
import { selectableChores } from '@/domain/merge'
import { addDays, formatDayLabel, formatWeekday, todayKey } from '@/domain/time'
import { useApp } from '@/state/store'
import { Sheet } from '@/components/ui'
import { memberColorVar } from '@/components/memberColor'

const ALL = '全部' as const

export function AddRecordSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const doc = useApp((s) => s.doc)
  const addRecord = useApp((s) => s.addRecord)

  const [memberId, setMemberId] = useState<string | null>(null)
  const [choreId, setChoreId] = useState<string | null>(null)
  const [category, setCategory] = useState<ChoreCategory | typeof ALL>(ALL)
  const [backdate, setBackdate] = useState<string>('')
  const [showMore, setShowMore] = useState(false)
  const [celebrate, setCelebrate] = useState<{ points: number; emoji: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const today = todayKey()
  const chores = useMemo(() => selectableChores(doc.meta.chores), [doc.meta.chores])
  const shown = useMemo(
    () => (category === ALL ? chores : chores.filter((c) => c.category === category)),
    [chores, category],
  )

  const selectedChore = chores.find((c) => c.id === choreId) ?? null
  const canSubmit = memberId !== null && selectedChore !== null && !busy

  const reset = () => {
    setChoreId(null)
    setCategory(ALL)
    setBackdate('')
    setShowMore(false)
    // 成员保留上次选择：连续给同一个人记多笔时省一次点击
  }

  const handleSubmit = async () => {
    if (!memberId || !selectedChore) return
    setBusy(true)

    const record = await addRecord({
      memberId,
      chore: selectedChore,
      ...(backdate ? { day: backdate } : {}),
    })

    setBusy(false)

    if (record) {
      setCelebrate({ points: record.points, emoji: record.choreEmoji })
      reset()
      // 让加分动画播完再关，用户能看到「刚才那笔生效了」
      window.setTimeout(() => {
        setCelebrate(null)
        onClose()
      }, 760)
    }
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title="记一笔" subtitle="谁做了什么家务？">
        <div className="sheet__body">
          {/* 第一步：选人 */}
          <div className="field">
            <span className="field__label">
              1. 这是谁做的？
              {memberId === null && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
                  {' '}
                  （请先选择）
                </span>
              )}
            </span>
            <div className="member-picker">
              {doc.meta.members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`member-option member-option--m${m.seriesSlot}`}
                  aria-pressed={memberId === m.id}
                  onClick={() => setMemberId(m.id)}
                >
                  <span className="member-option__avatar" aria-hidden="true">
                    {m.avatarEmoji}
                  </span>
                  {m.name}
                </button>
              ))}
            </div>
          </div>

          {/* 第二步：选家务 */}
          <div className="field">
            <span className="field__label">2. 做了什么家务？</span>

            <div className="filter-row" style={{ marginTop: 4 }}>
              <button
                type="button"
                className="chip"
                aria-pressed={category === ALL}
                onClick={() => setCategory(ALL)}
              >
                全部 {chores.length}
              </button>
              {CHORE_CATEGORIES.map((c) => {
                const n = chores.filter((x) => x.category === c).length
                if (n === 0) return null
                return (
                  <button
                    key={c}
                    type="button"
                    className="chip"
                    aria-pressed={category === c}
                    onClick={() => setCategory(c)}
                  >
                    {c} {n}
                  </button>
                )
              })}
            </div>

            {shown.length === 0 ? (
              <p className="field__hint">
                这个分类下还没有家务。去「家务」页添加一个吧。
              </p>
            ) : (
              <div className="chore-picker">
                {shown.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="chore-tile"
                    aria-pressed={choreId === c.id}
                    onClick={() => setChoreId(c.id)}
                  >
                    <span className="chore-tile__emoji" aria-hidden="true">
                      {c.emoji}
                    </span>
                    <span className="chore-tile__name">{c.name}</span>
                    <span className="chore-tile__points tnum">{c.points} 分</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 更多选项：补录 */}
          {showMore ? (
            <div className="field">
              <span className="field__label">补录到哪一天？</span>
              <div className="filter-row">
                <button
                  type="button"
                  className="chip"
                  aria-pressed={backdate === ''}
                  onClick={() => setBackdate('')}
                >
                  今天
                </button>
                {[1, 2, 3].map((n) => {
                  const d = addDays(today, -n)
                  return (
                    <button
                      key={d}
                      type="button"
                      className="chip"
                      aria-pressed={backdate === d}
                      onClick={() => setBackdate(d)}
                    >
                      {formatDayLabel(d)} {formatWeekday(d)}
                    </button>
                  )
                })}
              </div>
              <input
                className="input"
                type="date"
                max={today}
                value={backdate || today}
                onChange={(e) => setBackdate(e.target.value)}
                aria-label="选择补录日期"
              />
              <span className="field__hint">
                忘记了当时没记？可以补录到过去的某一天，榜单会按那天的日期统计。
              </span>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setShowMore(true)}
            >
              🕐 补录到别的日子
            </button>
          )}
        </div>

        <div className="sheet__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {selectedChore
              ? `加 ${selectedChore.points} 分`
              : busy
                ? '保存中…'
                : '确认'}
          </button>
        </div>

        {selectedChore && memberId && (
          <p
            className="field__hint"
            style={{ textAlign: 'center', marginTop: 12 }}
          >
            将给小良小影家的{' '}
            <strong style={{ color: memberColorVar(
              doc.meta.members.find((m) => m.id === memberId)?.seriesSlot ?? 1,
            ) }}>
              {doc.meta.members.find((m) => m.id === memberId)?.name}
            </strong>{' '}
            记上 <strong>{selectedChore.emoji} {selectedChore.name}</strong>，
            加 <strong className="tnum">{selectedChore.points}</strong> 分
          </p>
        )}
      </Sheet>

      {celebrate && <Celebration points={celebrate.points} emoji={celebrate.emoji} />}
    </>
  )
}

/**
 * 加分庆祝动画
 *
 * 这不是纯装饰 —— 它给「刚才那一笔到底记上没有」一个即时、明确的反馈。
 * 家庭场景里孩子最在意的就是这个瞬间。
 */
function Celebration({ points, emoji }: { points: number; emoji: string }) {
  const sparks = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => {
        const angle = (i / 8) * Math.PI * 2
        return {
          dx: Math.cos(angle) * (50 + Math.random() * 40),
          dy: Math.sin(angle) * (50 + Math.random() * 40) - 40,
          rot: `${(Math.random() - 0.5) * 240}deg`,
          char: ['✨', '⭐', '💫', '🎉'][i % 4] as string,
          delay: `${Math.random() * 90}ms`,
        }
      }),
    [],
  )

  return createPortal(
    <>
      <div className="floating-points" style={{ left: '50%', top: '46%' }}>
        {emoji} +{points}
      </div>
      <div style={{ position: 'fixed', left: '50%', top: '46%', zIndex: 66 }}>
        {sparks.map((s, i) => (
          <span
            key={i}
            className="spark"
            style={
              {
                '--dx': `${s.dx}px`,
                '--dy': `${s.dy}px`,
                '--rot': s.rot,
                animationDelay: s.delay,
                left: 0,
                top: 0,
              } as React.CSSProperties
            }
            aria-hidden="true"
          >
            {s.char}
          </span>
        ))}
      </div>
    </>,
    document.body,
  )
}

export type { Chore }
