# NF-012: Uncaught error inside an island

## What happened

Code running inside an island threw an error that nothing caught.

## Why

The island's own component code failed during render or in an effect. The host stays up; only the island is affected.

## How to fix

Fix the error in the remote. Wrap the island in an error boundary in the host if you want a fallback while it is broken.
