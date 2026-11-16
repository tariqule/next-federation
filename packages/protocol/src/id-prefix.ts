import type { IslandEnvelope } from './envelope.ts'

/**
 * Makes one envelope mountable many times on a page: replaces every `idPlaceholder` with a
 * prefix unique to this mount, and returns it for React's `identifierPrefix`.
 */
export function applyIdPrefix(
  envelope: Pick<IslandEnvelope, 'html' | 'rscPayload' | 'idPlaceholder'>,
  mountId: string
): { html: string; rscPayload: string; identifierPrefix: string } {
  const { idPlaceholder } = envelope
  const identifierPrefix = `${idPlaceholder}${mountId.replace(/[^A-Za-z0-9]/g, '')}-`
  return {
    html: envelope.html.split(idPlaceholder).join(identifierPrefix),
    rscPayload: envelope.rscPayload.split(idPlaceholder).join(identifierPrefix),
    identifierPrefix,
  }
}
