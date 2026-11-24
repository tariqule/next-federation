# NF-019: This remote build does not support island Server Actions

## Why This Error Occurred

An island called a Server Action, and the remote build that rendered it rejected the call. That build predates island Server Actions and has no action client. Current releases do not raise this code.

## Possible Ways to Fix It

- Rebuild and redeploy the remote with the current packages:

  ```npm
  npm install @next-federation/vite@latest @next-federation/island@latest
  ```

## Useful Links

- [Server Actions in islands](../guides/server-actions.md)
