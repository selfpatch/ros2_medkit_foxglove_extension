// Copyright 2024-2026 bburda. Apache-2.0 license.

// =============================================================================
// Field model types (mirroring web_ui src/lib/types.ts SchemaFieldType/TopicSchema)
// =============================================================================

/**
 * Schema entry for a single field.
 * Shape mirrors web_ui SchemaFieldType (types.ts:264-277).
 */
export interface SchemaFieldType {
    /** Primitive type name (e.g. "double", "int32", "string", "bool") or nested type path */
    type: string;
    /** For nested message types, contains the fields of that type */
    fields?: TopicSchema;
    /** For array types, describes the item type */
    items?: SchemaFieldType;
    /** For fixed-size arrays */
    size?: number;
    /** For bounded sequences */
    max_size?: number;
    /** For bounded strings */
    max_length?: number;
}

/** Schema mapping field names to their type information */
export type TopicSchema = Record<string, SchemaFieldType>;

// =============================================================================
// JSON Schema -> TopicSchema conversion
// (mirrors web_ui schema-utils.ts lines 10-93)
// =============================================================================

/**
 * JSON Schema format returned by the gateway API under an operation's x-medkit type_info.
 */
interface JsonSchemaField {
    type?: string;
    properties?: Record<string, JsonSchemaField>;
    items?: JsonSchemaField;
}

/**
 * Map JSON Schema primitive type names to ROS 2 type names.
 * Mirrors web_ui mapJsonSchemaType (schema-utils.ts:19-37).
 */
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

/**
 * Convert a single JSON Schema field to SchemaFieldType.
 * Mirrors web_ui convertJsonSchemaField (schema-utils.ts:42-61).
 */
export function convertJsonSchemaField(field: JsonSchemaField): SchemaFieldType {
    const result: SchemaFieldType = {
        type: mapJsonSchemaType(field.type),
    };

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
 * Convert a JSON Schema object (as returned by the gateway) to TopicSchema.
 * API returns: { "type": "object", "properties": { "field": { "type": "integer" } } }
 * Result: { "field": { "type": "int32" } }
 * Mirrors web_ui convertJsonSchemaToTopicSchema (schema-utils.ts:76-93).
 */
export function convertJsonSchemaToTopicSchema(jsonSchema: unknown): TopicSchema | undefined {
    if (!jsonSchema || typeof jsonSchema !== "object") {
        return undefined;
    }

    const schema = jsonSchema as JsonSchemaField;

    if (schema.properties) {
        const result: TopicSchema = {};
        for (const [key, value] of Object.entries(schema.properties)) {
            result[key] = convertJsonSchemaField(value);
        }
        return result;
    }

    // Opaque object schema: a bare { type: "object" } with no properties carries
    // no field information. Returning it as-is would render the literal "type"
    // key as a phantom form field, so collapse it to an empty schema instead.
    if (schema.type === "object") {
        return {};
    }

    return jsonSchema as TopicSchema;
}

// =============================================================================
// Type-checking utilities
// (mirrors web_ui schema-utils.ts lines 103-154)
// =============================================================================

/** Returns true if the type is a ROS 2 primitive. */
export function isPrimitiveType(type: string): boolean {
    const primitives = [
        "bool",
        "boolean",
        "int8",
        "uint8",
        "int16",
        "uint16",
        "int32",
        "uint32",
        "int64",
        "uint64",
        "float",
        "float32",
        "float64",
        "double",
        "string",
        "wstring",
        "byte",
        "char",
    ];
    return primitives.includes(type.toLowerCase());
}

/** Returns true if the type is numeric. */
export function isNumericType(type: string): boolean {
    const numerics = [
        "int8",
        "uint8",
        "int16",
        "uint16",
        "int32",
        "uint32",
        "int64",
        "uint64",
        "float",
        "float32",
        "float64",
        "double",
        "byte",
    ];
    return numerics.includes(type.toLowerCase());
}

/** Returns true if the type is boolean. */
export function isBooleanType(type: string): boolean {
    return type.toLowerCase() === "bool" || type.toLowerCase() === "boolean";
}

/**
 * Returns true for 64-bit integer types whose full range exceeds JS's safe
 * integer limit (2^53). These are carried as decimal strings end-to-end so a
 * large value (e.g. a nanosecond timestamp) is not silently rounded by a JS
 * number; the gateway parses the string back to int64/uint64 losslessly.
 */
export function isBigIntType(type: string): boolean {
    const lower = type.toLowerCase();
    return lower === "int64" || lower === "uint64";
}

// =============================================================================
// Structural defaults
// (mirrors web_ui schema-utils.ts lines 159-189)
// NOTE: does NOT consume type_info.default_value - structural only.
// =============================================================================

/**
 * Get the structural default value for a schema field.
 * - array -> []
 * - nested object (fields present) -> recursive object of defaults
 * - int64/uint64 -> "0" (string, to preserve precision beyond 2^53)
 * - other numeric -> 0
 * - bool -> false
 * - opaque object (type "object", no fields) -> {} (structural empty object)
 * - everything else (string, unknown) -> ""
 * Mirrors web_ui getDefaultValue (schema-utils.ts:159-178), except 64-bit ints
 * are carried as strings here (web_ui uses plain numbers).
 */
export function getDefaultValue(schema: SchemaFieldType): unknown {
    if (schema.type === "array") {
        return [];
    }
    if (schema.fields) {
        const obj: Record<string, unknown> = {};
        for (const [key, fieldSchema] of Object.entries(schema.fields)) {
            obj[key] = getDefaultValue(fieldSchema);
        }
        return obj;
    }
    // 64-bit ints are carried as strings to preserve precision beyond 2^53.
    if (isBigIntType(schema.type)) {
        return "0";
    }
    if (isNumericType(schema.type)) {
        return 0;
    }
    if (isBooleanType(schema.type)) {
        return false;
    }
    // Opaque object with no fields: yield a structural empty object so the JSON
    // fallback input seeds with `{}` rather than an empty string.
    if (schema.type === "object") {
        return {};
    }
    return "";
}

/**
 * Generate structural default values for an entire TopicSchema.
 * Mirrors web_ui getSchemaDefaults (schema-utils.ts:184-190).
 */
export function getSchemaDefaults(schema: TopicSchema): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};
    for (const [fieldName, fieldSchema] of Object.entries(schema)) {
        defaults[fieldName] = getDefaultValue(fieldSchema);
    }
    return defaults;
}
