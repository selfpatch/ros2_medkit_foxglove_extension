// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.
import { describe, expect, it } from "vitest";

import {
    convertJsonSchemaToTopicSchema,
    getDefaultValue,
    getSchemaDefaults,
    isBooleanType,
    isNumericType,
    isPrimitiveType,
} from "./schema-utils";

describe("schema-utils type predicates", () => {
    it("classifies ROS 2 numeric types", () => {
        expect(isNumericType("int32")).toBe(true);
        expect(isNumericType("uint8")).toBe(true);
        expect(isNumericType("float64")).toBe(true);
        expect(isNumericType("byte")).toBe(true);
        expect(isNumericType("string")).toBe(false);
        expect(isNumericType("bool")).toBe(false);
    });

    it("classifies booleans (both spellings)", () => {
        expect(isBooleanType("bool")).toBe(true);
        expect(isBooleanType("BOOLEAN")).toBe(true);
        expect(isBooleanType("string")).toBe(false);
    });

    it("classifies primitives - bool, numerics, strings, but not arrays/objects", () => {
        expect(isPrimitiveType("string")).toBe(true);
        expect(isPrimitiveType("int32")).toBe(true);
        expect(isPrimitiveType("bool")).toBe(true);
        expect(isPrimitiveType("array")).toBe(false);
        expect(isPrimitiveType("object")).toBe(false);
    });
});

describe("convertJsonSchemaToTopicSchema", () => {
    it("flattens top-level properties and maps json schema types to ROS 2 names", () => {
        const result = convertJsonSchemaToTopicSchema({
            type: "object",
            properties: {
                count: { type: "integer" },
                ratio: { type: "number" },
                enabled: { type: "boolean" },
                name: { type: "string" },
            },
        });
        expect(result).toEqual({
            count: { type: "int32" },
            ratio: { type: "float64" },
            enabled: { type: "bool" },
            name: { type: "string" },
        });
    });

    it("preserves nested object structure as `fields`", () => {
        const result = convertJsonSchemaToTopicSchema({
            type: "object",
            properties: {
                pose: {
                    type: "object",
                    properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                    },
                },
            },
        });
        expect(result?.pose).toEqual({
            type: "object",
            fields: {
                x: { type: "float64" },
                y: { type: "float64" },
            },
        });
    });

    it("preserves array item schemas as `items`", () => {
        const result = convertJsonSchemaToTopicSchema({
            type: "object",
            properties: {
                waypoints: {
                    type: "array",
                    items: { type: "number" },
                },
            },
        });
        expect(result?.waypoints).toEqual({
            type: "array",
            items: { type: "float64" },
        });
    });

    it("returns undefined for non-objects", () => {
        expect(convertJsonSchemaToTopicSchema(null)).toBeUndefined();
        expect(convertJsonSchemaToTopicSchema(undefined)).toBeUndefined();
        expect(convertJsonSchemaToTopicSchema("nope")).toBeUndefined();
    });
});

describe("getDefaultValue", () => {
    it("returns 0 for numeric types", () => {
        expect(getDefaultValue({ type: "int32" })).toBe(0);
        expect(getDefaultValue({ type: "float64" })).toBe(0);
    });

    it("returns false for booleans", () => {
        expect(getDefaultValue({ type: "bool" })).toBe(false);
    });

    it("returns empty string for strings", () => {
        expect(getDefaultValue({ type: "string" })).toBe("");
    });

    it("returns empty array for arrays", () => {
        expect(getDefaultValue({ type: "array", items: { type: "int32" } })).toEqual([]);
    });

    it("recursively builds object defaults", () => {
        expect(getDefaultValue({
            type: "object",
            fields: {
                count: { type: "int32" },
                name: { type: "string" },
                nested: { type: "object", fields: { flag: { type: "bool" } } },
            },
        })).toEqual({
            count: 0,
            name: "",
            nested: { flag: false },
        });
    });
});

describe("getSchemaDefaults", () => {
    it("builds defaults for navigate_to_pose-shaped goal schema", () => {
        // Modeled on the actual schema returned by the gateway for nav2's
        // navigate_to_pose action - the headline operation in the OTA demo.
        const schema = convertJsonSchemaToTopicSchema({
            type: "object",
            properties: {
                behavior_tree: { type: "string" },
                pose: {
                    type: "object",
                    properties: {
                        header: {
                            type: "object",
                            properties: { frame_id: { type: "string" } },
                        },
                        pose: {
                            type: "object",
                            properties: {
                                position: {
                                    type: "object",
                                    properties: {
                                        x: { type: "number" },
                                        y: { type: "number" },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        expect(schema).toBeDefined();
        const defaults = getSchemaDefaults(schema!);
        expect(defaults).toEqual({
            behavior_tree: "",
            pose: {
                header: { frame_id: "" },
                pose: {
                    position: { x: 0, y: 0 },
                },
            },
        });
    });
});
