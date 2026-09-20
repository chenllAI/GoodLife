/**
 * 榜单相关组件：家庭总分、成员卡片、积分明细列表
 */

import { useMemo, useState } from 'react'
import type { ChoreCategory, Member, PointsRecord } from '@/types'
import type { MemberDelta, MemberStanding, RankedStanding } from '@/domain/aggregate'
import { levelOf } from '@/domain/levels'
import { formatRelativeDay } from '@/domain/time'
import { memberColorVar, memberDotClass } from '@/components/memberColor'
import { ConfirmDialog, EmptyState } from '@/components/ui'

// ---------------------------------------------------------------------------
// 家庭总分
// ---------------------------------------------------------------------------

/**
 * 每个视图**只有一个**主数字。手机上到处都是大数字等于没有重点。
 */
export function HeroTotal({
  points,
  count,
  label,
}: {
  points: number
  count: number
  label: string
}) {
  return (
    <div className="hero">
      <div className="hero__label">{label} · 全家合计</div>
      <div className="hero__value tnum">
        {points}
        <span className="hero__unit">分</span>
      </div>
      <div className="hero__meta">
        共完成 <span className="tnum">{count}</span> 件家务
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 成员卡片
// ---------------------------------------------------------------------------

export function MemberCard({
  member,
  standing,
  rank,
  tied,
  lifetimePoints,
  delta,
  streak,
  isLead,
}: {
  member: Member
  standing: MemberStanding
  rank: number
  tied: boolean
  lifetimePoints: number
  delta: MemberDelta | undefined
  streak: number
  isLead: boolean
}) {
  const level = levelOf(lifetimePoints)

  return (
    <div
      className={`member-card member-card--m${member.seriesSlot}${
        isLead ? ' member-card--lead' : ''
      }`}
    >
      {isLead && (
        <span className="member-card__crown" aria-label="当前领先">
          👑
        </span>
      )}

      <div className="member-card__avatar" aria-hidden="true">
        {member.avatarEmoji}
      </div>

      <div className="member-card__name">
        {member.name}
        {tied && rank === 1 && (
          <span
            style={{
              fontSize: 10,
              marginLeft: 4,
              color: 'var(--text-muted)',
              fontWeight: 700,
            }}
          >
            并列
          </span>
        )}
      </div>

      <div className="member-card__points tnum">
        {standing.points}
        <span className="member-card__unit">分</span>
      </div>

      <div className="member-card__count tnum">{standing.count} 件家务</div>

      {/* 等级按累计总分评定，只升不降 —— 不因某一周表现差而「降级」 */}
      <div className="member-card__level">
        <span aria-hidden="true">{level.level.emoji}</span>
        {level.level.title}
      </div>

      <div className="level-meter">
        <div className="level-meter__track">
          <div
            className="level-meter__fill"
            style={{ width: `${Math.round(level.progress * 100)}%` }}
          />
        </div>
        <div className="level-meter__caption">
          <span className="tnum">累计 {lifetimePoints} 分</span>
          <span className="tnum">
            {level.next ? `距${level.next.title}还差 ${level.toNext}` : '已满级'}
          </span>
        </div>
      </div>

      {streak > 0 && (
        <div className="streak-chip">🔥 连续 {streak} 天</div>
      )}

      {delta && <DeltaChip delta={delta} />}
    </div>
  )
}

/**
 * 环比徽章。
 *
 * 用**箭头图标 + 文字**表达方向，绝不仅靠颜色 —— 色弱用户分不出红绿。
 * 两行分别是名次变化和分数变化，各自独占一行：卡片窄，横排一定会断得很难看。
 */
export function DeltaChip({ delta }: { delta: MemberDelta }) {
  const rankText =
    delta.rankDelta > 0
      ? `名次 ↑${delta.rankDelta}`
      : delta.rankDelta < 0
        ? `名次 ↓${Math.abs(delta.rankDelta)}`
        : '名次持平'

  const ptsText =
    delta.pointsPct === null
      ? null
      : delta.pointsPct > 0
        ? `较上期 ↑${delta.pointsPct}%`
        : delta.pointsPct < 0
          ? `较上期 ↓${Math.abs(delta.pointsPct)}%`
          : '较上期持平'

  const tone = delta.rankDelta > 0 ? 'up' : delta.rankDelta < 0 ? 'down' : 'flat'

  return (
    <div className={`delta-chip delta-chip--${tone}`}>
      <span>{rankText}</span>
      {ptsText && <span style={{ opacity: 0.8 }}>{ptsText}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 积分明细
// ---------------------------------------------------------------------------

interface DayGroup {
  day: string
  records: PointsRecord[]
  total: number
}

export function RecordList({
  records,
  members,
  today,
  onDelete,
  pendingIds,
}: {
  records: readonly PointsRecord[]
  members: readonly Member[]
  today: string
  onDelete: (id: string) => void
  /** 尚未同步成功的记录 id，用于显示待同步标记 */
  pendingIds?: ReadonlySet<string>
}) {
  const [pendingDelete, setPendingDelete] = useState<PointsRecord | null>(null)

  const groups = useMemo<DayGroup[]>(() => {
    const map = new Map<string, PointsRecord[]>()
    for (const r of records) {
      if (r.deleted) continue
      const list = map.get(r.day) ?? []
      list.push(r)
      map.set(r.day, list)
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // 最近的在最上面
      .map(([day, list]) => ({
        day,
        // 同一天内按时间倒序，刚记的排最前
        records: [...list].sort((a, b) => (a.at < b.at ? 1 : -1)),
        total: list.reduce((s, r) => s + r.points, 0),
      }))
  }, [records])

  const memberById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  )

  if (groups.length === 0) {
    return (
      <EmptyState
        emoji="🍃"
        title="还没有积分记录"
        desc="点下面的「记一笔」，选人和家务就能加分啦"
      />
    )
  }

  return (
    <>
      <div className="record-list">
        {groups.map((g) => (
          <div key={g.day}>
            <div className="record-day">
              {formatRelativeDay(g.day, today)}
              <span style={{ float: 'right' }} className="tnum">
                合计 {g.total} 分
              </span>
            </div>
            {g.records.map((r) => {
              const member = memberById.get(r.memberId)
              return (
                <div
                  className={`record-item${
                    pendingIds?.has(r.id) ? ' record-item--pending' : ''
                  }`}
                  key={r.id}
                >
                  <div className="record-item__emoji" aria-hidden="true">
                    {r.choreEmoji}
                  </div>
                  <div className="record-item__body">
                    <div className="record-item__name">{r.choreName}</div>
                    <div className="record-item__meta">
                      <span
                        className={memberDotClass(member?.seriesSlot ?? 1)}
                        aria-hidden="true"
                      />
                      <span>{member?.name ?? '未知成员'}</span>
                      <span>·</span>
                      <span>{r.category}</span>
                      {pendingIds?.has(r.id) && <span>· 待同步</span>}
                    </div>
                  </div>
                  <div className="record-item__points tnum">{r.points}</div>
                  <button
                    type="button"
                    className="record-item__delete"
                    aria-label={`删除 ${r.choreName}`}
                    onClick={() => setPendingDelete(r)}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这条记录？"
        danger
        confirmText="删除"
        message={
          <>
            将删除 <strong>{pendingDelete?.choreName}</strong>（
            {pendingDelete?.points} 分）。
            <br />
            删除后该记录的积分会从榜单中扣除。
          </>
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id)
          setPendingDelete(null)
        }}
      />
    </>
  )
}

export { memberColorVar }

export type { RankedStanding, ChoreCategory }
