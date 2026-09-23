/** The character set a workspace slug may contain. */
const SLUG_PATTERN = /^[a-z0-9-]{1,63}$/;

/**
 * Reports whether user input can be used as a workspace slug. Validation is
 * client-side only; the server is never queried, so the finder cannot
 * enumerate workspaces.
 *
 * @param slug The raw user input.
 * @returns true when the input is a syntactically valid slug.
 */
export function isValidWorkspaceSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

/**
 * Builds the tenant origin for a workspace slug on this installation,
 * preserving protocol and port so local and preview hosts work.
 *
 * @param slug A valid workspace slug.
 * @returns The tenant origin URL.
 */
export function tenantOriginFor(slug: string): string {
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${slug}.${hostname}${port ? `:${port}` : ""}`;
}
