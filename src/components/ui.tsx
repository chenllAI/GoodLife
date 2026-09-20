/**
 * 通用 UI 组件
 *
 * 都是无状态的小件，样式全部来自 app.css 的类名，不在组件里写行内样式 ——
 * 这样配色令牌只需在一处维护。
 */

import { useEffect, useRef, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// 弹层
// ---------------------------------------------------------------------------

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  children: ReactNode
  /** 居中卡片样式（确认框），而不是从底部升起的抽屉 */
  center?: boolean
  /** 是否显示顶部的小横条 */
  handle?: boolean
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  center = false,
  handle = true,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)

    // 锁定背景滚动，避免抽屉滚动时页面跟着动
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // 把焦点移进弹层，键盘与读屏用户不会迷失在背景内容里
    const focusTarget = panelRef.current?.querySelector<HTMLElement>(
      'input, button, [tabindex]:not([tabindex="-1"])',
    )
    focusTarget?.focus()

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className={`sheet-backdrop${center ? ' sheet-backdrop--center' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={`sheet${center ? ' sheet--center' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {handle && !center && <div className="sheet__handle" />}
        {title && <h2 className="sheet__title">{title}</h2>}
        {subtitle && <p className="sheet__subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 确认框
// ---------------------------------------------------------------------------

export interface ConfirmDialogProps {
  open: boolean
  title: string
  /** 支持 JSX 以便强调关键信息（如家务名） */
  message: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Sheet open={open} onClose={onCancel} title={title} center>
      <p className="confirm-text">{message}</p>
      <div className="sheet__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          {cancelText}
        </button>
        <button
          type="button"
          className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
          onClick={onConfirm}
        >
          {confirmText}
        </button>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// 空状态
// ---------------------------------------------------------------------------

export function EmptyState({
  emoji,
  title,
  desc,
  action,
}: {
  emoji: string
  title: string
  desc?: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty__emoji" aria-hidden="true">
        {emoji}
      </div>
      <div className="empty__title">{title}</div>
      {desc && <p className="empty__desc">{desc}</p>}
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 提示条
// ---------------------------------------------------------------------------

export function Banner({
  tone = 'info',
  icon,
  children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'ok'
  icon?: string
  children: ReactNode
}) {
  const defaultIcon = { info: 'ℹ️', warn: '⚠️', error: '⛔', ok: '✅' }[tone]
  return (
    <div className={`banner banner--${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <span className="banner__icon" aria-hidden="true">
        {icon ?? defaultIcon}
      </span>
      <div>{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 分段控件
// ---------------------------------------------------------------------------

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="segmented__btn"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toast 容器
// ---------------------------------------------------------------------------

export function ToastHost({
  toasts,
}: {
  toasts: readonly { id: string; text: string; tone: 'info' | 'ok' | 'error' }[]
}) {
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.tone === 'info' ? '' : ` toast--${t.tone}`}`}>
          <span aria-hidden="true">
            {t.tone === 'ok' ? '✅' : t.tone === 'error' ? '⚠️' : '💬'}
          </span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 卡片内的「表」视图开关
// ---------------------------------------------------------------------------

/**
 * 每张图都提供表格视图 —— 手机上想读**准确数字**时，表格才是真正好用的形式，
 * 图形只负责传达趋势和对比关系。
 */
export function TableToggle({
  showTable,
  onToggle,
}: {
  showTable: boolean
  onToggle: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      className="table-toggle"
      aria-pressed={showTable}
      onClick={() => onToggle(!showTable)}
    >
      {showTable ? '看图表' : '看数字'}
    </button>
  )
}

// ---------------------------------------------------------------------------
// 状态徽章
// ---------------------------------------------------------------------------

export function SyncBadge({
  tone,
  text,
}: {
  tone: 'ok' | 'busy' | 'error' | 'idle'
  text: string
}) {
  const cls = tone === 'idle' ? '' : ` sync-badge--${tone}`
  return (
    <span className={`sync-badge${cls}`}>
      <span className="sync-dot" aria-hidden="true" />
      {text}
    </span>
  )
}
