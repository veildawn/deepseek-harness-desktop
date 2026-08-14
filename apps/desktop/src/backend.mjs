import { once } from 'node:events'

const READY_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)(?:\s|$)/
const OUTPUT_TAIL_LIMIT = 16_384

/** Extract the loopback application URL from the CLI readiness line. */
export function extractReadyUrl(line) {
  return READY_LINE.exec(line)?.[1]
}

/**
 * Decode arbitrary stream chunks into complete lines.
 * @param {(line: string) => void} onLine - receives each complete line without its newline.
 * @returns stream chunk and final-flush handlers.
 */
export function createLineDecoder(onLine) {
  let carry = ''
  return {
    push(chunk) {
      carry += String(chunk)
      const lines = carry.split(/\r?\n/)
      carry = lines.pop() ?? ''
      for (const line of lines) onLine(line)
    },
    end() {
      if (carry !== '') onLine(carry)
      carry = ''
    },
  }
}

/**
 * Wait for `dsh web` to announce its OS-selected loopback port.
 * @param {import('node:events').EventEmitter & {stdout: NodeJS.ReadableStream | null, stderr: NodeJS.ReadableStream | null}} child - supervised backend process.
 * @param {{timeoutMs?: number, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream}} [options] - timeout and log destinations.
 * @returns {Promise<string>} the ready loopback URL.
 */
export async function waitForBackendReady(child, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000
  const stdoutTarget = options.stdout ?? process.stdout
  const stderrTarget = options.stderr ?? process.stderr
  const stdout = child.stdout
  const stderr = child.stderr
  if (stdout === null || stderr === null) throw new Error('desktop backend: process output must be piped')

  let outputTail = ''
  let readyUrl
  let resolveReady
  const ready = new Promise(resolve => { resolveReady = resolve })
  const decoder = createLineDecoder((line) => {
    const candidate = extractReadyUrl(line)
    if (candidate !== undefined && readyUrl === undefined) {
      readyUrl = candidate
      resolveReady(candidate)
    }
  })
  const appendTail = (chunk) => {
    outputTail = `${outputTail}${String(chunk)}`.slice(-OUTPUT_TAIL_LIMIT)
  }
  const onStdout = (chunk) => {
    stdoutTarget.write(chunk)
    appendTail(chunk)
    decoder.push(chunk)
  }
  const onStderr = (chunk) => {
    stderrTarget.write(chunk)
    appendTail(chunk)
  }
  stdout.on('data', onStdout)
  stderr.on('data', onStderr)

  const exited = once(child, 'exit').then(([code]) => {
    throw new Error(`desktop backend: dsh exited with code ${String(code)} before readiness\n${outputTail}`)
  })
  let timer
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`desktop backend: dsh did not become ready within ${String(timeoutMs)}ms\n${outputTail}`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([ready, exited, timedOut])
  } finally {
    clearTimeout(timer)
    decoder.end()
    stdout.off('data', onStdout)
    stderr.off('data', onStderr)
  }
}
