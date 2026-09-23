/**
 * Design tokens for the TIN Vault Launchpad, mirroring
 * design/tin-vault-launchpad/base.css. One accent (TIN orange), navy
 * surfaces, locked radii: 10px controls, 14px surfaces.
 */
export const vaultTheme = {
  navy: "#35496b",
  navy600: "#27395a",
  navy700: "#1b2c45",
  navy800: "#122036",
  navy900: "#0c1624",
  orange: "#e8591f",
  orange600: "#ce4a14",
  bg: "#f5f8fa",
  card: "#ffffff",
  line: "#e2e8ef",
  ink: "#1d2b3f",
  muted: "#5c6b80",
  lineDark: "rgba(255, 255, 255, 0.14)",
  inkDark: "#e9eef4",
  mutedDark: "#97a6ba",
  radiusSurface: "14px",
  radiusCtrl: "10px",
  shadowCard:
    "0 1px 2px rgba(16, 32, 54, 0.05), 0 12px 32px rgba(16, 32, 54, 0.09)",
  fontDisplay: '"Manrope", "Segoe UI", system-ui, -apple-system, sans-serif',
  fontBody: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
  fontMono: '"JetBrains Mono", ui-monospace, "SF Mono", monospace',
} as const;

export type VaultTheme = typeof vaultTheme;
