// TIN Vault API portal: Scalar configured for first-party use only.
// No proxyUrl (API keys never leave this origin), no external fonts,
// no AI agent. Servers are pinned to this origin so "Try it" is same-origin.
Scalar.createApiReference("#app", {
  url: "/developers/openapi.yaml",
  servers: [{ url: `${location.origin}/api`, description: "TIN Vault" }],
  withDefaultFonts: false,
  agent: { disabled: true },
  authentication: { preferredSecurityScheme: "BearerAuth" },
  metaData: { title: "TIN Vault API" },
  favicon: "/images/favicon-32.png",
  hideDarkModeToggle: false,
  customCss: `
    @font-face { font-family: "Inter"; src: url("/fonts/Inter.var.woff2") format("woff2"); font-weight: 100 900; }
    @font-face { font-family: "Manrope"; src: url("/fonts/manrope-latin.woff2") format("woff2"); font-weight: 400 800; }
    .scalar-app { --scalar-font: "Inter", system-ui, sans-serif; --scalar-color-accent: #ce4a14; }
    .scalar-app h1, .scalar-app h2 { font-family: "Manrope", system-ui, sans-serif; }
    /* Branding: replace Scalar's footer credit with nothing (MIT permits this; the licence notice stays in LICENSES/). */
    .scalar-app a[href="https://www.scalar.com"] { display: none !important; }
  `,
});
