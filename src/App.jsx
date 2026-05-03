import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'remindly-todos'
const ORDER_STEP = 1000
const LONG_PRESS_DELAY = 300
const DRAG_CANCEL_DISTANCE = 8

const priorityLabels = {
  high: '高',
  medium: '中',
  low: '低',
}

const defaultForm = {
  title: '',
  notes: '',
  dueAt: '',
  priority: 'medium',
}

const seedTasks = [
  {
    id: crypto.randomUUID(),
    title: '整理今天的工作清单',
    notes: '把最重要的三件事放在前面。',
    dueAt: toLocalInputValue(addMinutes(new Date(), 45)),
    priority: 'high',
    completed: false,
    notified: false,
    createdAt: new Date().toISOString(),
    order: 0,
  },
  {
    id: crypto.randomUUID(),
    title: '给项目做一次进度回顾',
    notes: '',
    dueAt: toLocalInputValue(addMinutes(new Date(), 160)),
    priority: 'medium',
    completed: false,
    notified: false,
    createdAt: new Date().toISOString(),
    order: ORDER_STEP,
  },
]

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000)
}

function toLocalInputValue(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return offsetDate.toISOString().slice(0, 16)
}

function getTaskState(task) {
  if (task.completed) return 'done'
  if (!task.dueAt) return 'open'

  const now = Date.now()
  const due = new Date(task.dueAt).getTime()

  if (Number.isNaN(due)) return 'open'
  if (due < now) return 'overdue'
  if (due - now <= 60 * 60 * 1000) return 'soon'
  return 'open'
}

function formatDueTime(value) {
  if (!value) return '未设置提醒'

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function compareTaskOrder(a, b) {
  const orderA = Number.isFinite(a.order) ? a.order : Number.POSITIVE_INFINITY
  const orderB = Number.isFinite(b.order) ? b.order : Number.POSITIVE_INFINITY

  if (orderA !== orderB) return orderA - orderB

  const dueA = new Date(a.dueAt || '2999-12-31').getTime()
  const dueB = new Date(b.dueAt || '2999-12-31').getTime()
  const safeDueA = Number.isNaN(dueA) ? Number.POSITIVE_INFINITY : dueA
  const safeDueB = Number.isNaN(dueB) ? Number.POSITIVE_INFINITY : dueB

  if (safeDueA !== safeDueB) return safeDueA - safeDueB
  return new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
}

function normalizeTasks(tasks) {
  return tasks.map((task, index) => ({
    ...task,
    order: Number.isFinite(task.order) ? task.order : index * ORDER_STEP,
  }))
}

function loadTasks() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    const parsedTasks = saved ? JSON.parse(saved) : seedTasks
    return Array.isArray(parsedTasks) ? normalizeTasks(parsedTasks) : seedTasks
  } catch {
    return seedTasks
  }
}

