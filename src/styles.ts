// Copyright 2024–2026 Selfpatch GmbH. Apache-2.0 license.

/**
 * Shared inline-style helpers for Foxglove panels.
 * Foxglove extensions cannot import external CSS frameworks,
 * so everything is inline React styles keyed off the color scheme.
 */

import type { CSSProperties } from "react";

export type Theme = "dark" | "light";

export function colors(theme: Theme) {
  const dark = theme === "dark";
  return {
    bg: dark ? "#1e1e1e" : "#fafafa",
    bgAlt: dark ? "#262626" : "#f0f0f0",
    bgHover: dark ? "#333" : "#e8e8e8",
    bgError: dark ? "#2a1a1a" : "#fff0f0",
    bgWarn: dark ? "#2a2a1a" : "#fffbe6",
    bgSuccess: dark ? "#1a2a1a" : "#f0fff0",
    bgCard: dark ? "#252525" : "#fff",
    text: dark ? "#e0e0e0" : "#1a1a1a",
    textMuted: dark ? "#999" : "#666",
    textInvert: dark ? "#1a1a1a" : "#fff",
    border: dark ? "#444" : "#ddd",
    borderLight: dark ? "#333" : "#eee",
    accent: "#3b82f6",
    accentHover: "#2563eb",
    critical: "#ef4444",
    error: "#f87171",
    warning: "#f59e0b",
    success: "#22c55e",
    info: "#60a5fa",
  };
}

export function panelRoot(theme: Theme): CSSProperties {
  const c = colors(theme);
  return {
    padding: 12,
    height: "100%",
    overflow: "auto",
    background: c.bg,
    color: c.text,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 13,
    lineHeight: 1.5,
  };
}

export function heading(theme: Theme): CSSProperties {
  return {
    margin: "0 0 8px",
    fontSize: 15,
    fontWeight: 600,
    color: colors(theme).text,
  };
}

export function subheading(theme: Theme): CSSProperties {
  return {
    margin: "12px 0 6px",
    fontSize: 13,
    fontWeight: 600,
    color: colors(theme).text,
  };
}

export function card(theme: Theme): CSSProperties {
  const c = colors(theme);
  return {
    background: c.bgCard,
    border: `1px solid ${c.borderLight}`,
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  };
}

export function badge(color: string, bg: string): CSSProperties {
  return {
    display: "inline-block",
    padding: "1px 6px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    color,
    background: bg,
    lineHeight: "18px",
  };
}

export function btn(theme: Theme, variant: "primary" | "ghost" | "danger" = "primary"): CSSProperties {
  const c = colors(theme);
  const base: CSSProperties = {
    border: "none",
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  };
  if (variant === "primary") {
    return { ...base, background: c.accent, color: "#fff" };
  }
  if (variant === "danger") {
    return { ...base, background: c.critical, color: "#fff" };
  }
  return { ...base, background: "transparent", color: c.textMuted, border: `1px solid ${c.border}` };
}

export function input(theme: Theme): CSSProperties {
  const c = colors(theme);
  return {
    width: "100%",
    padding: "4px 8px",
    border: `1px solid ${c.border}`,
    borderRadius: 4,
    background: c.bgAlt,
    color: c.text,
    fontSize: 12,
    outline: "none",
    boxSizing: "border-box",
  };
}

export function table(theme: Theme): CSSProperties {
  return {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 12,
  };
}

export function th(theme: Theme): CSSProperties {
  const c = colors(theme);
  return {
    textAlign: "left" as const,
    borderBottom: `1px solid ${c.border}`,
    padding: "4px 6px",
    fontWeight: 600,
    fontSize: 11,
    color: c.textMuted,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  };
}

export function td(theme: Theme): CSSProperties {
  const c = colors(theme);
  return {
    padding: "4px 6px",
    borderBottom: `1px solid ${c.borderLight}`,
  };
}

export function errorBox(theme: Theme): CSSProperties {
  const c = colors(theme);
  return {
    color: c.critical,
    padding: 8,
    border: `1px solid ${c.critical}`,
    borderRadius: 4,
    marginBottom: 8,
    fontSize: 12,
    background: c.bgError,
  };
}

export function emptyState(theme: Theme): CSSProperties {
  const c = colors(theme);
  return {
    textAlign: "center" as const,
    padding: 24,
    color: c.textMuted,
    fontSize: 13,
  };
}

export function severityColor(severity: string, theme: Theme): string {
  const c = colors(theme);
  switch (severity) {
    case "critical": return c.critical;
    case "error": return c.error;
    case "warning": return c.warning;
    case "info": return c.info;
    default: return c.textMuted;
  }
}
