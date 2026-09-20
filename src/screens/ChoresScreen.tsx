/**
 * 家务管理
 *
 * 新增家务时的图标自动匹配：输入名字即时匹配，匹配得不确定就提示用户确认。
 * 用户手选的图标会被记下来（写进 settings.customEmojiMap 并随数据同步），
 * 下次在另一台手机上输入同样的名字就直接命中。
 */

import { useEffect, useMemo, useState } from 'react'
import type { Chore, ChoreCategory, Difficulty } from '@/types'
import { CHORE_CATEGORIES, DIFFICULTY_LABELS, DIFFICULTY_SUGGESTED_POINTS } from '@/types'
import { matchEmoji, suggestEmojis } from '@/domain/emojiMatcher'
import { selectableChores } from '@/domain/merge'
import { useApp } from '@/state/store'
import { ConfirmDialog, Sheet } from '@/components/ui'

const ALL = '全部' as const

export function ChoresScreen() {
  const doc = useApp((s) => s.doc)
  const toggleChore = useApp((s) => s.toggleChore)
  const deleteChore = useApp((s) => s.deleteChore)

  const [filter, setFilter] = useState<ChoreCategory | typeof ALL>(ALL)
  const [editing, setEditing] = useState<Chore | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Chore | null>(null)
  const [showHidden, setShowHidden] = useState(false)

  const all = doc.meta.chores
  const visible = useMemo(() => {
    const base = showHidden ? all.filter((c) => !c.deleted) : selectableChores(all)
    return filter === ALL ? base : base.filter((c) => c.category === filter)
  }, [all, filter, showHidden])

  const grouped = useMemo(() => {
    const map = new Map<ChoreCategory, Chore[]>()
    for (const c of visible) {
      const list = map.get(c.category) ?? []
      list.push(c)
      map.set(c.category, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => (b.points !== a.points ? b.points - a.points : a.name.localeCompare(b.name)))
    }
    return map
  }, [visible])

  const hiddenCount = all.filter((c) => !c.deleted && !c.enabled).length

  return (
    <>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => setCreating(true)}
        >
          ➕ 新增家务
        </button>
      </div>

      <div className="filter-row">
        <button
          type="button"
          className="chip"
          aria-pressed={filter === ALL}
          onClick={() => setFilter(ALL)}
        >
          全部
        </button>
        {CHORE_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className="chip"
            aria-pressed={filter === c}
            onClick={() => setFilter(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {hiddenCount > 0 && (
        <button
          type="button"
          className="chip"
          aria-pressed={showHidden}
          onClick={() => setShowHidden((v) => !v)}
          style={{ alignSelf: 'flex-start' }}
        >
          {showHidden ? '✓ ' : ''}显示已隐藏的（{hiddenCount}）
        </button>
      )}

      {visible.length === 0 ? (
        <section className="card">
          <p className="card__hint" style={{ textAlign: 'center', padding: 16 }}>
            这个分类下还没有家务
          </p>
        </section>
      ) : (
        [...grouped.entries()].map(([category, list]) => (
          <div key={category}>
            <h2 className="section-title">{category}</h2>
            <section className="card card--flush">
              <div className="chore-list">
                {list.map((c) => (
                  <div
                    className={`chore-item${c.enabled ? '' : ' chore-item--off'}`}
                    key={c.id}
                  >
                    <div className="chore-item__emoji" aria-hidden="true">
                      {c.emoji}
                    </div>
                    <div>
                      <div className="chore-item__name">{c.name}</div>
                      <div className="chore-item__meta">
                        <span className="stars" aria-label={`难度：${DIFFICULTY_LABELS[c.difficulty]}`}>
                          <span className="stars__on" aria-hidden="true">
                            {'●'.repeat(c.difficulty)}
                          </span>
                          <span className="stars__off" aria-hidden="true">
                            {'○'.repeat(5 - c.difficulty)}
                          </span>
                        </span>{' '}
                        {DIFFICULTY_LABELS[c.difficulty]}
                        {!c.enabled && ' · 已隐藏'}
                      </div>
                    </div>
                    <span className="chore-item__points tnum">
                      {c.points}
                      <small>分</small>
                    </span>
                    <div className="chore-item__actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`编辑 ${c.name}`}
                        onClick={() => setEditing(c)}
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={c.enabled ? `隐藏 ${c.name}` : `恢复 ${c.name}`}
                        onClick={() => toggleChore(c.id)}
                      >
                        {c.enabled ? '🙈' : '👁️'}
                      </button>
                      {!c.isPreset && (
                        <button
                          type="button"
                          className="icon-btn icon-btn--danger"
                          aria-label={`删除 ${c.name}`}
                          onClick={() => setPendingDelete(c)}
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ))
      )}

      <p className="field__hint" style={{ padding: '0 4px' }}>
        预置家务可以改名、改分、隐藏，但不能删除（避免误删后找不回来）。
        自定义的家务可以删除；无论哪种情况，已经记下的历史积分都不会受影响。
      </p>

      <ChoreEditor
        open={creating || editing !== null}
        chore={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这个家务？"
        danger
        confirmText="删除"
        message={
          <>
            将删除自定义家务 <strong>{pendingDelete?.name}</strong>。
            <br />
            已经用它记过的积分<strong>不会</strong>受影响，历史记录里仍会保留。
          </>
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteChore(pendingDelete.id)
          setPendingDelete(null)
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// 家务编辑器
// ---------------------------------------------------------------------------

function ChoreEditor({
  open,
  chore,
  onClose,
}: {
  open: boolean
  chore: Chore | null
  onClose: () => void
}) {
  const doc = useApp((s) => s.doc)
  const saveChore = useApp((s) => s.saveChore)

  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🧹')
  const [emojiTouched, setEmojiTouched] = useState(false)
  const [difficulty, setDifficulty] = useState<Difficulty>(3)
  const [points, setPoints] = useState(5)
  const [pointsTouched, setPointsTouched] = useState(false)
  const [category, setCategory] = useState<ChoreCategory>('清洁打扫')
  const [busy, setBusy] = useState(false)

  // 打开时装载初值
  useEffect(() => {
    if (!open) return
    if (chore) {
      setName(chore.name)
      setEmoji(chore.emoji)
      setDifficulty(chore.difficulty)
      setPoints(chore.points)
      setCategory(chore.category)
      setEmojiTouched(true)
      setPointsTouched(true)
    } else {
      setName('')
      setEmoji('🧹')
      setDifficulty(3)
      setPoints(DIFFICULTY_SUGGESTED_POINTS[3])
      setCategory('清洁打扫')
      setEmojiTouched(false)
      setPointsTouched(false)
    }
  }, [open, chore])

  // 名字变化 → 自动匹配图标（用户手动改过就不再覆盖）
  const match = useMemo(
    () => matchEmoji(name, { category, customMap: doc.meta.settings.customEmojiMap }),
    [name, category, doc.meta.settings.customEmojiMap],
  )

  useEffect(() => {
    if (!open) return
    if (chore) return // 编辑已有家务时不覆盖它的图标
    if (emojiTouched) return
    setEmoji(match.emoji)
  }, [match.emoji, emojiTouched, open, chore])

  // 难度变化 → 建议分值（用户手动改过就不再覆盖）
  useEffect(() => {
    if (pointsTouched) return
    setPoints(DIFFICULTY_SUGGESTED_POINTS[difficulty])
  }, [difficulty, pointsTouched])

  const suggestions = useMemo(
    () =>
      suggestEmojis(name, {
        category,
        customMap: doc.meta.settings.customEmojiMap,
      }),
    [name, category, doc.meta.settings.customEmojiMap],
  )

  const trimmed = name.trim()
  const canSave = trimmed.length > 0 && !busy
  const isLowConfidence = !chore && match.confidence === 'low' && trimmed.length > 0
  const isFallback = !chore && match.confidence === 'fallback' && trimmed.length > 0

  const handleSave = async () => {
    if (!canSave) return
    setBusy(true)
    await saveChore({
      ...(chore ? { id: chore.id } : {}),
      name: trimmed,
      emoji,
      points,
      difficulty,
      category,
    })
    setBusy(false)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={chore ? '编辑家务' : '新增家务'}
      subtitle={chore ? undefined : '输入名字后会自动配一个图标'}
    >
      <div className="sheet__body">
        <div className="field">
          <label className="field__label" htmlFor="chore-name">
            家务名称
          </label>
          <input
            id="chore-name"
            className="input"
            value={name}
            placeholder="例如：擦阳台栏杆"
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field">
          <span className="field__label">
            图标
            {isFallback && (
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
                {' '}
                （没认出来，自己挑一个吧）
              </span>
            )}
          </span>

          {isLowConfidence && (
            <div className="emoji-suggest-hint">
              <span aria-hidden="true">🤔</span>
              <span>
                不太确定该用哪个图标，先按分类猜了一个 —— 不对的话点下面的图标换掉。
              </span>
            </div>
          )}

          <div className="emoji-picker" style={{ marginTop: 4 }}>
            {suggestions.map((e) => (
              <button
                key={e}
                type="button"
                className="emoji-option"
                aria-pressed={emoji === e}
                aria-label={`选择图标 ${e}`}
                onClick={() => {
                  setEmoji(e)
                  setEmojiTouched(true)
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">分类</span>
          <div className="filter-row">
            {CHORE_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className="chip"
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">难度（决定建议分值）</span>
          <div className="filter-row">
            {([1, 2, 3, 4, 5] as Difficulty[]).map((d) => (
              <button
                key={d}
                type="button"
                className="chip"
                aria-pressed={difficulty === d}
                onClick={() => {
                  setDifficulty(d)
                  setPointsTouched(false)
                }}
              >
                {d} · {DIFFICULTY_LABELS[d]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">积分</span>
          <div className="stepper">
            <button
              type="button"
              className="stepper__btn"
              aria-label="减少 1 分"
              onClick={() => {
                setPoints((p) => Math.max(1, p - 1))
                setPointsTouched(true)
              }}
            >
              −
            </button>
            <span className="stepper__value tnum">{points}</span>
            <button
              type="button"
              className="stepper__btn"
              aria-label="增加 1 分"
              onClick={() => {
                setPoints((p) => Math.min(99, p + 1))
                setPointsTouched(true)
              }}
            >
              +
            </button>
          </div>
          <span className="field__hint">
            按难度建议 {DIFFICULTY_SUGGESTED_POINTS[difficulty]} 分，可以自己调整。
            改分值<strong>不会</strong>影响已经记下的历史积分。
          </span>
        </div>
      </div>

      <div className="sheet__actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canSave}
          onClick={handleSave}
        >
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </Sheet>
  )
}
