// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.

/**
 * Derives an UpdateKind from the SOVD `*_components` arrays in an update
 * package descriptor. Exactly one of updated/added/removed must be populated
 * to yield a definite kind; otherwise the result is Unknown.
 */

export type UpdateKind = "Update" | "Install" | "Uninstall" | "Unknown";

interface MetaWithComponents {
  updated_components?: string[];
  added_components?: string[];
  removed_components?: string[];
}

export function deriveKind(meta: MetaWithComponents): UpdateKind {
  const upd = (meta.updated_components ?? []).length > 0;
  const add = (meta.added_components ?? []).length > 0;
  const rem = (meta.removed_components ?? []).length > 0;
  const populated = [upd, add, rem].filter(Boolean).length;
  if (populated !== 1) return "Unknown";
  if (upd) return "Update";
  if (add) return "Install";
  return "Uninstall";
}
