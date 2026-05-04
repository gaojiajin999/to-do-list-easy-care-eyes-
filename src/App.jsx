import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabaseClient'
import './App.css'

const ROOM_STORAGE_KEY = 'remindly-room'
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

const taskTimeSections = [
  { id: 'morning', label: '\u65e9\u4e0a', alwaysShow: true },
  { id: 'afternoon', label: '\u4e0b\u5348', alwaysShow: true },
  { id: 'evening', label: '\u665a\u4e0a', alwaysShow: true },
  { id: 'untimed', label: '\u672a\u8bbe\u7f6e\u65f6\u95f4', alwaysShow: false },
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

async function hashRoomCode(roomCode) {
  const normalizedCode = roomCode.trim().toLowerCase()
  const bytes = new TextEncoder().encode(normalizedCode)
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function loadSavedRoom() {
  try {
    const saved = localStorage.getItem(ROOM_STORAGE_KEY)
    return saved ? JSON.parse(saved) : null
  } catch {
    return null
  }
}

function saveRoom(room) {
  localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify(room))
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

function getTaskTimeSectionId(task) {
  if (!task.dueAt) return 'untimed'

  const date = new Date(task.dueAt)
  if (Number.isNaN(date.getTime())) return 'untimed'

  const hour = date.getHours()
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
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

function compareTaskDisplayTime(a, b) {
  const dueA = new Date(a.dueAt).getTime()
  const dueB = new Date(b.dueAt).getTime()
  const hasDueA = !Number.isNaN(dueA)
  const hasDueB = !Number.isNaN(dueB)

  if (hasDueA && hasDueB && dueA !== dueB) return dueA - dueB
  if (hasDueA !== hasDueB) return hasDueA ? -1 : 1

  return compareTaskOrder(a, b)
}

function upsertTask(currentTasks, nextTask) {
  const existingIndex = currentTasks.findIndex((task) => task.id === nextTask.id)
  const mergedTasks =
    existingIndex === -1
      ? [...currentTasks, nextTask]
      : currentTasks.map((task) => (task.id === nextTask.id ? nextTask : task))

  return [...mergedTasks].sort(compareTaskOrder)
}

function getNotifiedTaskIds(roomId) {
  try {
    const saved = localStorage.getItem(`remindly-notified-${roomId}`)
    const parsedIds = saved ? JSON.parse(saved) : []
    return Array.isArray(parsedIds) ? new Set(parsedIds) : new Set()
  } catch {
    return new Set()
  }
}

function saveNotifiedTaskIds(roomId, ids) {
  localStorage.setItem(`remindly-notified-${roomId}`, JSON.stringify([...ids]))
}

function RoomPanel({ roomError, onEnterRoom }) {
  const [roomCode, setRoomCode] = useState('')
  const [rememberRoom, setRememberRoom] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    const cleanCode = roomCode.trim()
    if (!cleanCode) return

    setIsSubmitting(true)
    await onEnterRoom(cleanCode, rememberRoom)
    setIsSubmitting(false)
  }

  return (
    <main className="app-shell">
      <section className="auth-layout">
        <div className="auth-copy">
          <p className="eyebrow">Todo Reminder</p>
          <h1>输入房间码，在电脑和 iPhone 上同步待办</h1>
          <p>
            不需要邮箱登录。电脑和手机输入同一个房间码，就会进入同一份待办列表。
            建议使用不容易猜到的房间码，例如 jj-todo-2026-9x7k。
          </p>
        </div>
        <form className="auth-panel" onSubmit={handleSubmit}>
          <h2>房间码同步</h2>
          <label>
            房间码
            <input
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value)}
              placeholder="例如：jj-todo-2026-9x7k"
              autoComplete="off"
              minLength="4"
              required
            />
          </label>
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? '正在进入...' : '进入同步房间'}
          </button>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={rememberRoom}
              onChange={(event) => setRememberRoom(event.target.checked)}
            />
            记住房间码，下次自动进入
          </label>
          <p className="room-hint">房间码只保存在你的设备上，数据库里只保存加密后的房间标识。</p>
          {roomError ? <p className="status-message error">{roomError}</p> : null}
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
  const [room, setRoom] = useState(loadSavedRoom)
  const [roomError, setRoomError] = useState('')
  const [tasks, setTasks] = useState([])
  const [form, setForm] = useState(defaultForm)
  const [filter, setFilter] = useState('active')
  const [dragState, setDragState] = useState(null)
  const [isTasksLoading, setIsTasksLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [analyticsServiceStatus, setAnalyticsServiceStatus] = useState('checking')
  const [isStartupHelpOpen, setIsStartupHelpOpen] = useState(false)
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

  const checkAnalyticsService = useCallback(async () => {
    setAnalyticsServiceStatus('checking')

    try {
      const response = await fetch('http://127.0.0.1:8787/health')
      const result = await response.json()
      setAnalyticsServiceStatus(response.ok && result.ok ? 'online' : 'offline')
    } catch {
      setAnalyticsServiceStatus('offline')
    }
  }, [])

  useEffect(() => {
    if (!room?.id) return undefined

    let isMounted = true
    const roomId = room.id

    async function loadTasks() {
      setIsTasksLoading(true)
      setErrorMessage('')

      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('room_id', roomId)
        .order('sort_order', { ascending: true })

      if (!isMounted) return

      if (error) {
        setErrorMessage('任务加载失败，请先在 Supabase 执行新的房间码 SQL。')
      } else {
        setTasks((data || []).map(fromDatabaseTask).sort(compareTaskOrder))
      }

      setIsTasksLoading(false)
    }

    loadTasks()

    const channel = supabase
      .channel(`tasks-room-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `room_id=eq.${roomId}`,
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
  }, [room])

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
    let isMounted = true

    async function loadAnalyticsServiceStatus() {
      try {
        const response = await fetch('http://127.0.0.1:8787/health')
        const result = await response.json()
        if (isMounted) {
          setAnalyticsServiceStatus(response.ok && result.ok ? 'online' : 'offline')
        }
      } catch {
        if (isMounted) setAnalyticsServiceStatus('offline')
      }
    }

    void loadAnalyticsServiceStatus()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!room?.id) return undefined

    const timer = window.setInterval(() => {
      const notifiedTaskIds = getNotifiedTaskIds(room.id)
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

      if (didNotify) saveNotifiedTaskIds(room.id, notifiedTaskIds)
    }, 15000)

    return () => window.clearInterval(timer)
  }, [tasks, room])

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

  const groupedTaskSections = useMemo(() => {
    const tasksBySection = new Map(taskTimeSections.map((section) => [section.id, []]))

    visibleTasks.forEach((task) => {
      const sectionId = getTaskTimeSectionId(task)
      tasksBySection.get(sectionId)?.push(task)
    })

    return taskTimeSections
      .map((section) => ({
        ...section,
        tasks:
          section.id === 'untimed'
            ? tasksBySection.get(section.id) || []
            : [...(tasksBySection.get(section.id) || [])].sort(compareTaskDisplayTime),
      }))
      .filter((section) => section.alwaysShow || section.tasks.length > 0)
  }, [visibleTasks])

  const renderedVisibleTasks = useMemo(
    () => groupedTaskSections.flatMap((section) => section.tasks),
    [groupedTaskSections],
  )

  const renderedTaskIndexes = useMemo(
    () => new Map(renderedVisibleTasks.map((task, index) => [task.id, index])),
    [renderedVisibleTasks],
  )

  async function enterRoom(roomCode, rememberRoom = true) {
    try {
      const roomId = await hashRoomCode(roomCode)
      const nextRoom = {
        id: roomId,
        label: roomCode,
      }
      if (rememberRoom) {
        saveRoom(nextRoom)
      } else {
        localStorage.removeItem(ROOM_STORAGE_KEY)
      }
      setRoom(nextRoom)
      setTasks([])
      setForm(defaultForm)
      setRoomError('')
    } catch {
      setRoomError('进入房间失败，请确认当前浏览器支持安全加密 API。')
    }
  }

  function leaveRoom() {
    cancelDrag()
    localStorage.removeItem(ROOM_STORAGE_KEY)
    setRoom(null)
    setTasks([])
    setForm(defaultForm)
    setErrorMessage('')
  }

  async function copyRoomCode() {
    if (!room?.label) return

    try {
      await navigator.clipboard.writeText(room.label)
      setErrorMessage('')
    } catch {
      setErrorMessage('复制房间码失败，请手动复制顶部显示的房间码。')
    }
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function addTask(event) {
    event.preventDefault()
    if (!room?.id) return

    const title = form.title.trim()
    if (!title) return

    const minOrder = tasks.reduce(
      (lowest, task) => Math.min(lowest, Number.isFinite(task.order) ? task.order : 0),
      0,
    )
    const nextTask = {
      room_id: room.id,
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
      setErrorMessage('添加失败，请确认 Supabase 已执行新的房间码 SQL。')
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

  async function notifyAnalyticsSync(roomId) {
    try {
      await fetch('http://127.0.0.1:8787/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roomId }),
      })
    } catch {
      // Local analytics sync is optional; the todo update should never depend on it.
    }
  }

  async function toggleTask(id) {
    const taskToToggle = tasks.find((task) => task.id === id)
    if (!taskToToggle || !room?.id) return

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
      .eq('room_id', room.id)

    if (error) {
      setErrorMessage('更新任务失败，请刷新后再试。')
      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === id ? { ...task, completed: taskToToggle.completed } : task,
        ),
      )
    } else if (!taskToToggle.completed) {
      void notifyAnalyticsSync(room.id)
    }
  }

  async function deleteTask(id) {
    if (!room?.id) return

    const previousTasks = tasks
    cancelDrag()
    setTasks((currentTasks) => currentTasks.filter((task) => task.id !== id))
    setErrorMessage('')

    const { error } = await supabase.from('tasks').delete().eq('id', id).eq('room_id', room.id)

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
    for (let index = 0; index < renderedVisibleTasks.length; index += 1) {
      const node = taskItemRefs.current.get(renderedVisibleTasks[index].id)
      if (!node) continue

      const rect = node.getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) return index
    }

    return renderedVisibleTasks.length
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
    if (!room?.id) return

    const visibleIds = renderedVisibleTasks.map((task) => task.id)
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
      room_id: room.id,
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

  function renderTask(task) {
    const index = renderedTaskIndexes.get(task.id)
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
            aria-label={task.completed ? '\u6807\u8bb0\u4e3a\u672a\u5b8c\u6210' : '\u6807\u8bb0\u4e3a\u5b8c\u6210'}
          >
            {task.completed ? '\u2713' : ''}
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
            aria-label="\u5220\u9664\u5f85\u529e"
          >
            {'\u00d7'}
          </button>
        </article>
      </div>
    )
  }

  if (!isSupabaseConfigured) return <SetupPanel />

  if (!room) {
    return <RoomPanel roomError={roomError} onEnterRoom={enterRoom} />
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Todo Reminder</p>
            <h1>待办事项提醒工具</h1>
            <p className="account-line">当前房间：{room.label}</p>
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
            <button type="button" className="ghost-button" onClick={copyRoomCode}>
              复制房间码
            </button>
            <button type="button" className="ghost-button" onClick={leaveRoom}>
              切换房间
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
          <div className="side-column">
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

          <section className="quote-card">
            <div className="quote-card-copy">
              <p>{'\u4eca\u65e5\u81ea\u52c9'}</p>
              <h2>{'\u505a\u6709\u5fc3\u4eba'}</h2>
              <h2>{'\u5e72\u56f0\u96be\u4e8b'}</h2>
              <h2>{'\u7acb\u5927\u683c\u5c40'}</h2>
            </div>

            <div className={`analytics-status is-${analyticsServiceStatus}`}>
              {analyticsServiceStatus === 'online' ? (
                <p>{'\u672c\u5730 Excel \u540c\u6b65\u5df2\u8fd0\u884c'}</p>
              ) : (
                <>
                  <p>
                    {analyticsServiceStatus === 'checking'
                      ? '\u6b63\u5728\u68c0\u6d4b Excel \u540c\u6b65\u670d\u52a1...'
                      : '\u540c\u6b65\u670d\u52a1\u672a\u8fd0\u884c\uff0c\u5b89\u88c5\u5f00\u673a\u81ea\u542f\u540e\u53ef\u81ea\u52a8\u6062\u590d\u3002'}
                  </p>
                  <div className="analytics-status-actions">
                    <button type="button" className="note-toggle-button" onClick={checkAnalyticsService}>
                      {'\u68c0\u6d4b\u670d\u52a1'}
                    </button>
                    <button
                      type="button"
                      className="note-toggle-button"
                      onClick={() => setIsStartupHelpOpen((isOpen) => !isOpen)}
                    >
                      {isStartupHelpOpen ? '\u9690\u85cf\u8bf4\u660e' : '\u67e5\u770b\u5f00\u673a\u81ea\u542f\u8bf4\u660e'}
                    </button>
                  </div>
                  {isStartupHelpOpen ? (
                    <div className="startup-help">
                      <p>{'\u53ea\u9700\u8981\u8fd0\u884c\u4e00\u6b21\u5b89\u88c5\u811a\u672c\uff1a'}</p>
                      <code>
                        {'powershell -ExecutionPolicy Bypass -File scripts/install-analytics-startup.ps1'}
                      </code>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </section>
          </div>

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
                  {groupedTaskSections.map((section) => (
                    <section className="task-time-section" key={section.id}>
                      <div className="task-time-section-header">
                        <h3>{section.label}</h3>
                        <span>{section.tasks.length} {'\u9879'}</span>
                      </div>
                      <div className="task-time-section-body">
                        {section.tasks.length > 0 ? (
                          section.tasks.map((task) => renderTask(task))
                        ) : (
                          <div className="time-section-empty">{'\u6682\u65e0\u4efb\u52a1'}</div>
                        )}
                      </div>
                    </section>
                  ))}
                  {dragState?.targetIndex === renderedVisibleTasks.length ? (
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
