import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { ArrowLeft, CalendarDays, Focus, GitBranch, Maximize2, Minus, Move, Plus, RotateCcw, Target } from 'lucide-react'
import type { Goal } from '../shared/types'
import { formatDate, isOverdue } from '../utils'
import { goalHealth, goalHealthLabel, goalProgressValue } from '../goals/tracking'
import { goalSpaceNodeSize, layoutGoalSpace } from '../goals/spaceLayout'
import { Button } from './ui/button'
import { Progress } from './ui/progress'

interface ViewTransform { x: number; y: number; scale: number }

const clampScale = (scale: number) => Math.min(1.35, Math.max(.42, scale))

export function GoalSpace({ goals, onClose, onOpenGoal }: { goals: Goal[]; onClose: () => void; onOpenGoal: (id: string) => void }) {
  const visibleGoals = useMemo(() => goals.filter((goal) => goal.status !== 'archived'), [goals])
  const layout = useMemo(() => layoutGoalSpace(visibleGoals), [visibleGoals])
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [transform, setTransform] = useState<ViewTransform>({ x: 40, y: 40, scale: .8 })

  const fit = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const padding = 110
    const scale = clampScale(Math.min((viewport.clientWidth - padding) / layout.width, (viewport.clientHeight - padding) / layout.height, 1))
    setTransform({ x: (viewport.clientWidth - layout.width * scale) / 2, y: Math.max(72, (viewport.clientHeight - layout.height * scale) / 2), scale })
  }, [layout.height, layout.width])

  useEffect(() => {
    const frame = window.requestAnimationFrame(fit)
    return () => window.cancelAnimationFrame(frame)
  }, [fit])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if ((event.key === '0' || event.key === 'Home') && !event.ctrlKey && !event.metaKey) fit()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fit, onClose])

  const zoomAtCenter = (delta: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const cx = viewport.clientWidth / 2
    const cy = viewport.clientHeight / 2
    setTransform((current) => {
      const nextScale = clampScale(current.scale + delta)
      const ratio = nextScale / current.scale
      return { scale: nextScale, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio }
    })
  }

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const cx = event.clientX - rect.left
    const cy = event.clientY - rect.top
    setTransform((current) => {
      const nextScale = clampScale(current.scale * (event.deltaY > 0 ? .9 : 1.1))
      const ratio = nextScale / current.scale
      return { scale: nextScale, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio }
    })
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: transform.x, originY: transform.y }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setTransform((current) => ({ ...current, x: drag.originX + event.clientX - drag.x, y: drag.originY + event.clientY - drag.y }))
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
  }

  const nodeById = useMemo(() => new Map(layout.nodes.map((node) => [node.goal.id, node])), [layout.nodes])
  const completedCount = visibleGoals.filter((goal) => goal.status === 'completed').length
  const milestoneCount = visibleGoals.reduce((sum, goal) => sum + goal.milestones.length, 0)

  return <section className={`goal-space${window.sylunae?.platform === 'electron' ? ' is-desktop' : ''}`} aria-label="目标关系空间">
    <header className="goal-space-header">
      <Button variant="ghost" className="goal-space-back" onClick={onClose}><ArrowLeft size={17} />返回目标追踪</Button>
      <div className="goal-space-title"><span><Target size={17} /></span><div><strong>目标空间</strong><small>{visibleGoals.length} 个目标 · {milestoneCount} 项关键成果 · {completedCount} 个已完成</small></div></div>
      <div className="goal-space-hint"><Move size={14} />拖动画布 · 滚轮缩放</div>
    </header>

    <div ref={viewportRef} className={`goal-space-viewport${dragging ? ' is-dragging' : ''}`} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      {layout.nodes.length ? <div className="goal-space-canvas" style={{ width: layout.width, height: layout.height, transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>
        <svg className="goal-space-edges" width={layout.width} height={layout.height} aria-hidden="true">
          <defs><marker id="goal-space-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" /></marker></defs>
          {layout.edges.map((edge) => {
            const source = nodeById.get(edge.from)
            const target = nodeById.get(edge.to)
            if (!source || !target) return null
            const sourceHeight = goalSpaceNodeSize.height(source.goal)
            const targetHeight = goalSpaceNodeSize.height(target.goal)
            const x1 = source.x + goalSpaceNodeSize.width
            const y1 = source.y + sourceHeight / 2
            const x2 = target.x
            const y2 = target.y + targetHeight / 2
            const bend = Math.max(70, (x2 - x1) * .52)
            return <path key={`${edge.from}-${edge.to}`} d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} markerEnd="url(#goal-space-arrow)" />
          })}
        </svg>
        {layout.nodes.map((node) => <GoalSpaceCard key={node.goal.id} goal={node.goal} goals={visibleGoals} order={node.order} x={node.x} y={node.y} onOpen={() => onOpenGoal(node.goal.id)} />)}
      </div> : <div className="goal-space-empty"><span><GitBranch size={29} /></span><h2>这里还没有方向</h2><p>返回目标追踪创建第一个目标，它会自动出现在这片空间里。</p><Button onClick={onClose}>返回创建目标</Button></div>}

      <div className="goal-space-controls" aria-label="画布控制">
        <Button variant="outline" size="icon" onClick={() => zoomAtCenter(.12)} aria-label="放大"><Plus /></Button>
        <Button variant="outline" size="icon" onClick={() => zoomAtCenter(-.12)} aria-label="缩小"><Minus /></Button>
        <Button variant="outline" size="icon" onClick={fit} aria-label="适合屏幕"><Focus /></Button>
        <Button variant="outline" size="icon" onClick={() => setTransform({ x: 40, y: 70, scale: 1 })} aria-label="重置视图"><RotateCcw /></Button>
      </div>
      <div className="goal-space-scale">{Math.round(transform.scale * 100)}%</div>
    </div>
  </section>
}

