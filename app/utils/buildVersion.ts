/**
 * Formats the build revision that a deployment reports, for display in the UI.
 *
 * The server exposes the commit an image was built from as `env.VERSION`. A full
 * git SHA is shortened so a version stamp stays compact, while any other version
 * string (for example the value Heroku supplies through `SOURCE_VERSION`) is
 * returned unchanged.
 *
 * @param value - the build version reported by the server, if any.
 * @returns the display form of the revision, or undefined when there is none.
 */
export function shortRevision(value?: string) {
  if (!value) {
    return undefined;
  }

  return /^[0-9a-f]{7,40}$/i.test(value) ? value.slice(0, 7) : value;
}
