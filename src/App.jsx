import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabaseClient'
import './App.css'

const ORDER_STEP = 1000
const LONG_PRESS_DELAY = 300
const DRAG_CANCEL_DISTANCE = 8

const priorityLabels = {
  high: '高',
  medium: '中',
  low: '低',
}

const priorityOptions = [
  ['high', '高'],
  ['medium', '中'],
  ['low', '低'],
]

const filterOptions = [
  ['active', '未完成'],
  ['soon', '临近'],
  ['done', '已完成'],
  ['all', '全部'],
]

const defaultForm = {
  title: '',
  notes: '',
  dueAt: '',
  priority: 'medium',
}

function toLocalInputValue(value) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return offsetDate.toISOString().slice(0, 16)
}

function toDatabaseDate(value) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return date.toISOString()
}

function fromDatabaseTask(task) {
  return {
    id: task.id,
    title: task.title,
    notes: task.notes || '',
    dueAt: toLocalInputValue(task.due_at),
    priority: task.priority,
    completed: task.completed,
    createdAt: task.created_at,
    order: Number.isFinite(task.sort_order) ? task.sort_order : 0,
  }
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

function upsertTask(currentTasks, nextTask) {
  const existingIndex = currentTasks.findIndex((task) => task.id === nextTask.id)
  const mergedTasks =
    existingIndex === -1
      ? [...currentTasks, nextTask]
      : currentTasks.map((task) => (task.id === nextTask.id ? nextTask : task))

  return [...mergedTasks].sort(compareTaskOrder)
}

function getNotifiedTaskIds(userId) {
  try {
    const saved = localStorage.getItem(`remindly-notified-${userId}`)
    const parsedIds = saved ? JSON.parse(saved) : []
    return Array.isArray(parsedIds) ? new Set(parsedIds) : new Set()
  } catch {
    return new Set()
  }
}

function saveNotifiedTaskIds(userId, ids) {
  localStorage.setItem(`remindly-notified-${userId}`, JSON.stringify([...ids]))
}

function AuthPanel({ authMessage, authError, onSignIn }) {
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    const cleanEmail = email.trim()
    if (!cleanEmail) return

    setIsSubmitting(true)
    await onSignIn(cleanEmail)
    setIsSubmitting(false)
  }

  return (
    <main className="app-shell">
      <section className="auth-layout">
        <div className="auth-copy">
          <p className="eyebrow">Todo Reminder</p>
          <h1>登录后，在电脑和 iPhone 上同步你的待办</h1>
          <p>
            输入邮箱获取登录链接。同一个账号在不同设备打开公网地址后，会自动同步任务列表和完成状态。
          </p>
        </div>
        <form className="auth-panel" onSubmit={handleSubmit}>
          <h2>邮箱登录</h2>
          <label>
            邮箱地址
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? '正在发送...' : '发送登录链接'}
          </button>
          {authMessage ? <p className="status-message success">{authMessage}</p> : null}
          {authError ? <p className="status-message error">{authError}</p> : null}
        </form>
      </section>
    </main>
  )
}

function SetupPanel() {
  return (
    <main className="app-shell">
      <section className="auth-layout">
        <div className="auth-copy">
          <p className="eyebrow">Todo Reminder</p>
          <h1>还差一步 Supabase 配置</h1>
          <p>
            请根据项目里的 .env.example 设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY，
            然后重启开发服务器。
          </p>
        </div>
      </section>
    </main>
  )
}

