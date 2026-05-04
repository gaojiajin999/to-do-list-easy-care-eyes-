import { mkdirSync, openSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import process from 'node:process'

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)))
const nodePath = process.execPath
const outputDir = join(projectDir, 'outputs')

mkdirSync(outputDir, { recursive: true })

const services = [
  {
    name: 'frontend',
    script: join(projectDir, 'scripts', 'frontend-server.mjs'),
  },
  {
    name: 'analytics',
    script: join(projectDir, 'scripts', 'task-analytics-server.mjs'),
  },
]

for (const service of services) {
  const out = openSync(join(outputDir, `${service.name}-server.log`), 'a')
  const err = openSync(join(outputDir, `${service.name}-server.err.log`), 'a')

  const child = spawn(nodePath, [service.script], {
    cwd: projectDir,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, err],
  })

  child.unref()
}
