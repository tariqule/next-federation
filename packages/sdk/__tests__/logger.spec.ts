import { createLogger } from '../src/index.ts'

function fakeSink() {
  return {
    debug: rs.fn(),
    info: rs.fn(),
    warn: rs.fn(),
    error: rs.fn(),
  }
}

test('prefixes every line', () => {
  const sink = fakeSink()
  const log = createLogger('[ next-federation ]', sink)
  log.warn('NF-024', 'x')
  log.info('hello')
  log.error('NF-007', 'y')
  expect(sink.warn).toHaveBeenCalledWith(
    '[ next-federation ]',
    expect.stringContaining('NF-024')
  )
  expect(sink.info).toHaveBeenCalledWith('[ next-federation ]', 'hello')
  expect(sink.error).toHaveBeenCalledWith(
    '[ next-federation ]',
    expect.stringContaining('NF-007: Island fetch failed. y')
  )
})

test('error forwards the cause', () => {
  const sink = fakeSink()
  const cause = new Error('boom')
  createLogger('p', sink).error('NF-007', 'y', cause)
  expect(sink.error).toHaveBeenCalledWith('p', expect.any(String), cause)
})

test('warnOnce logs once per key', () => {
  const sink = fakeSink()
  const log = createLogger('p', sink)
  log.warnOnce('NF-024', 'k')
  log.warnOnce('NF-024', 'k')
  expect(sink.warn).toHaveBeenCalledTimes(1)
  log.warnOnce('NF-024', 'other')
  expect(sink.warn).toHaveBeenCalledTimes(2)
})

test('debug is silent unless NF_DEBUG is set', () => {
  const sink = fakeSink()
  const log = createLogger('p', sink)
  const prior = process.env.NF_DEBUG
  try {
    delete process.env.NF_DEBUG
    log.debug('quiet')
    expect(sink.debug).not.toHaveBeenCalled()
    process.env.NF_DEBUG = '1'
    log.debug('loud')
    expect(sink.debug).toHaveBeenCalledWith('p', 'loud')
  } finally {
    if (prior === undefined) delete process.env.NF_DEBUG
    else process.env.NF_DEBUG = prior
  }
})

test.each(['0', 'false', 'FALSE', 'False'])(
  'NF_DEBUG=%s keeps debug off',
  (value) => {
    const sink = fakeSink()
    const log = createLogger('p', sink)
    const prior = process.env.NF_DEBUG
    try {
      process.env.NF_DEBUG = value
      log.debug('quiet')
      expect(sink.debug).not.toHaveBeenCalled()
    } finally {
      if (prior === undefined) delete process.env.NF_DEBUG
      else process.env.NF_DEBUG = prior
    }
  }
)
