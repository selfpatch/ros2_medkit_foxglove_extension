// Copyright 2024-2026 bburda. Apache-2.0 license.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { OperationRequestForm } from "./OperationRequestForm";
import type { TopicSchema } from "./schema-utils";

const THEME = "dark" as const;

// Helper: render with a controlled value and return the onChange spy.
function renderForm(schema: TopicSchema, value: Record<string, unknown>) {
    const onChange = vi.fn();
    render(
        <OperationRequestForm schema={schema} value={value} onChange={onChange} theme={THEME} />,
    );
    return onChange;
}

// =============================================================================
// String field
// =============================================================================

describe("OperationRequestForm - string field", () => {
    it("renders a text input with the current value", () => {
        renderForm({ name: { type: "string" } }, { name: "hello" });
        const input = screen.getByRole("textbox", { name: "name" });
        expect(input).toHaveValue("hello");
    });

    it("calls onChange with updated string when user types", () => {
        const onChange = renderForm({ name: { type: "string" } }, { name: "hello" });
        const input = screen.getByRole("textbox", { name: "name" });
        fireEvent.change(input, { target: { value: "world" } });
        expect(onChange).toHaveBeenCalledWith({ name: "world" });
    });

    it("merges string update into the existing object", () => {
        const onChange = renderForm(
            { x: { type: "string" }, y: { type: "string" } },
            { x: "a", y: "b" },
        );
        const xInput = screen.getByRole("textbox", { name: "x" });
        fireEvent.change(xInput, { target: { value: "A" } });
        expect(onChange).toHaveBeenCalledWith({ x: "A", y: "b" });
    });
});

// =============================================================================
// Numeric field - intermediate-typing UX
// Mirrors web_ui SchemaFormField.tsx lines 60-86.
// =============================================================================

describe("OperationRequestForm - numeric field (intermediate typing)", () => {
    it("renders a text input with the current numeric value", () => {
        renderForm({ speed: { type: "float64" } }, { speed: 3.14 });
        const input = screen.getByRole("textbox", { name: "speed" });
        expect(input).toHaveValue("3.14");
    });

    it("does NOT call onChange when user types '-' (intermediate state)", () => {
        const onChange = renderForm({ speed: { type: "float64" } }, { speed: 0 });
        const input = screen.getByRole("textbox", { name: "speed" });
        fireEvent.change(input, { target: { value: "-" } });
        // rawInput updates but parent is not notified yet
        expect(onChange).not.toHaveBeenCalled();
    });

    it("does NOT call onChange when user types '.' (intermediate state)", () => {
        const onChange = renderForm({ speed: { type: "float64" } }, { speed: 0 });
        const input = screen.getByRole("textbox", { name: "speed" });
        fireEvent.change(input, { target: { value: "." } });
        expect(onChange).not.toHaveBeenCalled();
    });

    it("calls onChange after user types '-5' (complete number)", () => {
        const onChange = renderForm({ speed: { type: "float64" } }, { speed: 0 });
        const input = screen.getByRole("textbox", { name: "speed" });
        // '-' is intermediate - no callback
        fireEvent.change(input, { target: { value: "-" } });
        expect(onChange).not.toHaveBeenCalled();
        // '-5' is a complete number
        fireEvent.change(input, { target: { value: "-5" } });
        expect(onChange).toHaveBeenCalledWith({ speed: -5 });
    });

    it("commits normalised value on blur when input is '-'", () => {
        const onChange = renderForm({ speed: { type: "float64" } }, { speed: 0 });
        const input = screen.getByRole("textbox", { name: "speed" });
        fireEvent.change(input, { target: { value: "-" } });
        fireEvent.blur(input);
        // '-' normalises to 0 on blur (web_ui lines 77-80)
        expect(onChange).toHaveBeenCalledWith({ speed: 0 });
    });

    it("commits normalised value on blur when input is '' (empty)", () => {
        const onChange = renderForm({ speed: { type: "float64" } }, { speed: 5 });
        const input = screen.getByRole("textbox", { name: "speed" });
        fireEvent.change(input, { target: { value: "" } });
        fireEvent.blur(input);
        expect(onChange).toHaveBeenCalledWith({ speed: 0 });
    });

    it("parses integer type with parseInt", () => {
        const onChange = renderForm({ count: { type: "int32" } }, { count: 0 });
        const input = screen.getByRole("textbox", { name: "count" });
        fireEvent.change(input, { target: { value: "7" } });
        expect(onChange).toHaveBeenCalledWith({ count: 7 });
    });

    it("clamps unsigned type to 0 when a negative value is typed", () => {
        const onChange = renderForm({ index: { type: "uint32" } }, { index: 0 });
        const input = screen.getByRole("textbox", { name: "index" });
        // type '-5'; unsigned clamp fires on the complete '-5' input
        fireEvent.change(input, { target: { value: "-5" } });
        expect(onChange).toHaveBeenCalledWith({ index: 0 });
    });

    it("does not update parent for NaN input", () => {
        const onChange = renderForm({ speed: { type: "float64" } }, { speed: 1 });
        const input = screen.getByRole("textbox", { name: "speed" });
        fireEvent.change(input, { target: { value: "abc" } });
        expect(onChange).not.toHaveBeenCalled();
    });

    it("carries int64 values as a string to preserve precision beyond 2^53", () => {
        // A nanosecond-scale timestamp exceeds Number.MAX_SAFE_INTEGER; parseInt
        // would round it. The field must emit the exact decimal string instead.
        const big = "9223372036854775807"; // INT64_MAX
        const onChange = renderForm({ stamp: { type: "int64" } }, { stamp: "0" });
        const input = screen.getByRole("textbox", { name: "stamp" });
        fireEvent.change(input, { target: { value: big } });
        expect(onChange).toHaveBeenCalledWith({ stamp: big });
        // Guard against a silent number round-trip losing precision.
        expect(String(Number(big))).not.toBe(big);
    });

    it("rejects non-integer input for a uint64 field", () => {
        const onChange = renderForm({ id: { type: "uint64" } }, { id: "0" });
        const input = screen.getByRole("textbox", { name: "id" });
        fireEvent.change(input, { target: { value: "-5" } }); // negative -> rejected for unsigned
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.change(input, { target: { value: "1.5" } }); // non-integer -> rejected
        expect(onChange).not.toHaveBeenCalled();
    });
});

