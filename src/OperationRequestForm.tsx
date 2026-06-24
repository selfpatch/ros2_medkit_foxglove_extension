// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// Controlled form that renders an editable request body from a TopicSchema
// field-model (src/schema-utils.ts). Mirrors the UX of web_ui's
// SchemaFormField (ros2_medkit_web_ui/src/components/SchemaFormField.tsx)
// but uses inline styles from src/styles.ts instead of shadcn/Tailwind.

import { type CSSProperties, useEffect, useState } from "react";

import { getDefaultValue, isBooleanType, isNumericType, isPrimitiveType } from "./schema-utils";
import type { SchemaFieldType, TopicSchema } from "./schema-utils";
import * as S from "./styles";
import type { Theme } from "./styles";

// Integer types that need parseInt (vs parseFloat for float/double).
// Mirrors web_ui SchemaFormField.tsx line 32.
const INTEGER_TYPES = [
    "int8", "uint8", "int16", "uint16", "int32", "uint32",
    "int64", "uint64", "byte", "char",
];

// =============================================================================
// NumericField
// Mirrors web_ui NumericField (SchemaFormField.tsx lines 34-92):
//   - rawInput local state for intermediate typing ("-", ".", "")
//   - useEffect syncs rawInput only when value changes externally, skipping
//     intermediate states (lines 44-51)
//   - onChange: skips parent update for intermediates; parses int/float;
//     clamps unsigned to 0 (lines 60-73)
//   - onBlur: commits final value, normalises "" / "-" / "." to 0 (lines 74-86)
// =============================================================================

interface NumericFieldProps {
    id: string;
    schemaType: string;
    value: unknown;
    onChange: (value: number) => void;
    theme: Theme;
}

function NumericField({ id, schemaType, value, onChange, theme }: NumericFieldProps): JSX.Element {
    const lower = schemaType.toLowerCase();
    const isInteger = INTEGER_TYPES.includes(lower);
    const isUnsigned = lower.startsWith("uint") || lower === "byte";

    // Mirrors web_ui line 39: initial raw state from value prop.
    const [rawInput, setRawInput] = useState<string>(
        value === undefined || value === null ? "0" : String(value),
    );

    // Mirrors web_ui lines 44-51: sync when external value changes, but skip
    // intermediate typing states so the user's partial input is not reset.
    useEffect(() => {
        const expected = value === undefined || value === null ? "0" : String(value);
        if (rawInput !== "-" && rawInput !== "" && rawInput !== "." && rawInput !== expected) {
            setRawInput(expected);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const inputStyle: CSSProperties = {
        ...S.input(theme),
        width: 120,
        fontFamily: "ui-monospace, monospace",
    };

    return (
        <input
            id={id}
            type="text"
            inputMode="decimal"
            value={rawInput}
            style={inputStyle}
            aria-label={id}
            onChange={(e) => {
                const newRaw = e.target.value;
                setRawInput(newRaw);

                // Mirrors web_ui lines 65-67: allow intermediate states.
                if (newRaw === "" || newRaw === "-" || newRaw === ".") {
                    return;
                }

                // Mirrors web_ui lines 69-72: parse, skip NaN, clamp unsigned.
                let val = isInteger ? parseInt(newRaw, 10) : parseFloat(newRaw);
                if (isNaN(val)) return;
                if (isUnsigned && val < 0) val = 0;
                onChange(val);
            }}
            onBlur={() => {
                // Mirrors web_ui lines 75-86: commit on blur, normalise intermediates.
                let val: number;
                if (rawInput === "" || rawInput === "-" || rawInput === ".") {
                    val = 0;
                } else {
                    val = isInteger ? parseInt(rawInput, 10) : parseFloat(rawInput);
                    if (isNaN(val)) val = 0;
                    if (isUnsigned && val < 0) val = 0;
                }
                setRawInput(String(val));
                onChange(val);
            }}
        />
    );
}

// =============================================================================
// FieldRow - label + control pair with consistent layout
// =============================================================================

interface FieldRowProps {
    fieldId: string;
    label: string;
    depth: number;
    theme: Theme;
    children: React.ReactNode;
    typeHint?: string;
    /**
     * Render the label as a plain <span> instead of a <label htmlFor>. Used for
     * the boolean toggle: its control is a role="switch" <button> whose
     * accessible name comes from its own aria-label, so a <label htmlFor> would
     * be redundant/inert. A <span> keeps the visual label without a broken
     * for-association.
     */
    labelAsSpan?: boolean;
}

function FieldRow({
    fieldId,
    label,
    depth,
    theme,
    children,
    typeHint,
    labelAsSpan,
}: FieldRowProps): JSX.Element {
    const c = S.colors(theme);
    const labelStyle: CSSProperties = {
        minWidth: 120,
        fontSize: 12,
        fontWeight: 500,
        color: c.text,
        flexShrink: 0,
    };
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginLeft: depth * 16,
                minHeight: 28,
            }}
        >
            {labelAsSpan ? (
                <span style={labelStyle}>{label}</span>
            ) : (
                <label htmlFor={fieldId} style={labelStyle}>
                    {label}
                </label>
            )}
            {children}
            {typeHint !== undefined && (
                <span style={{ fontSize: 11, color: c.textMuted, flexShrink: 0 }}>{typeHint}</span>
            )}
        </div>
    );
}

