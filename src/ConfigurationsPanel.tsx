// Copyright 2024-2026 bburda. Apache-2.0 license.

/**
 * ConfigurationsPanel — self-loading SOVD configurations tab.
 *
 * Replaces the inline ConfigurationsTab in EntityBrowserPanel with a
 * self-contained panel that fetches its own data, supports type-aware
 * editors (bool toggle, numeric inputs, string and *_array fields), a
 * per-parameter Reset button, a Reset All button with 207 result display,
 * and a read-only lock.
 */

import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import type { MedkitApiClient } from "./medkit-api";
import type { Parameter, SovdResourceEntityType } from "./types";
import * as S from "./styles";
import type { Theme } from "./styles";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConfigurationsPanelProps {
  client: MedkitApiClient;
  entityType: SovdResourceEntityType;
  entityId: string;
  theme: Theme;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isArrayType(type: string): boolean {
  return type.endsWith("_array");
}

function isBoolType(type: string): boolean {
  return type === "bool";
}

function isNumericType(type: string): boolean {
  return type === "int" || type === "double";
}

function defaultInputValue(param: Parameter): string {
  if (isArrayType(param.type)) {
    return JSON.stringify(param.value ?? []);
  }
  return String(param.value ?? "");
}

// ---------------------------------------------------------------------------
// Sub-component: parameter row
// ---------------------------------------------------------------------------

interface ParamRowProps {
  param: Parameter;
  theme: Theme;
  onSave: (name: string, value: unknown) => Promise<void>;
  onReset: (name: string) => Promise<void>;
}

function ParamRow({ param, theme, onSave, onReset }: ParamRowProps): ReactElement {
  const c = S.colors(theme);
  const [inputValue, setInputValue] = useState<string>(defaultInputValue(param));
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  // Sync input when param value changes (e.g. after reload).
  // Depend on primitives only so an unrelated parent re-render that passes a
  // new `param` object reference (same name/value) does NOT wipe an in-progress
  // edit. `param.type` is included so a type change without a value change is
  // still reflected; the whole `param` object is intentionally NOT a dep.
  useEffect(() => {
    setInputValue(defaultInputValue(param));
    setParseError(null);
  }, [param.name, param.value, param.type]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(async () => {
    setSaving(true);
    setParseError(null);
    try {
      let parsed: unknown;
      if (isArrayType(param.type)) {
        try {
          parsed = JSON.parse(inputValue);
        } catch {
          setParseError("Invalid JSON - must be an array");
          return;
        }
        if (!Array.isArray(parsed)) {
          setParseError("Must be a JSON array");
          return;
        }
      } else if (isNumericType(param.type)) {
        const n = Number(inputValue);
        if (Number.isNaN(n)) {
          setParseError("Must be a number");
          return;
        }
        // Reject non-integer input for an int param (Number("3.9") would
        // otherwise pass silently and serialize to a truncated/null value).
        if (param.type === "int" && !Number.isInteger(n)) {
          setParseError("Must be an integer");
          return;
        }
        parsed = n;
      } else {
        parsed = inputValue;
      }
      await onSave(param.name, parsed);
    } finally {
      setSaving(false);
    }
  }, [param.name, param.type, inputValue, onSave]);

  // Revert the input to the server value (Escape).
  const handleRevert = useCallback(() => {
    setInputValue(defaultInputValue(param));
    setParseError(null);
  }, [param]);

  // Enter triggers save, Escape reverts.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleRevert();
      }
    },
    [handleSave, handleRevert],
  );

  const handleBoolToggle = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(param.name, !param.value);
    } finally {
      setSaving(false);
    }
  }, [param.name, param.value, onSave]);

  const handleReset = useCallback(async () => {
    setResetting(true);
    try {
      await onReset(param.name);
    } finally {
      setResetting(false);
    }
  }, [param.name, onReset]);

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    padding: "5px 0",
    borderBottom: `1px solid ${c.borderLight}`,
  };
  const labelStyle: React.CSSProperties = {
    minWidth: 140,
    maxWidth: 140,
    fontSize: 12,
    fontWeight: 500,
    color: c.text,
    wordBreak: "break-all",
    paddingTop: 4,
  };
  const valueColStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  };
  const badgeStyle: React.CSSProperties = {
    ...S.badge(c.textMuted, c.bgAlt),
    marginRight: 4,
    flexShrink: 0,
  };
  const lockedStyle: React.CSSProperties = {
    fontSize: 11,
    color: c.textMuted,
    fontStyle: "italic",
  };

  let editor: ReactElement;

  if (param.read_only) {
    const readonlyValue = JSON.stringify(param.value);
    editor = (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <code
          style={{ fontSize: 11, color: c.accent }}
          aria-label={`${param.name}: ${readonlyValue} (read-only)`}
        >
          {readonlyValue}
        </code>
        <span style={lockedStyle} title="Read-only" aria-hidden="true">
          (locked)
        </span>
      </div>
    );
  } else if (isBoolType(param.type)) {
    const boolVal = Boolean(param.value);
    editor = (
      <button
        style={{
          ...S.btn(theme, boolVal ? "primary" : "ghost"),
          minWidth: 52,
        }}
        disabled={saving}
        aria-label={`toggle ${param.name}`}
        onClick={() => void handleBoolToggle()}
      >
        {boolVal ? "true" : "false"}
      </button>
    );
  } else if (isArrayType(param.type)) {
    editor = (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
        <div style={{ display: "flex", gap: 4 }}>
          <input
            style={{ ...S.input(theme), flex: 1, ...S.focusRing(theme, inputFocused) }}
            value={inputValue}
            aria-label={`value for ${param.name}`}
            aria-invalid={parseError != null}
            onChange={(e) => {
              setInputValue(e.target.value);
              setParseError(null);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
          />
          <button
            style={S.btn(theme)}
            disabled={saving}
            aria-label={`save ${param.name}`}
            onClick={() => void handleSave()}
          >
            Save
          </button>
        </div>
        {parseError != null && (
          <span role="alert" style={{ fontSize: 11, color: c.critical }}>
            {parseError}
          </span>
        )}
      </div>
    );
  } else {
    // string, int, double
    editor = (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
        <div style={{ display: "flex", gap: 4 }}>
          <input
            style={{ ...S.input(theme), flex: 1, ...S.focusRing(theme, inputFocused) }}
            // Numeric params use a text input with a decimal inputMode (not
            // type="number") so the component owns validation: a number input
            // silently swallows bad keystrokes and would let the NaN/integer
            // guards never fire. Matches web_ui's parse-on-submit approach.
            type="text"
            inputMode={isNumericType(param.type) ? "decimal" : undefined}
            value={inputValue}
            aria-label={`value for ${param.name}`}
            aria-invalid={parseError != null}
            onChange={(e) => {
              setInputValue(e.target.value);
              setParseError(null);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
          />
          <button
            style={S.btn(theme)}
            disabled={saving}
            aria-label={`save ${param.name}`}
            onClick={() => void handleSave()}
          >
            Save
          </button>
        </div>
        {parseError != null && (
          <span role="alert" style={{ fontSize: 11, color: c.critical }}>
            {parseError}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={rowStyle}>
      <div style={labelStyle}>{param.name}</div>
      <div style={valueColStyle}>
        {editor}
      </div>
      <span style={badgeStyle}>{param.type}</span>
      {!param.read_only && (
        <button
          style={S.btn(theme, "ghost")}
          disabled={resetting}
          aria-label={`reset ${param.name}`}
          onClick={() => void handleReset()}
        >
          Reset
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function ConfigurationsPanel({
  client,
  entityType,
  entityId,
  theme,
}: ConfigurationsPanelProps): ReactElement {
  const c = S.colors(theme);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [parameters, setParameters] = useState<Parameter[]>([]);
  const [resetAllStatus, setResetAllStatus] = useState<string | null>(null);
  const [resettingAll, setResettingAll] = useState(false);

  // Guards setState after awaits: an entity switch mid-save/reset must not
  // write state into an unmounted component.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.listConfigurations(entityType, entityId);
      if (!mountedRef.current) return;
      setParameters(result.parameters);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load configurations");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [client, entityType, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(
    async (name: string, value: unknown) => {
      await client.setConfiguration(entityType, entityId, name, value);
      if (!mountedRef.current) return;
      await load();
    },
    [client, entityType, entityId, load],
  );

  const handleReset = useCallback(
    async (name: string) => {
      await client.resetConfiguration(entityType, entityId, name);
      if (!mountedRef.current) return;
      await load();
    },
    [client, entityType, entityId, load],
  );

  const handleResetAll = useCallback(async () => {
    setResettingAll(true);
    setResetAllStatus(null);
    try {
      const result = await client.resetAllConfigurations(entityType, entityId);
      if (!mountedRef.current) return;
      if (result != null) {
        setResetAllStatus(`Reset ${result.reset_count}, ${result.failed_count} failed`);
      }
      await load();
    } catch (err) {
      if (!mountedRef.current) return;
      setResetAllStatus(err instanceof Error ? err.message : "Reset all failed");
    } finally {
      if (mountedRef.current) setResettingAll(false);
    }
  }, [client, entityType, entityId, load]);

  if (loading) {
    return (
      <div
        role="status"
        aria-label="loading configurations"
        style={{ color: c.textMuted, padding: 12 }}
      >
        Loading...
      </div>
    );
  }

  if (error != null) {
    return <div style={S.errorBox(theme)}>{error}</div>;
  }

  if (parameters.length === 0) {
    return <div style={S.emptyState(theme)}>No configurations</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6, gap: 6, alignItems: "center" }}>
        {resetAllStatus != null && (
          <span
            role="status"
            aria-live="polite"
            style={{ fontSize: 12, color: c.textMuted }}
          >
            {resetAllStatus}
          </span>
        )}
        <button
          style={S.btn(theme, "ghost")}
          disabled={loading}
          aria-label="refresh configurations"
          onClick={() => void load()}
        >
          Refresh
        </button>
        <button
          style={S.btn(theme, "ghost")}
          disabled={resettingAll}
          aria-label="reset all configurations"
          onClick={() => void handleResetAll()}
        >
          Reset All
        </button>
      </div>
      <div>
        {parameters.map((p) => (
          <ParamRow
            key={p.name}
            param={p}
            theme={theme}
            onSave={handleSave}
            onReset={handleReset}
          />
        ))}
      </div>
    </div>
  );
}
