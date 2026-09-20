/**
 * 图表组件
 *
 * 遵循的几条规矩（来自 dataviz 规范，都是有原因的）：
 *
 *   - **文字绝不染成系列色。** 数值、标签、图例一律用文字色，身份由旁边的色块承担。
 *     文字用彩色在浅底上会掉对比度，而且色弱用户读不出来。
 *   - **单一 y 轴。** 绝不把积分和件数画在同一张图上 —— 两个量纲不同的度量要分成两张图。
 *   - **≥2 条系列必有图例**，且端点直接标注，身份不靠颜色单独承担。
 *   - **每张图都有「表」视图。** 手机上想读准确数字时表格才好用；图形负责传达趋势。
 *   - 数据端 4px 圆角、起点贴基线；条形之间留 2px 底色间隙。
 */

import { useMemo, useState } from 'react'
import type { ChoreCategory } from '@/types'
import type { CategoryComparison, DailyPoint } from '@/domain/aggregate'
import { formatDayShort, formatWeekday } from '@/domain/time'
import { memberColorVar } from '@/components/memberColor'

export interface SeriesInfo {
  id: string
  name: string
  seriesSlot: 1 | 2
}

// ---------------------------------------------------------------------------
// 双人赛跑条
// ---------------------------------------------------------------------------

/**
 * 两人对决的主视觉。
 *
 * 用条形而不是饼图：饼图比较两个接近的值时几乎读不出差别，而条形共享同一条基线，
 * 长度差异一眼可见 —— 这正是「谁领先」要回答的问题。
 */
