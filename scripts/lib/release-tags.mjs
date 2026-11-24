// Which `<name>@<version>` release tags to create (scripts/release-tags.mjs).
// Named from package.json: `changeset publish` names its tags from the registry,
// which can still show the previous version while npm holds the new one as
// staged, so its tags were wrong or missing (0.2.0, 0.2.1).

/**
 * @param {Array<{ name?: string, version?: string, private?: boolean }>} manifests
 * @param {Set<string>} remoteTags tag names that already exist on the remote
 * @returns {{ create: string[], existing: string[] }}
 */
export function planReleaseTags(manifests, remoteTags) {
  const wanted = manifests
    .filter((m) => !m.private && m.name && m.version)
    .map((m) => `${m.name}@${m.version}`)
    .sort()
  return {
    create: wanted.filter((tag) => !remoteTags.has(tag)),
    existing: wanted.filter((tag) => remoteTags.has(tag)),
  }
}
