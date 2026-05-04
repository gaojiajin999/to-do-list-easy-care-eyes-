import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'

const HOST = '127.0.0.1'
const PORT = 8787
const TIME_ZONE = 'Asia/Shanghai'
const OUTPUT_PATH = path.resolve('outputs', 'task-analytics.xlsx')
const LOCAL_ORIGIN_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/

function parseEnv(content) {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const [key, ...valueParts] = line.split('=')
        return [key.trim(), valueParts.join('=').trim().replace(/^["']|["']$/g, '')]
      }),
  )
}

async function loadConfig() {
  const envText = await fs.readFile('.env.local', 'utf8')
  const env = parseEnv(envText)
  const supabaseUrl = env.VITE_SUPABASE_URL
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local')
  }

  return { supabaseUrl, supabaseAnonKey }
}

function jsonResponse(response, statusCode, body, origin) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(origin),
  })
  response.end(JSON.stringify(body))
}

function corsHeaders(origin) {
  const allowedOrigin = origin && LOCAL_ORIGIN_PATTERN.test(origin) ? origin : `http://${HOST}:5173`

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''

    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body is too large'))
        request.destroy()
      }
    })

    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error('Request body must be valid JSON'))
      }
    })

    request.on('error', reject)
  })
}

function getZonedParts(value) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
  }
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function toDateKey(parts) {
  return parts ? `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}` : '未设置时间'
}

function toMonthKey(parts) {
  return parts ? `${parts.year}-${pad2(parts.month)}` : '未设置时间'
}

function toTimeText(parts) {
  return parts ? `${toDateKey(parts)} ${pad2(parts.hour)}:${pad2(parts.minute)}` : '未设置时间'
}

function getIsoWeekKey(parts) {
  if (!parts) return '未设置时间'

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const weekYear = date.getUTCFullYear()
  const yearStart = new Date(Date.UTC(weekYear, 0, 1))
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7)

  return `${weekYear}-W${pad2(week)}`
}

function getTimeSection(parts) {
  if (!parts) return '未设置时间'
  if (parts.hour < 12) return '早上'
  if (parts.hour < 18) return '下午'
  return '晚上'
}

function emptySummary(key) {
  return {
    key,
    total: 0,
    high: 0,
    medium: 0,
    low: 0,
    morning: 0,
    afternoon: 0,
    evening: 0,
    untimed: 0,
  }
}

function addToSummary(map, key, task) {
  if (!map.has(key)) map.set(key, emptySummary(key))

  const summary = map.get(key)
  summary.total += 1
  summary[task.priority] = (summary[task.priority] || 0) + 1

  if (task.timeSection === '早上') summary.morning += 1
  else if (task.timeSection === '下午') summary.afternoon += 1
  else if (task.timeSection === '晚上') summary.evening += 1
  else summary.untimed += 1
}

function prepareAnalytics(tasks) {
  const completedTasks = tasks
    .filter((task) => task.completed)
    .map((task) => {
      const dueParts = getZonedParts(task.due_at)
      const createdParts = getZonedParts(task.created_at)

      return {
        title: task.title,
        notes: task.notes || '',
        priority: task.priority,
        dueText: toTimeText(dueParts),
        dateKey: toDateKey(dueParts),
        weekKey: getIsoWeekKey(dueParts),
        monthKey: toMonthKey(dueParts),
        timeSection: getTimeSection(dueParts),
        completedText: task.completed ? '已完成' : '未完成',
        createdText: toTimeText(createdParts),
        dueSort: dueParts
          ? `${toDateKey(dueParts)} ${pad2(dueParts.hour)}:${pad2(dueParts.minute)}`
          : '9999-12-31 23:59',
      }
    })
    .sort((a, b) => {
      if (a.dueSort !== b.dueSort) return a.dueSort.localeCompare(b.dueSort)
      return a.title.localeCompare(b.title, 'zh-CN')
    })

  const daily = new Map()
  const weekly = new Map()
  const monthly = new Map()

  completedTasks.forEach((task) => {
    addToSummary(daily, task.dateKey, task)
    addToSummary(weekly, task.weekKey, task)
    addToSummary(monthly, task.monthKey, task)
  })

  return {
    details: completedTasks,
    daily: [...daily.values()].sort((a, b) => a.key.localeCompare(b.key)),
    weekly: [...weekly.values()].sort((a, b) => a.key.localeCompare(b.key)),
    monthly: [...monthly.values()].sort((a, b) => a.key.localeCompare(b.key)),
  }
}

