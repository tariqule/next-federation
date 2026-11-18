# NF-018: Island rendered a script or hoistable element

## What happened

Island markup contained a `<script>` or a hoistable element (`<title>`, `<meta>`, `<link>`) that was removed.

## Why

Islands are inserted into a host page, so elements that belong to the document head or run code are not carried over.

Two removals are expected and not warned about: `<link rel="modulepreload">`, and React's own
form-replay script. React emits that script before a `<form>` whose `action` is a function, to
queue submits made before hydration; an island form is disabled until it hydrates, so there is
nothing to replay. Only an exact copy of React's script, with no attributes, is recognised: any
other script, including one that resembles it, is warned about.

## How to fix

Move head metadata to the host page and load code through the island bootstrap instead of inline scripts.

See [Writing an island remote](../guides/writing-an-island-remote.md).
