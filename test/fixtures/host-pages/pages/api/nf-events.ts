import type { NextApiRequest, NextApiResponse } from 'next'
import { recordedEvents } from '../../lib/components'

// The server events componentsFederation's onEvent recorded (preload.spec.ts).
// DELETE clears them.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'DELETE') recordedEvents.length = 0
  res.json(
    recordedEvents.map((event) => ({
      type: event.type,
      remote: 'remote' in event ? event.remote : undefined,
      reason: 'reason' in event ? event.reason : undefined,
      env: 'env' in event ? event.env : undefined,
    }))
  )
}
