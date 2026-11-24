# Documentation style

How to write a page in `docs/`. The pages follow the [Next.js docs](https://nextjs.org/docs). The
model page is [Getting Started: App Router](../guides/getting-started-app-router.mdx): copy its
shape. This page is Markdown on purpose, so the examples below show the source exactly as you write
it in an `.mdx` page.

## Files

- `docs/**/*.mdx` is a guide, reference or index page. It uses the components below and its own
  frontmatter.
- Package READMEs stay plain Markdown, because npm renders them. They do not use components.
- `docs/errors/<slug>.md` stays `.md` (see [Error pages](#error-pages)), as do `docs/architecture.md`
  and `docs/protocol/v1.md` until their phase converts them.
- `docs-site/scripts/sync-content.mjs` lists every page and its URL. Add a page there, and in the
  sidebar order it writes (`meta.json`), when you create one.
- Link to the file, with its extension: `[Caching](caching.md)`, `[App Router](getting-started-app-router.mdx)`.
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
  <Card title="Caching" href="caching.md">
    Static pages, ISR and cacheComponents with islands.
  </Card>
</Cards>
```

## Error pages

The library builds the link in every error message from `DOCS_BASE` in `@next-federation/sdk`
(`packages/sdk/src/error-codes.ts`): `https://github.com/tariqule/next-federation/blob/main/docs/errors/<slug>.md`.
A page renamed to `.mdx` breaks every released version's links. Error pages therefore stay `.md`,
with the existing What happened / Why / How to fix layout, until a library change makes the builder
resolve the new extension and the old URLs keep working. `pnpm check:error-docs` fails on an
`.mdx` error page. `docs/errors/index.mdx` is the one `.mdx` there: the section index.

## Page map

Target sidebar, in order. A page marked "split" is long today: a later phase turns it into the pages
listed under it. Nothing is deleted, only moved.

- **Welcome**: `index.mdx`. Live demo.
- **Getting Started**: App Router (done), Pages Router, SPA. Each is the task flow only, and links
  to Limits and Caching for detail.
- **Guides**: Writing an island remote, Server Actions in islands, Caching, Identity, CSP,
  Migrating from nextjs-mf.
- **Remote Components**: `remote-components.md` (10.8k words) is split into:
  - Overview: what they are, islands or remote components, requirements (from the first three
    sections).
  - Build a components remote with Vite: create-vite, "Remote: build it", React versions.
  - Build a components remote with Rspack or webpack (`nf-describe`).
  - Configure the host: "Host: configure the remote", Types, client-only Next.js apps.
  - Sharing stylesheets and modules, links that work in every host (one guide each).
  - Reference: Integrity (server rendering), runtime behaviour, devtools, requirements and
    limits, CSP.
  - Sharing components from a Next.js app (exists).
- **Deployment**: Overview, self-hosted skew, deploying a remote on Vercel.
- **API Reference**: one page per package, from its README (`api/<package>`).
- **Errors**: `errors/index.mdx`, then one page per code.
- **Architecture**: Architecture, Island protocol v1. Add **Limits** (now `guides/limits.md`) here
  as a reference page, split into Supported versions, Islands, Remote components, Cost and Trust.

## Checklist

- [ ] `.mdx` page with `title` and `description` frontmatter, no `# ` heading.
- [ ] One-sentence intro, task H2s, paragraphs of three sentences at most.
- [ ] Steps with titled code blocks; install commands as an `npm` block.
- [ ] Detail moved to a reference page and linked, not deleted.
- [ ] Every export, option and error code in the page exists in `packages/*/src` or a fixture.
- [ ] Ends with "Next steps" cards.
- [ ] Links point at files with extensions; inbound links to a renamed page updated
      (`grep -rn <old-name> .` outside `node_modules`).
- [ ] `pnpm lint:docs`, `pnpm format:check`, `pnpm --filter docs-site build` and
      `pnpm --filter docs-site check:links` pass.