function App() {
  const [tasks, setTasks] = useState(loadTasks)
  const [form, setForm] = useState(defaultForm)
  const [filter, setFilter] = useState('active')
  const [dragState, setDragState] = useState(null)
  const [notificationStatus, setNotificationStatus] = useState(
    'Notification' in window ? Notification.permission : 'unsupported',
  )
  const taskItemRefs = useRef(new Map())
  const pendingDragRef = useRef(null)
  const activeDragRef = useRef(null)
  const audioContextRef = useRef(null)

  const cancelPendingDrag = useCallback(() => {
    if (pendingDragRef.current?.timerId) {
      window.clearTimeout(pendingDragRef.current.timerId)
    }
    pendingDragRef.current = null
  }, [])

  const cancelDrag = useCallback(() => {
    cancelPendingDrag()
    activeDragRef.current = null
    setDragState(null)
  }, [cancelPendingDrag])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  }, [tasks])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()

      setTasks((currentTasks) =>
        currentTasks.map((task) => {
          if (task.completed || task.notified || !task.dueAt) return task

          const due = new Date(task.dueAt).getTime()
          if (Number.isNaN(due) || due > now) return task

          if (Notification.permission === 'granted') {
            new Notification('待办提醒', {
              body: task.title,
              tag: task.id,
            })
          }

          return { ...task, notified: true }
        }),
      )
    }, 15000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('dragging-tasks', Boolean(dragState))

    return () => document.body.classList.remove('dragging-tasks')
  }, [dragState])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') cancelDrag()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cancelDrag])

  const stats = useMemo(() => {
    const active = tasks.filter((task) => !task.completed).length
    const overdue = tasks.filter((task) => getTaskState(task) === 'overdue').length
    const done = tasks.length - active

    return { active, overdue, done }
  }, [tasks])

  const visibleTasks = useMemo(() => {
    return [...tasks]
      .filter((task) => {
        const state = getTaskState(task)
        if (filter === 'active') return !task.completed
        if (filter === 'soon') return state === 'soon' || state === 'overdue'
        if (filter === 'done') return task.completed
        return true
      })
      .sort(compareTaskOrder)
  }, [filter, tasks])

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function addTask(event) {
    event.preventDefault()

    const title = form.title.trim()
    if (!title) return

    setTasks((currentTasks) => {
      const minOrder = currentTasks.reduce(
        (lowest, task) => Math.min(lowest, Number.isFinite(task.order) ? task.order : 0),
        0,
      )

      return [
        {
          id: crypto.randomUUID(),
          title,
          notes: form.notes.trim(),
          dueAt: form.dueAt,
          priority: form.priority,
          completed: false,
          notified: false,
          createdAt: new Date().toISOString(),
          order: minOrder - ORDER_STEP,
        },
        ...currentTasks,
      ]
    })
    setForm(defaultForm)
  }

  function getAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return null

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass()
    }

    return audioContextRef.current
  }

  async function playCompletionSound() {
    try {
      const audioContext = getAudioContext()
      if (!audioContext) return

      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }

      const now = audioContext.currentTime
      const masterGain = audioContext.createGain()
      masterGain.gain.setValueAtTime(0.0001, now)
      masterGain.gain.exponentialRampToValueAtTime(0.08, now + 0.02)
      masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34)
      masterGain.connect(audioContext.destination)

      ;[523.25, 659.25, 783.99].forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator()
        const noteGain = audioContext.createGain()
        const startAt = now + index * 0.07
        const stopAt = startAt + 0.22

        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(frequency, startAt)
        noteGain.gain.setValueAtTime(0.0001, startAt)
        noteGain.gain.exponentialRampToValueAtTime(0.72, startAt + 0.025)
        noteGain.gain.exponentialRampToValueAtTime(0.0001, stopAt)

        oscillator.connect(noteGain)
        noteGain.connect(masterGain)
        oscillator.start(startAt)
        oscillator.stop(stopAt + 0.02)
      })
    } catch {
      // Audio feedback is optional; task completion must stay reliable.
    }
  }

  function toggleTask(id) {
    const taskToToggle = tasks.find((task) => task.id === id)
    if (taskToToggle && !taskToToggle.completed) {
      void playCompletionSound()
    }

    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task,
      ),
    )
  }

  function deleteTask(id) {
    cancelDrag()
    setTasks((currentTasks) => currentTasks.filter((task) => task.id !== id))
  }

  async function requestNotifications() {
    if (!('Notification' in window)) return

    const permission = await Notification.requestPermission()
    setNotificationStatus(permission)
  }

  function setTaskItemRef(id, node) {
    if (node) {
      taskItemRefs.current.set(id, node)
    } else {
      taskItemRefs.current.delete(id)
    }
  }

  function getDropIndex(clientY) {
    for (let index = 0; index < visibleTasks.length; index += 1) {
      const node = taskItemRefs.current.get(visibleTasks[index].id)
      if (!node) continue

      const rect = node.getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) return index
    }

    return visibleTasks.length
  }

  function startDrag(taskId, pointerId, startY, clientY) {
    const targetIndex = getDropIndex(clientY)
    const nextDragState = { taskId, pointerId, startY, currentY: clientY, targetIndex }
    activeDragRef.current = nextDragState
    setDragState(nextDragState)
  }

  function startLongPress(event, taskId) {
    if (event.button !== 0 || event.target.closest('button, input, textarea, select')) return

    cancelDrag()
    event.currentTarget.setPointerCapture(event.pointerId)

    pendingDragRef.current = {
      taskId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timerId: window.setTimeout(() => {
        startDrag(taskId, event.pointerId, event.clientY, event.clientY)
        pendingDragRef.current = null
      }, LONG_PRESS_DELAY),
    }
  }

  function updateDrag(event) {
    const pendingDrag = pendingDragRef.current
    if (pendingDrag) {
      const deltaX = Math.abs(event.clientX - pendingDrag.startX)
      const deltaY = Math.abs(event.clientY - pendingDrag.startY)
      if (deltaX > DRAG_CANCEL_DISTANCE || deltaY > DRAG_CANCEL_DISTANCE) {
        cancelPendingDrag()
      }
      return
    }

    const currentDrag = activeDragRef.current
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return

    event.preventDefault()
    const targetIndex = getDropIndex(event.clientY)
    const nextDragState = { ...currentDrag, currentY: event.clientY, targetIndex }
    activeDragRef.current = nextDragState
    setDragState(nextDragState)
  }

  function reorderVisibleTasks(taskId, targetIndex) {
    const visibleIds = visibleTasks.map((task) => task.id)
    const sourceIndex = visibleIds.indexOf(taskId)
    if (sourceIndex === -1) return

    const reorderedVisibleIds = [...visibleIds]
    const [movedId] = reorderedVisibleIds.splice(sourceIndex, 1)
    const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
    reorderedVisibleIds.splice(adjustedTargetIndex, 0, movedId)

    setTasks((currentTasks) => {
      const currentById = new Map(currentTasks.map((task) => [task.id, task]))
      const visibleIdSet = new Set(visibleIds)
      const sortedGlobalIds = [...currentTasks].sort(compareTaskOrder).map((task) => task.id)
      let nextVisibleIndex = 0
      const nextGlobalIds = sortedGlobalIds.map((id) =>
        visibleIdSet.has(id) ? reorderedVisibleIds[nextVisibleIndex++] : id,
      )

      return nextGlobalIds.map((id, index) => ({
        ...currentById.get(id),
        order: index * ORDER_STEP,
      }))
    })
  }

  function finishDrag(event) {
    cancelPendingDrag()

    const currentDrag = activeDragRef.current
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return

    reorderVisibleTasks(currentDrag.taskId, currentDrag.targetIndex)
    activeDragRef.current = null
    setDragState(null)
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Todo Reminder</p>
            <h1>待办事项提醒工具</h1>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={requestNotifications}
            disabled={notificationStatus === 'granted' || notificationStatus === 'unsupported'}
          >
            {notificationStatus === 'granted' ? '提醒已开启' : '开启浏览器提醒'}
          </button>
        </header>

        <section className="summary-grid" aria-label="待办统计">
          <article>
            <span>{stats.active}</span>
            <p>进行中</p>
          </article>
          <article>
            <span>{stats.overdue}</span>
            <p>已过期</p>
          </article>
          <article>
            <span>{stats.done}</span>
            <p>已完成</p>
          </article>
        </section>

        <section className="content-grid">
          <form className="task-form" onSubmit={addTask}>
            <h2>添加提醒</h2>
            <label>
              任务名称
              <input
                value={form.title}
                onChange={(event) => updateForm('title', event.target.value)}
                placeholder="例如：17:30 前提交日报"
              />
            </label>
            <label>
              备注
              <textarea
                value={form.notes}
                onChange={(event) => updateForm('notes', event.target.value)}
                placeholder="补充地点、材料或下一步动作"
                rows="4"
              />
            </label>
            <div className="form-row">
              <label>
                提醒时间
                <input
                  type="datetime-local"
                  value={form.dueAt}
                  onChange={(event) => updateForm('dueAt', event.target.value)}
                />
              </label>
              <label>
                优先级
                <select
                  value={form.priority}
                  onChange={(event) => updateForm('priority', event.target.value)}
                >
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </label>
            </div>
            <button className="primary-button" type="submit">
              添加待办
            </button>
          </form>

          <section className="task-panel">
            <div className="panel-header">
              <h2>提醒列表</h2>
              <div className="segmented" aria-label="筛选待办">
                {[
                  ['active', '未完成'],
                  ['soon', '临近'],
                  ['done', '已完成'],
                  ['all', '全部'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={filter === value ? 'selected' : ''}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className={`task-list ${dragState ? 'drag-active' : ''}`}>
              {visibleTasks.length === 0 ? (
                <div className="empty-state">这个分类里还没有待办。</div>
              ) : (
                <>
                  {visibleTasks.map((task, index) => {
                    const state = getTaskState(task)
                    const isDragging = dragState?.taskId === task.id
                    const dragOffset = isDragging ? dragState.currentY - dragState.startY : 0

                    return (
                      <div className="task-drop-row" key={task.id}>
                        {dragState?.targetIndex === index ? <div className="drop-indicator" /> : null}
                        <article
                          ref={(node) => setTaskItemRef(task.id, node)}
                          className={`task-item ${state} priority-${task.priority} ${
                            isDragging ? 'is-dragging' : ''
                          }`}
                          style={
                            isDragging
                              ? { transform: `translateY(${dragOffset}px) scale(1.01)` }
                              : undefined
                          }
                          onPointerDown={(event) => startLongPress(event, task.id)}
                          onPointerMove={updateDrag}
                          onPointerUp={finishDrag}
                          onPointerCancel={cancelDrag}
                        >
                          <button
                            type="button"
                            className="check-button"
                            onClick={() => toggleTask(task.id)}
                            aria-label={task.completed ? '标记为未完成' : '标记为完成'}
                          >
                            {task.completed ? '✓' : ''}
                          </button>
                          <div className="task-body">
                            <div className="task-title-row">
                              <h3>{task.title}</h3>
                              <span className={`priority ${task.priority}`}>
                                {priorityLabels[task.priority]}
                              </span>
                            </div>
                            {task.notes ? <p className="notes">{task.notes}</p> : null}
                            <p className="due-time">{formatDueTime(task.dueAt)}</p>
                          </div>
                          <button
                            type="button"
                            className="delete-button"
                            onClick={() => deleteTask(task.id)}
                            aria-label="删除待办"
                          >
                            ×
                          </button>
                        </article>
                      </div>
                    )
                  })}
                  {dragState?.targetIndex === visibleTasks.length ? (
                    <div className="drop-indicator trailing" />
                  ) : null}
                </>
              )}
            </div>
          </section>
        </section>
      </section>
    </main>
  )
}

export default App