function styleWorksheet(sheet, headerRow = 1) {
  sheet.views = [{ state: 'frozen', ySplit: headerRow }]
  sheet.getRow(headerRow).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(headerRow).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF176C78' },
  }
  sheet.getRow(headerRow).alignment = { vertical: 'middle' }
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD7E8E5' } },
        left: { style: 'thin', color: { argb: 'FFD7E8E5' } },
        bottom: { style: 'thin', color: { argb: 'FFD7E8E5' } },
        right: { style: 'thin', color: { argb: 'FFD7E8E5' } },
      }
      cell.alignment = { vertical: 'middle', wrapText: true }
    })
  })
}

function setColumns(sheet, columns) {
  sheet.columns = columns.map((column) => ({
    ...column,
    style: column.style || {},
  }))
}

function addDetailsSheet(workbook, rows) {
  const sheet = workbook.addWorksheet('任务明细')
  setColumns(sheet, [
    { header: '任务名', key: 'title', width: 28 },
    { header: '备注', key: 'notes', width: 32 },
    { header: '优先级', key: 'priority', width: 10 },
    { header: '提醒时间', key: 'dueText', width: 18 },
    { header: '日期', key: 'dateKey', width: 14 },
    { header: '周', key: 'weekKey', width: 12 },
    { header: '月份', key: 'monthKey', width: 12 },
    { header: '时间段', key: 'timeSection', width: 12 },
    { header: '完成状态', key: 'completedText', width: 12 },
    { header: '创建时间', key: 'createdText', width: 18 },
  ])
  sheet.addRows(rows)
  sheet.autoFilter = 'A1:J1'
  styleWorksheet(sheet)
}

function addSummarySheet(workbook, name, keyHeader, rows) {
  const sheet = workbook.addWorksheet(name)
  setColumns(sheet, [
    { header: keyHeader, key: 'key', width: 16 },
    { header: '完成任务数', key: 'total', width: 12 },
    { header: '高优先级', key: 'high', width: 12 },
    { header: '中优先级', key: 'medium', width: 12 },
    { header: '低优先级', key: 'low', width: 12 },
    { header: '早上', key: 'morning', width: 10 },
    { header: '下午', key: 'afternoon', width: 10 },
    { header: '晚上', key: 'evening', width: 10 },
    { header: '未设置时间', key: 'untimed', width: 14 },
  ])
  sheet.addRows(rows)
  sheet.autoFilter = 'A1:I1'
  styleWorksheet(sheet)
}

async function writeWorkbook(tasks) {
  const analytics = prepareAnalytics(tasks)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Todo Reminder'
  workbook.created = new Date()
  workbook.modified = new Date()

  addDetailsSheet(workbook, analytics.details)
  addSummarySheet(workbook, '每日统计', '日期', analytics.daily)
  addSummarySheet(workbook, '每周统计', '周', analytics.weekly)
  addSummarySheet(workbook, '每月统计', '月份', analytics.monthly)

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await workbook.xlsx.writeFile(OUTPUT_PATH)

  return {
    outputPath: OUTPUT_PATH,
    completedTaskCount: analytics.details.length,
  }
}

async function syncRoom(roomId, supabase) {
  if (!/^[a-f0-9]{64}$/i.test(roomId || '')) {
    throw new Error('roomId must be a SHA-256 hash')
  }

  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('room_id', roomId)
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)

  return writeWorkbook(data || [])
}

async function main() {
  const config = await loadConfig()
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey)

  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin || ''
    const url = new URL(request.url, `http://${HOST}:${PORT}`)

    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders(origin))
      response.end()
      return
    }

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        jsonResponse(response, 200, { ok: true, outputPath: OUTPUT_PATH }, origin)
        return
      }

      if (request.method === 'POST' && url.pathname === '/sync') {
        const body = await readJsonBody(request)
        const result = await syncRoom(body.roomId, supabase)
        jsonResponse(response, 200, { ok: true, ...result }, origin)
        return
      }

      jsonResponse(response, 404, { ok: false, error: 'Not found' }, origin)
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error.message }, origin)
    }
  })

  server.listen(PORT, HOST, () => {
    console.log(`Task analytics server listening at http://${HOST}:${PORT}`)
    console.log(`Excel output: ${OUTPUT_PATH}`)
  })
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
