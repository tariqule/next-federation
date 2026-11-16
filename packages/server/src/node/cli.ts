#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { logger } from '@next-federation/sdk'
import { serveBuilds } from './serve-builds.ts'

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    port: { type: 'string' },
    host: { type: 'string', default: '127.0.0.1' },
    current: { type: 'string' },
    'max-builds': { type: 'string' },
    'min-age-hours': { type: 'string' },
  },
})

function number(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`--${name} must be a non-negative number`)
  }
  return n
}

let served: Awaited<ReturnType<typeof serveBuilds>> | undefined
try {
  if (!values.dir || values.port === undefined) {
    throw new Error(
      'usage: nf-serve --dir <dir> --port <n> [--host 127.0.0.1] [--current <buildId>] [--max-builds 3] [--min-age-hours 24]'
    )
  }
  const minAgeHours = number('min-age-hours', values['min-age-hours'])
  served = await serveBuilds({
    dir: values.dir,
    port: number('port', values.port)!,
    host: values.host,
    onExit: ({ buildId }) => {
      // Fail fast: a supervisor (Docker, systemd, k8s) restarts the whole server.
      logger.info(
        `build "${buildId}" crashed; exiting so the supervisor restarts nf-serve`
      )
      void served?.close().finally(() => process.exit(1))
      setTimeout(() => process.exit(1), 5000).unref()
    },
    current: values.current,
    retention: {
      maxBuilds: number('max-builds', values['max-builds']),
      minAgeMs: minAgeHours === undefined ? undefined : minAgeHours * 3_600_000,
    },
  })
  logger.info(
    `nf-serve listening on ${values.host}:${served.port}; live builds: ${served.live.join(', ')} (current ${served.current}); retired: ${served.retired.join(', ') || 'none'}`
  )
  const stop = () => void served?.close().then(() => process.exit(0))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
} catch (error) {
  logger.info(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
