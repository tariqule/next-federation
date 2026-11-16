---
'@next-federation/protocol': minor
'@next-federation/core': minor
'@next-federation/react': minor
'@next-federation/vite': minor
---

Mode A stylesheets and modulepreload: the components build descriptor lists each exposed module's stylesheets and JS chunks (signed with the rest of the descriptor). Server-rendered remote components render their stylesheets as React stylesheet resources and modulepreload the remote entry and chunks; components first mounted in the browser insert their stylesheets with `preinit`, so a stalled stylesheet never holds a navigation.

**Upgrade hosts before remotes:** older hosts compute the descriptor digest without `assets`, so they refuse new remote builds with `NF-027` (rendered in the browser only, unstyled on the server).