// =============================================================================
// Boolean field - toggle
// =============================================================================

describe("OperationRequestForm - bool field", () => {
    it("renders a toggle button showing the current value", () => {
        renderForm({ active: { type: "bool" } }, { active: true });
        expect(screen.getByRole("switch", { name: "active" })).toHaveTextContent("true");
    });

    it("shows false when value is false", () => {
        renderForm({ active: { type: "bool" } }, { active: false });
        expect(screen.getByRole("switch", { name: "active" })).toHaveTextContent("false");
    });

    it("calls onChange with flipped boolean when clicked", () => {
        const onChange = renderForm({ active: { type: "bool" } }, { active: false });
        fireEvent.click(screen.getByRole("switch", { name: "active" }));
        expect(onChange).toHaveBeenCalledWith({ active: true });
    });

    it("calls onChange with false when toggled from true", () => {
        const onChange = renderForm({ active: { type: "bool" } }, { active: true });
        fireEvent.click(screen.getByRole("switch", { name: "active" }));
        expect(onChange).toHaveBeenCalledWith({ active: false });
    });

    it("preserves other fields when toggling bool", () => {
        const onChange = renderForm(
            { active: { type: "bool" }, name: { type: "string" } },
            { active: false, name: "foo" },
        );
        fireEvent.click(screen.getByRole("switch", { name: "active" }));
        expect(onChange).toHaveBeenCalledWith({ active: true, name: "foo" });
    });
});

// =============================================================================
// Array field - add / remove
// =============================================================================

describe("OperationRequestForm - array field", () => {
    const arraySchema: TopicSchema = {
        tags: { type: "array", items: { type: "string" } },
    };

    it("renders Add button for an empty array", () => {
        renderForm(arraySchema, { tags: [] });
        expect(screen.getByRole("button", { name: "Add item to tags" })).toBeInTheDocument();
    });

    it("calls onChange with one item when Add is clicked", () => {
        const onChange = renderForm(arraySchema, { tags: [] });
        fireEvent.click(screen.getByRole("button", { name: "Add item to tags" }));
        expect(onChange).toHaveBeenCalledWith({ tags: [""] });
    });

    it("calls onChange with two items when Add is clicked twice", () => {
        const onChange = renderForm(arraySchema, { tags: ["a"] });
        fireEvent.click(screen.getByRole("button", { name: "Add item to tags" }));
        expect(onChange).toHaveBeenCalledWith({ tags: ["a", ""] });
    });

    it("calls onChange with item removed when Remove is clicked", () => {
        const onChange = renderForm(arraySchema, { tags: ["a", "b"] });
        // Remove first item
        const removeButtons = screen.getAllByRole("button", { name: /Remove item/i });
        fireEvent.click(removeButtons[0]!);
        expect(onChange).toHaveBeenCalledWith({ tags: ["b"] });
    });

    it("calls onChange with second item removed", () => {
        const onChange = renderForm(arraySchema, { tags: ["a", "b"] });
        const removeButtons = screen.getAllByRole("button", { name: /Remove item/i });
        fireEvent.click(removeButtons[1]!);
        expect(onChange).toHaveBeenCalledWith({ tags: ["a"] });
    });

    it("calls onChange with updated item value when edited", () => {
        const onChange = renderForm(arraySchema, { tags: ["hello"] });
        const inputs = screen.getAllByRole("textbox");
        // The first textbox rendered in the array is the item input for [0]
        const itemInput = inputs.find((el) => el.getAttribute("aria-label") === "[0]");
        expect(itemInput).toBeDefined();
        fireEvent.change(itemInput!, { target: { value: "world" } });
        expect(onChange).toHaveBeenCalledWith({ tags: ["world"] });
    });

    it("adds default 0 for a numeric array item", () => {
        const numSchema: TopicSchema = { values: { type: "array", items: { type: "float64" } } };
        const onChange = renderForm(numSchema, { values: [] });
        fireEvent.click(screen.getByRole("button", { name: "Add item to values" }));
        expect(onChange).toHaveBeenCalledWith({ values: [0] });
    });
});

