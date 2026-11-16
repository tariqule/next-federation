# NF-018: Island rendered a script or hoistable element

## What happened

Island markup contained a `<script>` or a hoistable element (`<title>`, `<meta>`, `<link>`) that was removed.

## Why

Islands are inserted into a host page, so elements that belong to the document head or run code are not carried over.

## How to fix

Move head metadata to the host page and load code through the island bootstrap instead of inline scripts.
