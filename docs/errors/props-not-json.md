# NF-009: Island props are not plain JSON

## What happened

Props passed to an island contain values that cannot be serialized as plain JSON.

## Why

Islands receive props across a network boundary. Functions, class instances, `Date`, `Map`, `undefined` in arrays and cyclic references do not survive.

## How to fix

Convert props to plain JSON before passing them (ISO strings for dates, arrays for maps) and pass callbacks through events rather than props.

See [Limits](../guides/limits.md).
