// Copyright 2024-2026 bburda. Apache-2.0 license.
import { describe, expect, it } from "vitest";

import {
    convertJsonSchemaField,
    convertJsonSchemaToTopicSchema,
    deepMerge,
    getDefaultValue,
    getSchemaDefaults,
    isBooleanType,
    isNumericType,
    isPrimitiveType,
} from "./schema-utils";
import type { SchemaFieldType, TopicSchema } from "./schema-utils";

// =============================================================================
// mapJsonSchemaType / convertJsonSchemaField - scalar types
// =============================================================================

describe("convertJsonSchemaField - scalar types", () => {
    it("maps integer to int32", () => {
        expect(convertJsonSchemaField({ type: "integer" })).toEqual({ type: "int32" });
    });

    it("maps number to float64", () => {
        expect(convertJsonSchemaField({ type: "number" })).toEqual({ type: "float64" });
    });

    it("maps boolean to bool", () => {
        expect(convertJsonSchemaField({ type: "boolean" })).toEqual({ type: "bool" });
    });

    it("maps string to string", () => {
        expect(convertJsonSchemaField({ type: "string" })).toEqual({ type: "string" });
    });

    it("maps array to array (no items)", () => {
        expect(convertJsonSchemaField({ type: "array" })).toEqual({ type: "array" });
    });

    it("maps object to object (no properties)", () => {
        expect(convertJsonSchemaField({ type: "object" })).toEqual({ type: "object" });
    });

    it("passes through unknown type names unchanged", () => {
        expect(convertJsonSchemaField({ type: "geometry_msgs/msg/Pose" })).toEqual({
            type: "geometry_msgs/msg/Pose",
        });
    });

    it("returns 'object' when type is undefined", () => {
        expect(convertJsonSchemaField({})).toEqual({ type: "object" });
    });
});

// =============================================================================
// convertJsonSchemaField - arrays with items
// =============================================================================

describe("convertJsonSchemaField - arrays with items", () => {
    it("converts array with integer items", () => {
        const field = { type: "array", items: { type: "integer" } };
        expect(convertJsonSchemaField(field)).toEqual({
            type: "array",
            items: { type: "int32" },
        });
    });

    it("converts array with object items (nested schema)", () => {
        const field = {
            type: "array",
            items: {
                type: "object",
                properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                },
            },
        };
        expect(convertJsonSchemaField(field)).toEqual({
            type: "array",
            items: {
                type: "object",
                fields: {
                    x: { type: "float64" },
                    y: { type: "float64" },
                },
            },
        });
    });
});

// =============================================================================
// convertJsonSchemaField - nested objects
// =============================================================================

describe("convertJsonSchemaField - nested objects", () => {
    it("converts properties to fields", () => {
        const field = {
            type: "object",
            properties: {
                linear: {
                    type: "object",
                    properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                        z: { type: "number" },
                    },
                },
                angular: {
                    type: "object",
                    properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                        z: { type: "number" },
                    },
                },
            },
        };

        const result = convertJsonSchemaField(field);

        expect(result.type).toBe("object");
        expect(result.fields).toBeDefined();
        expect(result.fields!["linear"]).toEqual({
            type: "object",
            fields: {
                x: { type: "float64" },
                y: { type: "float64" },
                z: { type: "float64" },
            },
        });
        expect(result.fields!["angular"]).toEqual({
            type: "object",
            fields: {
                x: { type: "float64" },
                y: { type: "float64" },
                z: { type: "float64" },
            },
        });
    });

    it("handles deeply nested objects", () => {
        const field = {
            type: "object",
            properties: {
                pose: {
                    type: "object",
                    properties: {
                        position: {
                            type: "object",
                            properties: {
                                x: { type: "number" },
                            },
                        },
                    },
                },
            },
        };

        const result = convertJsonSchemaField(field);

        expect(result.fields!["pose"]!.fields!["position"]!.fields!["x"]).toEqual({
            type: "float64",
        });
    });
});

// =============================================================================
// convertJsonSchemaToTopicSchema
// =============================================================================

