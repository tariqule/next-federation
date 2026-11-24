# NF-018: Island rendered a script or hoistable element

## Why This Error Occurred

Island markup contained a `<script>` or a hoistable element (`<title>`, `<meta>`, `<link>`), and it was removed. Islands are inserted into a host page, so head elements and inline code are not carried over.

## Possible Ways to Fix It

- Move head metadata to the host page.
- Load code through the island bootstrap instead of inline scripts.

## Useful Links

- [Writing an island remote](../guides/writing-an-island-remote.mdx)