function GoalSpaceCard({ goal, goals, order, x, y, onOpen }: { goal: Goal; goals: Goal[]; order: number; x: number; y: number; onOpen: () => void }) {
  const progress = goalProgressValue(goal, goals)
  const health = goalHealth(goal, goals)
  const milestones = goal.milestones.slice(0, 3)
  const childCount = goals.filter((item) => item.parentId === goal.id).length
  const metric = goal.progressMode === 'metric' ? `${goal.metricCurrent ?? 0} / ${goal.metricTarget ?? 100}${goal.metricUnit ? ` ${goal.metricUnit}` : ''}` : null
  return <button className={`goal-space-node ${goal.status}`} style={{ '--node-x': `${x}px`, '--node-y': `${y}px`, '--node-height': `${goalSpaceNodeSize.height(goal)}px` } as CSSProperties} onClick={onOpen}>
    <div className="goal-space-node-top"><span className={`goal-health-dot ${health}`} /><span>{goal.parentId ? `阶段 ${order}` : `方向 ${order}`}</span><span className={`goal-health-label ${health}`}>{goalHealthLabel[health]}</span></div>
    <h3 className="private-goal-title">{goal.title}</h3>
    <div className="goal-space-progress"><Progress value={progress} className={`progress-bar ${health}`} /><strong>{progress}%</strong></div>
    {metric && <div className="goal-space-metric"><Maximize2 size={13} /><span>指标</span><strong>{metric}</strong></div>}
    {milestones.length > 0 && <div className="goal-space-milestones">{milestones.map((milestone) => <div key={milestone.id} className={milestone.completed ? 'completed' : ''}><i /><span className="user-content">{milestone.title}</span><small>{milestone.completed ? '完成' : `${milestone.progress ?? 0}%`}</small></div>)}{goal.milestones.length > 3 && <small>还有 {goal.milestones.length - 3} 项关键成果</small>}</div>}
    <footer><span className={isOverdue(goal.dueDate, goal.status === 'completed') ? 'overdue' : ''}><CalendarDays size={12} />{goal.dueDate ? formatDate(goal.dueDate) : '未设日期'}</span>{childCount > 0 && <span><GitBranch size={12} />{childCount} 个分支</span>}</footer>
  </button>
}
