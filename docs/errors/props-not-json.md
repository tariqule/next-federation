# NF-009: Island props are not plain JSON

## Why This Error Occurred

Props passed to an island cross a network boundary, so values that are not plain JSON do not survive: functions, class instances, `Date`, `Map`, `undefined` in arrays and cyclic references. The message names the path of the bad value.

## Possible Ways to Fix It

- Convert props to plain JSON before passing them: ISO strings for dates, arrays for maps.
- Pass callbacks through events, not props.

  ```tsx
  <RemoteIsland remote="shop" island="Hello" props={{ when: new Date().toISOString() }} />
  ```

## Useful Links

- [Limits](../guides/limits.md)
