---
'@next-federation/protocol': patch
'@next-federation/island': patch
'@next-federation/vite': patch
'@next-federation/react': patch
---

Code-scanning fixes: trailing slashes on a remote's base URL and on `outDir` are trimmed in linear time (the old regex was quadratic on long slash runs). The island share scope refuses a lib name or version that names an `Object.prototype` member (such as `__proto__`) instead of writing to the prototype; that build uses its own copies. Generated Vite modules escape `<`, `>`, U+2028 and U+2029 in their literals. `IslandMount` documents its HTML trust boundary.