export function RaceBar({
  members,
  points,
}: {
  members: readonly SeriesInfo[]
  points: Record<string, number>
}) {
  const max = Math.max(1, ...members.map((m) => points[m.id] ?? 0))

  return (
    <div className="race">
      {members.map((m) => {
        const value = points[m.id] ?? 0
        const pct = (value / max) * 100
        return (
          <div className="race__row" key={m.id}>
            <span className="race__name">
              <span
                className="legend-swatch"
                style={{ background: memberColorVar(m.seriesSlot) }}
                aria-hidden="true"
              />
              {m.name}
            </span>
            <div className="race__row-inner">
              <div className="race__track">
                <div
                  className={`race__fill race__fill--m${m.seriesSlot}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="race__value tnum">{value}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 趋势折线
// ---------------------------------------------------------------------------

/** 把最大值取整到一个好看的刻度上 */
function niceMax(v: number): number {
  if (v <= 0) return 10
  const mag = 10 ** Math.floor(Math.log10(v))
  const norm = v / mag
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return step * mag
}

export function TrendLine({
  series,
  data,
  height = 150,
}: {
  series: readonly SeriesInfo[]
  data: readonly DailyPoint[]
  height?: number
}) {
  const [active, setActive] = useState<number | null>(null)

  const W = 320
  const H = height
  const padL = 26
  const padR = 34 // 给端点直接标注留位置
  const padT = 12
  const padB = 22

  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const max = useMemo(() => {
    let m = 0
    for (const d of data) {
      for (const s of series) m = Math.max(m, d.byMember[s.id] ?? 0)
    }
    return niceMax(m)
  }, [data, series])

  const n = data.length
  const xOf = (i: number) => (n <= 1 ? padL : padL + (i / (n - 1)) * plotW)
  const yOf = (v: number) => padT + plotH - (v / max) * plotH

  const hasAny = data.some((d) => d.total > 0)
  const gridValues = [0, max / 2, max]

  const activePoint = active !== null ? data[active] : undefined

  return (
    <div className="chart">
      <svg
        className="chart__svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`近 ${n} 天积分趋势`}
      >
        {/* 网格线：实线、克制的颜色 */}
        {gridValues.map((v) => (
          <line
            key={v}
            x1={padL}
            x2={padL + plotW}
            y1={yOf(v)}
            y2={yOf(v)}
            stroke="var(--line-grid)"
            strokeWidth={1}
          />
        ))}
        {gridValues.map((v) => (
          <text
            key={`t${v}`}
            x={padL - 6}
            y={yOf(v) + 3.5}
            textAnchor="end"
            fontSize={9}
            fill="var(--text-muted)"
          >
            {Math.round(v)}
          </text>
        ))}

        {/* 折线 */}
        {series.map((s) => {
          const pts = data.map((d, i) => `${xOf(i)},${yOf(d.byMember[s.id] ?? 0)}`).join(' ')
          return (
            <polyline
              key={s.id}
              points={pts}
              fill="none"
              stroke={memberColorVar(s.seriesSlot)}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )
        })}

        {/* 端点标记：≥8px，带 2px 底色描边把重叠的点分开 */}
        {series.map((s) => {
          const last = data[n - 1]
          if (!last) return null
          const v = last.byMember[s.id] ?? 0
          return (
            <circle
              key={`e${s.id}`}
              cx={xOf(n - 1)}
              cy={yOf(v)}
              r={4}
              fill={memberColorVar(s.seriesSlot)}
              stroke="var(--surface-card)"
              strokeWidth={2}
            />
          )
        })}

        {/* 悬停/点击指示线 */}
        {active !== null && (
          <line
            x1={xOf(active)}
            x2={xOf(active)}
            y1={padT}
            y2={padT + plotH}
            stroke="var(--line-base)"
            strokeWidth={1}
          />
        )}
        {active !== null &&
          series.map((s) => {
            const v = data[active]?.byMember[s.id] ?? 0
            return (
              <circle
                key={`a${s.id}`}
                cx={xOf(active)}
                cy={yOf(v)}
                r={4.5}
                fill={memberColorVar(s.seriesSlot)}
                stroke="var(--surface-card)"
                strokeWidth={2}
              />
            )
          })}

        {/* x 轴：只标首、中、尾，避免拥挤 */}
        {[0, Math.floor((n - 1) / 2), n - 1]
          .filter((i, idx, arr) => arr.indexOf(i) === idx && i >= 0)
          .map((i) => {
            const d = data[i]
            if (!d) return null
            return (
              <text
                key={`x${i}`}
                x={xOf(i)}
                y={H - 6}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                fontSize={9}
                fill="var(--text-muted)"
              >
                {formatDayShort(d.day)}
              </text>
            )
          })}

        {/* 命中区域：整条竖带，宽度远大于标记本身，手指也点得中 */}
        {data.map((d, i) => {
          const w = n <= 1 ? plotW : plotW / (n - 1)
          return (
            <rect
              key={`h${d.day}`}
              x={xOf(i) - w / 2}
              y={0}
              width={Math.max(w, 24)}
              height={H}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onPointerEnter={() => setActive(i)}
              onPointerDown={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
            />
          )
        })}
      </svg>

      {activePoint ? (
        <div className="chart__legend" role="status">
          <span style={{ fontWeight: 800 }}>
            {formatDayShort(activePoint.day)} {formatWeekday(activePoint.day)}
          </span>
          {series.map((s) => (
            <span className="legend-item" key={s.id}>
              <span
                className="legend-swatch"
                style={{ background: memberColorVar(s.seriesSlot) }}
                aria-hidden="true"
              />
              {s.name} {activePoint.byMember[s.id] ?? 0}
            </span>
          ))}
        </div>
      ) : (
        <div className="chart__legend">
          {series.map((s) => (
            <span className="legend-item" key={s.id}>
              <span
                className="legend-swatch"
                style={{ background: memberColorVar(s.seriesSlot) }}
                aria-hidden="true"
              />
              {s.name}
            </span>
          ))}
          {!hasAny && <span style={{ color: 'var(--text-muted)' }}>这段时间还没有记录</span>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 分类对比（分组横向条形图）
// ---------------------------------------------------------------------------

/**
 * 六个分类 × 两人的分组条形。
 *
 * 这里刻意**不用雷达图**：雷达把数值映射到半径，面积会被平方放大，两个其实很接近
 * 的成员看起来可能天差地别；而且雷达的轴顺序是任意的，换个顺序图形就变了。
 * 分组条形能诚实回答「谁在厨房做得多」，并且中文字标签横向排得下，不用旋转。
 */
export function CategoryBars({
  series,
  data,
}: {
  series: readonly SeriesInfo[]
  data: readonly CategoryComparison[]
}) {
  const max = Math.max(1, ...data.map((d) => d.max))

  return (
    <div className="catbars">
      {data.map((d) => (
        <div className="catbar" key={d.category}>
          <span className="catbar__label">{d.category}</span>
          <div className="catbar__group">
            {series.map((s) => {
              const v = d.byMember[s.id] ?? 0
              return (
                <div className="catbar__track" key={s.id}>
                  <div
                    className={`catbar__fill catbar__fill--m${s.seriesSlot}`}
                    style={{ width: `${(v / max) * 100}%` }}
                    title={`${s.name} ${d.category} ${v} 分`}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export function CategoryTable({
  series,
  data,
  categoryOf,
}: {
  series: readonly SeriesInfo[]
  data: readonly CategoryComparison[]
  categoryOf?: (c: ChoreCategory) => string
}) {
  return (
    <table className="datatable">
      <thead>
        <tr>
          <th>分类</th>
          {series.map((s) => (
            <th key={s.id}>{s.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.category}>
            <td>{categoryOf ? categoryOf(d.category) : d.category}</td>
            {series.map((s) => (
              <td key={s.id} className="tnum">
                {d.byMember[s.id] ?? 0}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
