// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.
//
// JSON Schema -> form renderer, ported from
// ros2_medkit_web_ui/src/components/SchemaFormField.tsx so the Foxglove
// Operations tab can collect typed arguments for service requests / action
// goals (e.g. nav2 navigate_to_pose) instead of POSTing an empty body.
// Mirrors the web UI version in feature set; styles via the extension's
// inline-style helpers (no shadcn / lucide-react dependency).

import { type CSSProperties, type ReactElement, useEffect, useState } from "react";

import {
    type SchemaFieldType,
    type TopicSchema,
    getDefaultValue,
    isBooleanType,
    isNumericType,
    isPrimitiveType,
} from "./schema-utils";
import * as S from "./styles";
import type { Theme } from "./styles";

const INTEGER_TYPES = new Set([
    "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64",
    "byte", "char",
]);

interface NumericFieldProps {
    name: string;
    schemaType: string;
    value: unknown;
    onChange: (value: number) => void;
    indent: number;
    theme: Theme;
}

function NumericField({
    name, schemaType, value, onChange, indent, theme,
}: NumericFieldProps): ReactElement {
    const c = S.colors(theme);
    const isInteger = INTEGER_TYPES.has(schemaType.toLowerCase());
    const isUnsigned = schemaType.startsWith("uint") || schemaType === "byte";

    // Track raw input so the user can type "-" or "" mid-edit without the
    // parent state immediately resetting to 0.
    const [rawInput, setRawInput] = useState<string>(
        value === undefined || value === null ? "0" : String(value),
    );

    useEffect(() => {
        const expected = value === undefined || value === null ? "0" : String(value);
        if (rawInput !== "-" && rawInput !== "" && rawInput !== expected) {
            setRawInput(expected);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
        <div style={fieldRow(indent)}>
            <label style={fieldLabel(theme)}>{name}</label>
            <input
                type="text"
                inputMode="decimal"
                value={rawInput}
                onChange={(e) => {
                    const next = e.target.value;
                    setRawInput(next);
                    if (next === "" || next === "-" || next === ".") return;
                    let val = isInteger ? parseInt(next, 10) : parseFloat(next);
                    if (Number.isNaN(val)) return;
                    if (isUnsigned && val < 0) val = 0;
                    onChange(val);
                }}
                onBlur={() => {
                    let val: number;
                    if (rawInput === "" || rawInput === "-" || rawInput === ".") {
                        val = 0;
                    } else {
                        val = isInteger ? parseInt(rawInput, 10) : parseFloat(rawInput);
                        if (Number.isNaN(val)) val = 0;
                        if (isUnsigned && val < 0) val = 0;
                    }
                    setRawInput(String(val));
                    onChange(val);
                }}
                style={{ ...S.input(theme), flex: 1, fontSize: 11 }}
            />
            <span style={{ color: c.textMuted, fontSize: 10 }}>{schemaType}</span>
        </div>
    );
}

function fieldRow(indent: number): CSSProperties {
    return {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginLeft: indent,
    };
}

function fieldLabel(theme: Theme): CSSProperties {
    return {
        fontSize: 11,
        fontWeight: 500,
        minWidth: 110,
        color: S.colors(theme).text,
    };
}

function disclosureBtn(theme: Theme, expanded: boolean): ReactElement {
    return (
        <span style={{
            color: S.colors(theme).textMuted,
            fontSize: 10,
            width: 12,
            display: "inline-block",
        }}>
            {expanded ? "▼" : "▶"}
        </span>
    );
}

interface SchemaFormFieldProps {
    name: string;
    schema: SchemaFieldType;
    value: unknown;
    onChange: (value: unknown) => void;
    depth?: number;
    theme: Theme;
}

export function SchemaFormField({
    name, schema, value, onChange, depth = 0, theme,
}: SchemaFormFieldProps): ReactElement {
    const c = S.colors(theme);
    const [expanded, setExpanded] = useState(true);
    const indent = depth * 12;

    // Array
    if (schema.type === "array" && schema.items) {
        const arr = Array.isArray(value) ? value : [];
        const addItem = () => onChange([...arr, getDefaultValue(schema.items!)]);
        const removeItem = (idx: number) =>
            onChange(arr.filter((_, i) => i !== idx));
        const updateItem = (idx: number, next: unknown) => {
            const copy = [...arr];
            copy[idx] = next;
            onChange(copy);
        };

        return (
            <div style={{ marginLeft: indent }}>
                <div style={fieldRow(0)}>
                    <button
                        type="button"
                        style={{ ...S.btn(theme, "ghost"), padding: "0 4px", height: 20 }}
                        onClick={() => setExpanded(!expanded)}
                    >
                        {disclosureBtn(theme, expanded)}
                    </button>
                    <span style={{ ...fieldLabel(theme), minWidth: 0 }}>{name}</span>
                    <span style={{ color: c.textMuted, fontSize: 10 }}>
                        array[{arr.length}]
                    </span>
                    <button
                        type="button"
                        style={{ ...S.btn(theme, "ghost"), padding: "2px 6px", fontSize: 10 }}
                        onClick={addItem}
                    >
                        + Add
                    </button>
                </div>
                {expanded && (
                    <div style={{
                        paddingLeft: 12,
                        marginTop: 4,
                        borderLeft: `1px solid ${c.border}`,
                    }}>
                        {arr.map((item, idx) => (
                            <div
                                key={`${idx}-${JSON.stringify(item).slice(0, 32)}`}
                                style={{ display: "flex", alignItems: "flex-start", gap: 4, marginTop: 4 }}
                            >
                                <SchemaFormField
                                    name={`[${idx}]`}
                                    schema={schema.items!}
                                    value={item}
                                    onChange={(v) => updateItem(idx, v)}
                                    depth={0}
                                    theme={theme}
                                />
                                <button
                                    type="button"
                                    style={{ ...S.btn(theme, "danger"), padding: "0 6px", height: 20, fontSize: 10 }}
                                    onClick={() => removeItem(idx)}
                                    title="Remove item"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // Nested object
    if (schema.fields) {
        const obj = (typeof value === "object" && value !== null
            ? value
            : {}) as Record<string, unknown>;
        const updateField = (k: string, v: unknown) => onChange({ ...obj, [k]: v });

        return (
            <div style={{ marginLeft: indent }}>
                <div style={fieldRow(0)}>
                    <button
                        type="button"
                        style={{ ...S.btn(theme, "ghost"), padding: "0 4px", height: 20 }}
                        onClick={() => setExpanded(!expanded)}
                    >
                        {disclosureBtn(theme, expanded)}
                    </button>
                    <span style={{ ...fieldLabel(theme), minWidth: 0 }}>{name}</span>
                    <span style={{ color: c.textMuted, fontSize: 10 }}>{schema.type}</span>
                </div>
                {expanded && (
                    <div style={{
                        paddingLeft: 12,
                        marginTop: 4,
                        borderLeft: `1px solid ${c.border}`,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                    }}>
                        {Object.entries(schema.fields).map(([fname, fschema]) => (
                            <SchemaFormField
                                key={fname}
                                name={fname}
                                schema={fschema}
                                value={obj[fname]}
                                onChange={(v) => updateField(fname, v)}
                                depth={0}
                                theme={theme}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // Primitive
    if (isPrimitiveType(schema.type)) {
        if (isBooleanType(schema.type)) {
            return (
                <div style={fieldRow(indent)}>
                    <label style={fieldLabel(theme)}>{name}</label>
                    <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) => onChange(e.target.checked)}
                    />
                    <span style={{ color: c.textMuted, fontSize: 10 }}>{schema.type}</span>
                </div>
            );
        }

        if (isNumericType(schema.type)) {
            return (
                <NumericField
                    name={name}
                    schemaType={schema.type}
                    value={value}
                    onChange={(v) => onChange(v)}
                    indent={indent}
                    theme={theme}
                />
            );
        }

        // string / wstring
        return (
            <div style={fieldRow(indent)}>
                <label style={fieldLabel(theme)}>{name}</label>
                <input
                    type="text"
                    value={String(value ?? "")}
                    onChange={(e) => onChange(e.target.value)}
                    maxLength={schema.max_length}
                    style={{ ...S.input(theme), flex: 1, fontSize: 11 }}
                />
                <span style={{ color: c.textMuted, fontSize: 10 }}>{schema.type}</span>
            </div>
        );
    }

    // Fallback: raw JSON input for unknown / opaque types.
    return (
        <div style={fieldRow(indent)}>
            <label style={fieldLabel(theme)}>{name}</label>
            <input
                type="text"
                value={JSON.stringify(value ?? null)}
                onChange={(e) => {
                    try {
                        onChange(JSON.parse(e.target.value));
                    } catch {
                        onChange(e.target.value);
                    }
                }}
                placeholder="JSON value"
                style={{ ...S.input(theme), flex: 1, fontSize: 11 }}
            />
            <span style={{ color: c.textMuted, fontSize: 10 }}>{schema.type}</span>
        </div>
    );
}

interface SchemaFormProps {
    schema: TopicSchema;
    value: Record<string, unknown>;
    onChange: (value: Record<string, unknown>) => void;
    theme: Theme;
}

export function SchemaForm({ schema, value, onChange, theme }: SchemaFormProps): ReactElement {
    const updateField = (k: string, v: unknown) => onChange({ ...value, [k]: v });
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {Object.entries(schema).map(([fname, fschema]) => (
                <SchemaFormField
                    key={fname}
                    name={fname}
                    schema={fschema}
                    value={value[fname]}
                    onChange={(v) => updateField(fname, v)}
                    theme={theme}
                />
            ))}
        </div>
    );
}
