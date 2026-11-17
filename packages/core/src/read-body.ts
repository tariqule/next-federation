/**
 * The raw bytes of a response body, read with a byte counter: null (and the
 * body cancelled) once it passes `maxBytes`, whatever its content-length
 * says, so a remote can never make the host buffer an unbounded body.
 */
export async function readBodyLimited(
  response: Response,
  maxBytes: number
): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length'))
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => {})
    return null
  }
  if (!response.body) return new Uint8Array(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