describe("convertJsonSchemaToTopicSchema", () => {
    it("converts a root-level object schema to TopicSchema", () => {
        const schema = {
            type: "object",
            properties: {
                speed: { type: "number" },
                enabled: { type: "boolean" },
                name: { type: "string" },
            },
        };

        const result = convertJsonSchemaToTopicSchema(schema);

        expect(result).toEqual({
            speed: { type: "float64" },
            enabled: { type: "bool" },
            name: { type: "string" },
        });
    });

    it("returns undefined for null input", () => {
        expect(convertJsonSchemaToTopicSchema(null)).toBeUndefined();
    });

    it("returns undefined for non-object input", () => {
        expect(convertJsonSchemaToTopicSchema("string")).toBeUndefined();
        expect(convertJsonSchemaToTopicSchema(42)).toBeUndefined();
    });

    it("returns input as-is when no properties key (already TopicSchema)", () => {
        const already: TopicSchema = { x: { type: "float64" } };
        expect(convertJsonSchemaToTopicSchema(already)).toEqual(already);
    });

    it("returns an empty schema for an opaque object schema (type:object, no properties)", () => {
        // A bare { type: "object" } carries no fields; it must NOT render as a
        // form field literally labeled "type".
        expect(convertJsonSchemaToTopicSchema({ type: "object" })).toEqual({});
    });

    it("handles twist-like schema (geometry_msgs/msg/Twist)", () => {
        const twistSchema = {
            type: "object",
            properties: {
                linear: {
                    type: "object",
                    properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                        z: { type: "number" },
                    },
                },
                angular: {
                    type: "object",
                    properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                        z: { type: "number" },
                    },
                },
            },
        };

        const result = convertJsonSchemaToTopicSchema(twistSchema)!;

        expect(Object.keys(result)).toEqual(["linear", "angular"]);
        expect(result["linear"]!.type).toBe("object");
        expect(result["linear"]!.fields!["x"]).toEqual({ type: "float64" });
    });
});

// =============================================================================
// isPrimitiveType / isNumericType / isBooleanType
// =============================================================================

describe("isPrimitiveType", () => {
    it("returns true for ROS 2 primitives", () => {
        for (const t of ["bool", "int32", "uint8", "float64", "string", "byte", "char", "wstring"]) {
            expect(isPrimitiveType(t)).toBe(true);
        }
    });

    it("is case-insensitive", () => {
        expect(isPrimitiveType("BOOL")).toBe(true);
        expect(isPrimitiveType("Int32")).toBe(true);
    });

    it("returns false for non-primitives", () => {
        expect(isPrimitiveType("object")).toBe(false);
        expect(isPrimitiveType("array")).toBe(false);
        expect(isPrimitiveType("geometry_msgs/msg/Pose")).toBe(false);
    });
});

describe("isNumericType", () => {
    it("returns true for numeric types", () => {
        for (const t of ["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64",
            "float", "float32", "float64", "double", "byte"]) {
            expect(isNumericType(t)).toBe(true);
        }
    });

    it("returns false for non-numeric", () => {
        expect(isNumericType("bool")).toBe(false);
        expect(isNumericType("string")).toBe(false);
    });
});

describe("isBooleanType", () => {
    it("returns true for bool and boolean", () => {
        expect(isBooleanType("bool")).toBe(true);
        expect(isBooleanType("boolean")).toBe(true);
    });

    it("is case-insensitive", () => {
        expect(isBooleanType("BOOL")).toBe(true);
        expect(isBooleanType("Boolean")).toBe(true);
    });

    it("returns false for non-boolean", () => {
        expect(isBooleanType("int32")).toBe(false);
        expect(isBooleanType("string")).toBe(false);
    });
});

// =============================================================================
// getDefaultValue - structural defaults (does NOT consume type_info.default_value)
// =============================================================================

describe("getDefaultValue - structural defaults", () => {
    it("returns 0 for numeric types that fit in a JS number", () => {
        const numericTypes = ["int8", "uint8", "int16", "uint16", "int32", "uint32",
            "float", "float32", "float64", "double", "byte"];
        for (const t of numericTypes) {
            const schema: SchemaFieldType = { type: t };
            expect(getDefaultValue(schema)).toBe(0);
        }
    });

    it("returns the string \"0\" for 64-bit int types (carried as strings)", () => {
        for (const t of ["int64", "uint64"]) {
            const schema: SchemaFieldType = { type: t };
            expect(getDefaultValue(schema)).toBe("0");
        }
    });

    it("returns false for bool", () => {
        expect(getDefaultValue({ type: "bool" })).toBe(false);
        expect(getDefaultValue({ type: "boolean" })).toBe(false);
    });

    it("returns empty string for string", () => {
        expect(getDefaultValue({ type: "string" })).toBe("");
        expect(getDefaultValue({ type: "wstring" })).toBe("");
    });

    it("returns [] for array type", () => {
        expect(getDefaultValue({ type: "array" })).toEqual([]);
    });

    it("returns [] for array type even when items is defined", () => {
        const schema: SchemaFieldType = { type: "array", items: { type: "int32" } };
        expect(getDefaultValue(schema)).toEqual([]);
    });

    it("returns an empty object for object type without fields (unknown/opaque)", () => {
        // object type with no fields -> structural empty object so the JSON
        // fallback input seeds with {} rather than "".
        expect(getDefaultValue({ type: "object" })).toEqual({});
    });

    it("recursively builds nested object defaults", () => {
        const schema: SchemaFieldType = {
            type: "object",
            fields: {
                x: { type: "float64" },
                y: { type: "float64" },
                z: { type: "float64" },
            },
        };
        expect(getDefaultValue(schema)).toEqual({ x: 0, y: 0, z: 0 });
    });

    it("recursively builds deeply nested defaults", () => {
        const schema: SchemaFieldType = {
            type: "object",
            fields: {
                linear: {
                    type: "object",
                    fields: {
                        x: { type: "float64" },
                        y: { type: "float64" },
                        z: { type: "float64" },
                    },
                },
                angular: {
                    type: "object",
                    fields: {
                        x: { type: "float64" },
                        y: { type: "float64" },
                        z: { type: "float64" },
                    },
                },
            },
        };

        expect(getDefaultValue(schema)).toEqual({
            linear: { x: 0, y: 0, z: 0 },
            angular: { x: 0, y: 0, z: 0 },
        });
    });

    it("returns empty string for unrecognized type (fallback)", () => {
        expect(getDefaultValue({ type: "geometry_msgs/msg/Pose" })).toBe("");
    });
});

