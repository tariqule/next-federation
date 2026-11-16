// Whether a tampered remote server chunk ever ran in this process (it sets
// this global as its first statement). Reading the request keeps the
// handler dynamic in both caching models.
export function GET(request: Request) {
  return Response.json({
    tamperedRan:
      (globalThis as { __nfTamperedServerChunkRan?: boolean })
        .__nfTamperedServerChunkRan === true,
    url: new URL(request.url).pathname,
  })
}
