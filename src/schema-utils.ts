// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.
//
// JSON Schema -> form-friendly TopicSchema conversion + value defaulting.
// Mirrors ros2_medkit_web_ui/src/lib/schema-utils.ts so the web UI and the
// Foxglove extension build the same form from the same gateway response.
// Keep this file in sync if the web UI version changes.

export interface SchemaFieldType {
    type: string;
    fields?: Record<string, SchemaFieldType>;
    items?: SchemaFieldType;
    max_length?: number;
}

export type TopicSchema = Record<string, SchemaFieldType>;

interface JsonSchemaField {
    type?: string;
    properties?: Record<string, JsonSchemaField>;
    items?: JsonSchemaField;
}

function mapJsonSchemaType(type: string | undefined): string {
    if (!type) return "object";
    switch (type) {
        case "integer":
            return "int32";
        case "number":
            return "float64";
        case "boolean":
            return "bool";
        case "string":
            return "string";
        case "array":
            return "array";
        case "object":
            return "object";
        default:
            return type;
    }
}

function convertJsonSchemaField(field: JsonSchemaField): SchemaFieldType {
    const result: SchemaFieldType = { type: mapJsonSchemaType(field.type) };
    if (field.properties) {
        result.fields = {};
        for (const [key, value] of Object.entries(field.properties)) {
            result.fields[key] = convertJsonSchemaField(value);
        }
    }
    if (field.items) {
        result.items = convertJsonSchemaField(field.items);
    }
    return result;
}

/**
 * Convert the gateway's JSON-Schema-shaped operation type_info into the
 * flat TopicSchema the form renderer consumes:
 *   { "type": "object", "properties": { "x": { "type": "integer" } } }
 *   ->
 *   { "x": { "type": "int32" } }
 */
export function convertJsonSchemaToTopicSchema(jsonSchema: unknown): TopicSchema | undefined {
    if (!jsonSchema || typeof jsonSchema !== "object") return undefined;
    const schema = jsonSchema as JsonSchemaField;
    if (schema.properties) {
        const result: TopicSchema = {};
        for (const [key, value] of Object.entries(schema.properties)) {
            result[key] = convertJsonSchemaField(value);
        }
        return result;
    }
    return jsonSchema as TopicSchema;
}

const PRIMITIVE_TYPES = new Set([
    "bool", "boolean",
    "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64",
    "float", "float32", "float64", "double",
    "string", "wstring",
    "byte", "char",
]);

const NUMERIC_TYPES = new Set([
    "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64",
    "float", "float32", "float64", "double",
    "byte",
]);

export function isPrimitiveType(type: string): boolean {
    return PRIMITIVE_TYPES.has(type.toLowerCase());
}

export function isNumericType(type: string): boolean {
    return NUMERIC_TYPES.has(type.toLowerCase());
}

export function isBooleanType(type: string): boolean {
    const t = type.toLowerCase();
    return t === "bool" || t === "boolean";
}

export function getDefaultValue(schema: SchemaFieldType): unknown {
    if (schema.type === "array") return [];
    if (schema.fields) {
        const obj: Record<string, unknown> = {};
        for (const [key, fieldSchema] of Object.entries(schema.fields)) {
            obj[key] = getDefaultValue(fieldSchema);
        }
        return obj;
    }
    if (isNumericType(schema.type)) return 0;
    if (isBooleanType(schema.type)) return false;
    return "";
}

export function getSchemaDefaults(schema: TopicSchema): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};
    for (const [fieldName, fieldSchema] of Object.entries(schema)) {
        defaults[fieldName] = getDefaultValue(fieldSchema);
    }
    return defaults;
}