// =============================================================================
// Nested object field
// =============================================================================

describe("OperationRequestForm - nested object field", () => {
    const nestedSchema: TopicSchema = {
        pose: {
            type: "Pose",
            fields: {
                x: { type: "float64" },
                y: { type: "float64" },
            },
        },
    };

    it("renders labels for nested fields", () => {
        renderForm(nestedSchema, { pose: { x: 1, y: 2 } });
        expect(screen.getByText("x")).toBeInTheDocument();
        expect(screen.getByText("y")).toBeInTheDocument();
    });

    it("calls onChange with nested x updated when x field changes", () => {
        const onChange = renderForm(nestedSchema, { pose: { x: 0, y: 0 } });
        const xInput = screen.getByRole("textbox", { name: "pose.x" });
        fireEvent.change(xInput, { target: { value: "3" } });
        fireEvent.blur(xInput);
        expect(onChange).toHaveBeenCalledWith({ pose: { x: 3, y: 0 } });
    });

    it("calls onChange with nested y updated when y field changes", () => {
        const onChange = renderForm(nestedSchema, { pose: { x: 1, y: 0 } });
        const yInput = screen.getByRole("textbox", { name: "pose.y" });
        fireEvent.change(yInput, { target: { value: "5" } });
        fireEvent.blur(yInput);
        expect(onChange).toHaveBeenCalledWith({ pose: { x: 1, y: 5 } });
    });

    it("preserves sibling top-level fields when updating nested field", () => {
        const schema: TopicSchema = {
            name: { type: "string" },
            pose: {
                type: "Pose",
                fields: { x: { type: "float64" } },
            },
        };
        const onChange = renderForm(schema, { name: "robot", pose: { x: 0 } });
        const xInput = screen.getByRole("textbox", { name: "pose.x" });
        fireEvent.change(xInput, { target: { value: "7" } });
        fireEvent.blur(xInput);
        expect(onChange).toHaveBeenCalledWith({ name: "robot", pose: { x: 7 } });
    });

    it("can collapse and expand nested object with toggle button", () => {
        renderForm(nestedSchema, { pose: { x: 1, y: 2 } });
        // Initially expanded - inputs are visible
        expect(screen.getByRole("textbox", { name: "pose.x" })).toBeInTheDocument();
        // Click the collapse button for the pose field
        const collapseBtn = screen.getByRole("button", { name: "Collapse pose" });
        fireEvent.click(collapseBtn);
        // Now collapsed - inputs should be gone
        expect(screen.queryByRole("textbox", { name: "pose.x" })).not.toBeInTheDocument();
    });
});

// =============================================================================
// Mixed schema - multiple field types together
// =============================================================================

describe("OperationRequestForm - mixed schema", () => {
    const mixedSchema: TopicSchema = {
        label: { type: "string" },
        speed: { type: "float64" },
        enabled: { type: "bool" },
        tags: { type: "array", items: { type: "string" } },
    };
    const mixedValue = { label: "go", speed: 1.5, enabled: true, tags: [] };

    it("renders all field types without errors", () => {
        renderForm(mixedSchema, mixedValue);
        expect(screen.getByRole("textbox", { name: "label" })).toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: "speed" })).toBeInTheDocument();
        expect(screen.getByRole("switch", { name: "enabled" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add item to tags" })).toBeInTheDocument();
    });

    it("updating speed preserves label, enabled, tags", () => {
        const onChange = renderForm(mixedSchema, mixedValue);
        const speedInput = screen.getByRole("textbox", { name: "speed" });
        fireEvent.change(speedInput, { target: { value: "2.5" } });
        expect(onChange).toHaveBeenCalledWith({
            label: "go",
            speed: 2.5,
            enabled: true,
            tags: [],
        });
    });
});