// =============================================================================
// getSchemaDefaults - full schema defaults
// =============================================================================

describe("getSchemaDefaults", () => {
    it("returns empty object for empty schema", () => {
        expect(getSchemaDefaults({})).toEqual({});
    });

    it("builds defaults for a flat schema", () => {
        const schema: TopicSchema = {
            speed: { type: "float64" },
            enabled: { type: "bool" },
            label: { type: "string" },
            count: { type: "int32" },
        };
        expect(getSchemaDefaults(schema)).toEqual({
            speed: 0,
            enabled: false,
            label: "",
            count: 0,
        });
    });

    it("builds defaults for a nested schema (e.g. Twist)", () => {
        const schema: TopicSchema = {
            linear: {
                type: "object",
                fields: {
                    x: { type: "float64" },
                    y: { type: "float64" },
                    z: { type: "float64" },
                },
            },
            angular: {
                type: "object",
                fields: {
                    x: { type: "float64" },
                    y: { type: "float64" },
                    z: { type: "float64" },
                },
            },
        };

        expect(getSchemaDefaults(schema)).toEqual({
            linear: { x: 0, y: 0, z: 0 },
            angular: { x: 0, y: 0, z: 0 },
        });
    });

    it("produces structural defaults, not type_info.default_value", () => {
        // Verify that even when a field has no default, we produce 0/false/"" not undefined
        const schema: TopicSchema = {
            value: { type: "int32" },
        };
        const defaults = getSchemaDefaults(schema);
        expect(defaults["value"]).toBe(0);
        expect("value" in defaults).toBe(true);
    });
});

// =============================================================================
// deepMerge
// =============================================================================

describe("deepMerge", () => {
    it("merges flat objects, source wins", () => {
        const target = { a: 1, b: 2 };
        const source = { b: 99, c: 3 };
        expect(deepMerge(target, source)).toEqual({ a: 1, b: 99, c: 3 });
    });

    it("recursively merges nested objects", () => {
        const target = { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
        const source = { linear: { x: 1.5 } };
        expect(deepMerge(target, source)).toEqual({
            linear: { x: 1.5, y: 0, z: 0 },
            angular: { x: 0, y: 0, z: 0 },
        });
    });

    it("does not modify the target object", () => {
        const target = { a: 1 };
        const source = { a: 2 };
        deepMerge(target, source);
        expect(target["a"]).toBe(1);
    });

    it("skips null/undefined source values", () => {
        const target = { a: 1, b: 2 };
        const source = { a: null, b: undefined } as unknown as Record<string, unknown>;
        expect(deepMerge(target, source)).toEqual({ a: 1, b: 2 });
    });

    it("replaces arrays from source, not merges them", () => {
        const target = { items: [1, 2, 3] };
        const source = { items: [4, 5] };
        expect(deepMerge(target, source)).toEqual({ items: [4, 5] });
    });

    it("handles empty source", () => {
        const target = { a: 1 };
        expect(deepMerge(target, {})).toEqual({ a: 1 });
    });

    it("does not pollute Object.prototype via __proto__/constructor keys", () => {
        // source can come from user-edited JSON, so dangerous keys must be skipped.
        const malicious = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"x": 1}, "safe": 2}');
        const result = deepMerge({ a: 1 }, malicious);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
        // The legitimate key still merges.
        expect(result.safe).toBe(2);
    });

    it("overlays user values onto schema defaults (real use-case)", () => {
        const schema: TopicSchema = {
            linear: {
                type: "object",
                fields: { x: { type: "float64" }, y: { type: "float64" }, z: { type: "float64" } },
            },
            angular: {
                type: "object",
                fields: { x: { type: "float64" }, y: { type: "float64" }, z: { type: "float64" } },
            },
        };
        const defaults = getSchemaDefaults(schema);
        const userInput = { linear: { x: 0.5 } };
        expect(deepMerge(defaults, userInput)).toEqual({
            linear: { x: 0.5, y: 0, z: 0 },
            angular: { x: 0, y: 0, z: 0 },
        });
    });
});