function App() {
  const [session, setSession] = useState(null)
  const [isSessionLoading, setIsSessionLoading] = useState(isSupabaseConfigured)
  const [tasks, setTasks] = useState([])
  const [form, setForm] = useState(defaultForm)
  const [filter, setFilter] = useState('active')
  const [dragState, setDragState] = useState(null)
  const [isTasksLoading, setIsTasksLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [authError, setAuthError] = useState('')
  const [notificationStatus, setNotificationStatus] = useState(
    'Notification' in window ? Notification.permission : 'unsupported',
  )
  const taskItemRefs = useRef(new Map())
  const pendingDragRef = useRef(null)
  const activeDragRef = useRef(null)
  const audioContextRef = useRef(null)

  const user = session?.user

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
    if (!isSupabaseConfigured) {
      return undefined
    }

    let isMounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return
      setSession(data.session)
      setIsSessionLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) {
        setTasks([])
        setForm(defaultForm)
      }
      setIsSessionLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!user) return undefined

    let isMounted = true
    const userId = user.id

    async function loadTasks() {
      setIsTasksLoading(true)
      setErrorMessage('')

      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .order('sort_order', { ascending: true })

      if (!isMounted) return

      if (error) {
        setErrorMessage('任务加载失败，请检查 Supabase 表结构和权限策略。')
      } else {
        setTasks((data || []).map(fromDatabaseTask).sort(compareTaskOrder))
      }

      setIsTasksLoading(false)
    }

    loadTasks()

    const channel = supabase
      .channel(`tasks-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setTasks((currentTasks) =>
              currentTasks.filter((task) => task.id !== payload.old.id),
            )
            return
          }

          setTasks((currentTasks) =>
            upsertTask(currentTasks, fromDatabaseTask(payload.new)),
          )
        },
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
  }, [user])

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

  useEffect(() => {
    if (!user) return undefined

    const timer = window.setInterval(() => {
      const notifiedTaskIds = getNotifiedTaskIds(user.id)
      const now = Date.now()
      let didNotify = false

      tasks.forEach((task) => {
        if (task.completed || notifiedTaskIds.has(task.id) || !task.dueAt) return

        const due = new Date(task.dueAt).getTime()
        if (Number.isNaN(due) || due > now) return

        if (Notification.permission === 'granted') {
          new Notification('待办提醒', {
            body: task.title,
            tag: task.id,
          })
        }

        notifiedTaskIds.add(task.id)
        didNotify = true
      })

      if (didNotify) saveNotifiedTaskIds(user.id, notifiedTaskIds)
    }, 15000)

    return () => window.clearInterval(timer)
  }, [tasks, user])

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

  async function signInWithEmail(email) {
    setAuthMessage('')
    setAuthError('')

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    })

    if (error) {
      setAuthError('登录链接发送失败，请检查邮箱或 Supabase Auth 配置。')
    } else {
      setAuthMessage('登录链接已发送，请打开邮箱完成登录。')
    }
  }

  async function signOut() {
    cancelDrag()
    setErrorMessage('')
    await supabase.auth.signOut()
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function addTask(event) {
    event.preventDefault()
    if (!user) return

    const title = form.title.trim()
    if (!title) return

    const minOrder = tasks.reduce(
      (lowest, task) => Math.min(lowest, Number.isFinite(task.order) ? task.order : 0),
      0,
    )
    const nextTask = {
      user_id: user.id,
      title,
      notes: form.notes.trim() || null,
      due_at: toDatabaseDate(form.dueAt),
      priority: form.priority,
      completed: false,
      sort_order: minOrder - ORDER_STEP,
    }

    setForm(defaultForm)
    setErrorMessage('')

    const { data, error } = await supabase.from('tasks').insert(nextTask).select().single()

    if (error) {
      setErrorMessage('添加失败，请稍后再试。')
      setForm({ ...defaultForm, title, notes: form.notes, dueAt: form.dueAt, priority: form.priority })
    } else if (data) {
      setTasks((currentTasks) => upsertTask(currentTasks, fromDatabaseTask(data)))
    }
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

  async function toggleTask(id) {
    const taskToToggle = tasks.find((task) => task.id === id)
    if (!taskToToggle) return

    if (!taskToToggle.completed) {
      void playCompletionSound()
    }

    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task,
      ),
    )
    setErrorMessage('')

    const { error } = await supabase
      .from('tasks')
      .update({ completed: !taskToToggle.completed })
      .eq('id', id)

    if (error) {
      setErrorMessage('更新任务失败，请刷新后再试。')
      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === id ? { ...task, completed: taskToToggle.completed } : task,
        ),
      )
    }
  }

  async function deleteTask(id) {
    const previousTasks = tasks
    cancelDrag()
    setTasks((currentTasks) => currentTasks.filter((task) => task.id !== id))
    setErrorMessage('')

    const { error } = await supabase.from('tasks').delete().eq('id', id)

    if (error) {
      setErrorMessage('删除任务失败，请刷新后再试。')
      setTasks(previousTasks)
    }
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

  async function reorderVisibleTasks(taskId, targetIndex) {
    const visibleIds = visibleTasks.map((task) => task.id)
    const sourceIndex = visibleIds.indexOf(taskId)
    if (sourceIndex === -1) return

    const reorderedVisibleIds = [...visibleIds]
    const [movedId] = reorderedVisibleIds.splice(sourceIndex, 1)
    const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
    reorderedVisibleIds.splice(adjustedTargetIndex, 0, movedId)

    const currentById = new Map(tasks.map((task) => [task.id, task]))
    const visibleIdSet = new Set(visibleIds)
    const sortedGlobalIds = [...tasks].sort(compareTaskOrder).map((task) => task.id)
    let nextVisibleIndex = 0
    const nextGlobalIds = sortedGlobalIds.map((id) =>
      visibleIdSet.has(id) ? reorderedVisibleIds[nextVisibleIndex++] : id,
    )
    const nextTasks = nextGlobalIds.map((id, index) => ({
      ...currentById.get(id),
      order: index * ORDER_STEP,
    }))

    setTasks(nextTasks)
    setErrorMessage('')

    const updates = nextTasks.map((task) => ({
      id: task.id,
      user_id: user.id,
      title: task.title,
      notes: task.notes || null,
      due_at: toDatabaseDate(task.dueAt),
      priority: task.priority,
      completed: task.completed,
      sort_order: task.order,
    }))
    const { error } = await supabase.from('tasks').upsert(updates)

    if (error) {
      setErrorMessage('排序保存失败，请刷新后再试。')
    }
  }

  function finishDrag(event) {
    cancelPendingDrag()

    const currentDrag = activeDragRef.current
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return

    void reorderVisibleTasks(currentDrag.taskId, currentDrag.targetIndex)
    activeDragRef.current = null
    setDragState(null)
  }

  if (!isSupabaseConfigured) return <SetupPanel />

  if (isSessionLoading) {
    return (
      <main className="app-shell">
        <section className="loading-panel">正在连接同步服务...</section>
      </main>
    )
  }

  if (!user) {
    return (
      <AuthPanel
        authMessage={authMessage}
        authError={authError}
        onSignIn={signInWithEmail}
      />
    )
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Todo Reminder</p>
            <h1>待办事项提醒工具</h1>
            <p className="account-line">已登录：{user.email}</p>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={requestNotifications}
              disabled={notificationStatus === 'granted' || notificationStatus === 'unsupported'}
            >
              {notificationStatus === 'granted' ? '提醒已开启' : '开启浏览器提醒'}
            </button>
            <button type="button" className="ghost-button" onClick={signOut}>
              退出登录
            </button>
          </div>
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

        {errorMessage ? <p className="status-message error">{errorMessage}</p> : null}

        <section className="content-grid">
          <form className="task-form" onSubmit={addTask}>
            <h2>添加提醒</h2>
            <label>
              任务名称
              <input
                value={form.title}
                onChange={(event) => updateForm('title', event.target.value)}
                placeholder="例如：7:30 前提交日报"
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
                  {priorityOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
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
                {filterOptions.map(([value, label]) => (
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
              {isTasksLoading ? (
                <div className="empty-state">正在同步任务...</div>
              ) : visibleTasks.length === 0 ? (
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
