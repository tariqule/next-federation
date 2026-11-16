import type { NextApiRequest, NextApiResponse } from 'next'

// Whether a tampered remote server chunk ever ran in this process.
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.json({
    tamperedRan:
      (globalThis as { __nfTamperedServerChunkRan?: boolean })
        .__nfTamperedServerChunkRan === true,
  })
}
