# Documentation style

How to write a page in `docs/`. The pages follow the [Next.js docs](https://nextjs.org/docs). The
model page is [Getting Started: App Router](../guides/getting-started-app-router.mdx): copy its
shape. This page is Markdown on purpose, so the examples below show the source exactly as you write
it in an `.mdx` page.

## Files

- `docs/**/*.mdx` is a guide, reference or index page. It uses the components below and its own
  frontmatter.
- Package READMEs stay plain Markdown, because npm renders them. They do not use components.
- `docs/errors/<slug>.md` stays `.md` (see [Error pages](#error-pages)), as does
  `docs/protocol/v1.md`. Every other page is `.mdx`.
- `docs/guides/remote-components.md`, `sharing-components-from-a-next-app.md` and `limits.md` are
  stubs that point at the new pages. Released versions of the library link to those paths, so keep
  them. They are not synced to the site. Neither are `docs/maintainers/*`.
- `docs-site/scripts/sync-content.mjs` lists every page and its URL. Add a page there, and in the
  sidebar order it writes (`meta.json`), when you create one.
- Link to the file, with its extension: `[Caching](caching.mdx)`, `[App Router](getting-started-app-router.mdx)`.
  The same link works on GitHub and on the site. Do the same in `href` on a `<Card>`.

## Rules

1. Frontmatter has a `title` and a one-sentence `description`. The page has no `# ` heading: the
   site renders the title.
2. The first paragraph says in one sentence what the page lets you do.
3. H2s are tasks ("Add an island to a page", "Show per-user content"), not topics.
4. A short paragraph is three sentences at most. A guide is a task flow: edge cases, security
   internals and version caveats go to a reference page (Limits, Architecture, a package README)
   that the guide links to. Move detail there, never delete it.
5. Steps use `<Steps>`. Each step has a short sentence and a code block titled with its file path.
6. Install commands are an `npm` code block: the site turns it into pnpm, npm, yarn and bun tabs.
7. A "Good to know" aside is a `<Callout>` that starts with a bold **Good to know:**. Keep it to one
   to three sentences. Use `type="warn"` only for a cost or a risk.
8. A table is for a real comparison, not for a list.
9. The page ends with "Next steps": a `<Cards>` of two to four links.
10. Use the same terms throughout: islands, remote components, host, remote, build, descriptor,
    envelope. Every code sample matches a real export and a test fixture.
11. No tool attribution and no personal names in content.

## Components

Leave a blank line after each opening component tag and before each closing one, or the Markdown
inside is not parsed.

### Steps and code block titles

````mdx
<Steps>
<Step>

### Wrap your Next config

Wrap `next.config.ts` with `withNextFederation`.

```ts title="next.config.ts"
export default withNextFederation({})
```

</Step>
</Steps>
````

### Install commands

````mdx
```npm
npm install @next-federation/core
```
````

### Callout

```mdx
<Callout>
  **Good to know:** A private island makes the route dynamic without `cacheComponents`.
</Callout>
```

### Tabs

Use tabs for alternatives the reader picks one of (two bundlers, two routers), not for install
commands.

````mdx
<Tabs items={['Vite', 'Rspack']}>
<Tab value="Vite">

Use `nextFederationComponents`.

</Tab>
<Tab value="Rspack">

Use `nf-describe`.

</Tab>
</Tabs>
````

### Cards

```mdx
## Next steps

<Cards>
  <Card title="Caching" href="caching.mdx">
    Static pages, ISR and cacheComponents with islands.
  </Card>
</Cards>
```

## Error pages

The library builds the link in every error message from `DOCS_BASE` in `@next-federation/sdk`
(`packages/sdk/src/error-codes.ts`): `https://github.com/tariqule/next-federation/blob/main/docs/errors/<slug>.md`.
A page renamed to `.mdx` breaks every released version's links. Error pages therefore stay `.md`,
with the layout Why This Error Occurred / Possible Ways to Fix It / Useful Links, until a library
change makes the builder resolve the new extension and the old URLs keep working.
`pnpm check:error-docs` fails on an `.mdx` error page. `docs/errors/index.mdx` is the one `.mdx`
there: the section index.

## Page map

The sidebar, in order. `docs-site/scripts/sync-content.mjs` is the source of truth: it lists every
page, its URL and the sidebar order.

- **Welcome**: `index.mdx`, `live-demo.mdx`.
- **Getting Started**: `getting-started-app-router.mdx`, `getting-started-pages-router.mdx`,
  `getting-started-spa.mdx`. Each is the task flow only, and links to Limits and Caching for detail.
- **Guides**: `writing-an-island-remote`, `server-actions` (+ `server-actions-reference`),
  `caching` (+ `caching-reference`), `identity` (+ `identity-reference`), `csp`,
  `migrating-from-nextjs-mf`. A `-reference` page holds the detail its guide links to.
- **Remote Components** (`guides/remote-components/`): `overview`, `vite-remote`, `rspack-remote`,
  `host-configuration`, `stylesheets`, `sharing-modules`, `links`, `reference`, `preload-and-events`, `security`, `types`,
  `sharing-from-a-next-app`.
- **Deployment**: `deployment` (overview), `self-hosted-skew`, `deploying-a-remote-on-vercel`.
- **API Reference**: one page per package, from its README (`api/<package>`).
- **Errors**: `errors/index.mdx`, then one page per code.
- **Architecture**: `architecture.mdx`, `protocol/v1.md` and Limits (`guides/limits.mdx`, shown
  here but served at `/docs/guides/limits`).

## Word budgets

Count prose with `node scripts/docs-prose-words.mjs <file|dir>...` (also `pnpm docs:words`). It
strips frontmatter, code blocks, component tags, link URLs and table pipes. A page over its budget
is split, or its detail moves to a reference page.

| Page type                                                 | Budget (prose words) |
| --------------------------------------------------------- | -------------------- |
| Getting Started                                           | 450                  |
| Guide (task flow)                                         | 700                  |
| Remote Components guide                                   | 600                  |
| Deployment guide                                          | 600                  |
| Error page                                                | 170                  |
| `caching-reference`                                       | 1200                 |
| `identity-reference`                                      | 1000                 |
| `server-actions-reference`                                | 800                  |
| `remote-components/reference`, `preload-and-events`, `security` and `types` | 1500 |
| `architecture`                                            | 1200                 |
| `limits`                                                  | 1800                 |

The index, live demo, protocol spec and package READMEs have no budget.

## Checklist

- [ ] `.mdx` page with `title` and `description` frontmatter, no `# ` heading.
- [ ] One-sentence intro, task H2s, paragraphs of three sentences at most.
- [ ] Steps with titled code blocks; install commands as an `npm` block.
- [ ] Detail moved to a reference page and linked, not deleted.
- [ ] Every export, option and error code in the page exists in `packages/*/src` or a fixture.
- [ ] Ends with "Next steps" cards.
- [ ] Within the word budget (`node scripts/docs-prose-words.mjs <file>`).
- [ ] Links point at files with extensions; inbound links to a renamed page updated
      (`grep -rn <old-name> .` outside `node_modules`).
- [ ] `pnpm lint:docs`, `pnpm format:check`, `pnpm --filter docs-site build` and
      `pnpm --filter docs-site check:links` pass.