// =============================================================================
// SchemaField - single field renderer (recursive for objects/arrays)
// Mirrors web_ui SchemaFormField (lines 97-273).
// =============================================================================

interface SchemaFieldProps {
    /** Field name / label shown to the user. */
    name: string;
    /** Path prefix for stable element IDs (dots separate segments). */
    idPrefix: string;
    schema: SchemaFieldType;
    value: unknown;
    onChange: (value: unknown) => void;
    depth: number;
    theme: Theme;
}

function SchemaField({
    name,
    idPrefix,
    schema,
    value,
    onChange,
    depth,
    theme,
}: SchemaFieldProps): JSX.Element {
    const c = S.colors(theme);
    const fieldId = idPrefix ? `${idPrefix}.${name}` : name;
    const [expanded, setExpanded] = useState(true);

    // ----- Array type (mirrors web_ui lines 102-168) -----
    if (schema.type === "array" && schema.items) {
        const arrayValue = Array.isArray(value) ? value : [];
        const itemSchema = schema.items;

        const addItem = () => onChange([...arrayValue, getDefaultValue(itemSchema)]);
        const removeItem = (idx: number) => onChange(arrayValue.filter((_, i) => i !== idx));
        const updateItem = (idx: number, v: unknown) => {
            const next = [...arrayValue];
            next[idx] = v;
            onChange(next);
        };

        const headerStyle: CSSProperties = {
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginLeft: depth * 16,
        };

        return (
            <div>
                <div style={headerStyle}>
                    <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`}
                        style={{
                            ...S.btn(theme, "ghost"),
                            padding: "2px 4px",
                            fontSize: 11,
                            minWidth: 20,
                        }}
                        onClick={() => setExpanded((x) => !x)}
                    >
                        {expanded ? "-" : "+"}
                    </button>
                    <span style={{ fontSize: 12, fontWeight: 500, color: c.text }}>{name}</span>
                    <span style={{ fontSize: 11, color: c.textMuted }}>
                        array[{arrayValue.length}]
                    </span>
                    <button
                        type="button"
                        aria-label={`Add item to ${name}`}
                        style={{ ...S.btn(theme, "primary"), padding: "2px 8px", fontSize: 11 }}
                        onClick={addItem}
                    >
                        Add
                    </button>
                </div>
                {expanded && arrayValue.length > 0 && (
                    <div
                        style={{
                            marginLeft: depth * 16 + 16,
                            borderLeft: `2px solid ${c.borderLight}`,
                            paddingLeft: 8,
                            marginTop: 4,
                        }}
                    >
                        {arrayValue.map((item, idx) => (
                            <div
                                key={`${fieldId}[${idx}]`}
                                style={{ display: "flex", alignItems: "flex-start", gap: 4, marginBottom: 4 }}
                            >
                                <div style={{ flex: 1 }}>
                                    <SchemaField
                                        name={`[${idx}]`}
                                        idPrefix={fieldId}
                                        schema={itemSchema}
                                        value={item}
                                        onChange={(v) => updateItem(idx, v)}
                                        depth={0}
                                        theme={theme}
                                    />
                                </div>
                                <button
                                    type="button"
                                    aria-label={`Remove item ${idx} from ${name}`}
                                    style={{ ...S.btn(theme, "danger"), padding: "2px 6px", fontSize: 11, flexShrink: 0 }}
                                    onClick={() => removeItem(idx)}
                                >
                                    X
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // ----- Nested object type (mirrors web_ui lines 171-209) -----
    if (schema.fields) {
        const objectValue =
            typeof value === "object" && value !== null && !Array.isArray(value)
                ? (value as Record<string, unknown>)
                : {};

        const updateNested = (key: string, v: unknown) =>
            onChange({ ...objectValue, [key]: v });

        const headerStyle: CSSProperties = {
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginLeft: depth * 16,
        };

        return (
            <div>
                <div style={headerStyle}>
                    <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`}
                        style={{
                            ...S.btn(theme, "ghost"),
                            padding: "2px 4px",
                            fontSize: 11,
                            minWidth: 20,
                        }}
                        onClick={() => setExpanded((x) => !x)}
                    >
                        {expanded ? "-" : "+"}
                    </button>
                    <span style={{ fontSize: 12, fontWeight: 500, color: c.text }}>{name}</span>
                    <span style={{ fontSize: 11, color: c.textMuted }}>{schema.type}</span>
                </div>
                {expanded && (
                    <div
                        style={{
                            marginLeft: depth * 16 + 16,
                            borderLeft: `2px solid ${c.borderLight}`,
                            paddingLeft: 8,
                            marginTop: 4,
                        }}
                    >
                        {Object.entries(schema.fields).map(([key, fieldSchema]) => (
                            <div key={key} style={{ marginBottom: 6 }}>
                                <SchemaField
                                    name={key}
                                    idPrefix={fieldId}
                                    schema={fieldSchema}
                                    value={objectValue[key]}
                                    onChange={(v) => updateNested(key, v)}
                                    depth={0}
                                    theme={theme}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // ----- Primitive types (mirrors web_ui lines 211-273) -----
    if (isPrimitiveType(schema.type)) {
        // Boolean toggle (mirrors web_ui lines 214-227).
        // Rendered as a button showing "true"/"false" for clarity and
        // keyboard accessibility (a11y preference over raw checkbox per brief).
        if (isBooleanType(schema.type)) {
            const boolVal = Boolean(value);
            const toggleStyle: CSSProperties = {
                ...S.btn(theme, boolVal ? "primary" : "ghost"),
                padding: "2px 10px",
                fontSize: 12,
                minWidth: 52,
            };
            return (
                <FieldRow
                    fieldId={fieldId}
                    label={name}
                    depth={depth}
                    theme={theme}
                    typeHint={schema.type}
                    labelAsSpan
                >
                    <button
                        id={fieldId}
                        type="button"
                        role="switch"
                        aria-checked={boolVal}
                        aria-label={name}
                        style={toggleStyle}
                        onClick={() => onChange(!boolVal)}
                    >
                        {boolVal ? "true" : "false"}
                    </button>
                </FieldRow>
            );
        }

        // Numeric field (mirrors web_ui lines 229-234).
        if (isNumericType(schema.type)) {
            return (
                <FieldRow fieldId={fieldId} label={name} depth={depth} theme={theme} typeHint={schema.type}>
                    <NumericField
                        id={fieldId}
                        schemaType={schema.type}
                        value={value}
                        onChange={onChange as (v: number) => void}
                        theme={theme}
                    />
                </FieldRow>
            );
        }

        // String field (mirrors web_ui lines 237-249).
        return (
            <FieldRow fieldId={fieldId} label={name} depth={depth} theme={theme} typeHint={schema.type}>
                <input
                    id={fieldId}
                    type="text"
                    value={String(value ?? "")}
                    maxLength={schema.max_length}
                    aria-label={name}
                    style={{ ...S.input(theme), flex: 1, fontFamily: "ui-monospace, monospace" }}
                    onChange={(e) => onChange(e.target.value)}
                />
            </FieldRow>
        );
    }

    // ----- Fallback: unknown / complex type as JSON (mirrors web_ui lines 252-273) -----
    return (
        <FieldRow fieldId={fieldId} label={name} depth={depth} theme={theme} typeHint={schema.type}>
            <input
                id={fieldId}
                type="text"
                value={JSON.stringify(value ?? null)}
                placeholder="JSON value"
                aria-label={name}
                style={{ ...S.input(theme), flex: 1, fontFamily: "ui-monospace, monospace" }}
                onChange={(e) => {
                    try {
                        onChange(JSON.parse(e.target.value));
                    } catch {
                        onChange(e.target.value);
                    }
                }}
            />
        </FieldRow>
    );
}

// =============================================================================
// OperationRequestForm - public API
// =============================================================================

export interface OperationRequestFormProps {
    /** Schema produced by T1a (schema-utils.ts). */
    schema: TopicSchema;
    /** Current form value (controlled). */
    value: Record<string, unknown>;
    /** Called with the full updated object whenever any field changes. */
    onChange: (next: Record<string, unknown>) => void;
    /** Color scheme (from useColorSchemeTheme or "dark" default). */
    theme: Theme;
}

/**
 * Controlled form that renders an editable request body from a TopicSchema.
 * Behavior mirrors web_ui SchemaFormField/SchemaForm (SchemaFormField.tsx
 * lines 278-302); presentation via inline styles from src/styles.ts.
 *
 * Does NOT hold the authoritative value (pure controlled); the only local
 * state is the transient numeric-typing buffer inside NumericField.
 */
export function OperationRequestForm({
    schema,
    value,
    onChange,
    theme,
}: OperationRequestFormProps): JSX.Element {
    const updateField = (fieldName: string, fieldValue: unknown) =>
        onChange({ ...value, [fieldName]: fieldValue });

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(schema).map(([fieldName, fieldSchema]) => (
                <SchemaField
                    key={fieldName}
                    name={fieldName}
                    idPrefix=""
                    schema={fieldSchema}
                    value={value[fieldName]}
                    onChange={(v) => updateField(fieldName, v)}
                    depth={0}
                    theme={theme}
                />
            ))}
        </div>
    );
}
