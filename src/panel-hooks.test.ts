// Copyright 2024-2026 bburda. Apache-2.0 license.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useDialogA11y, useSharedConnection } from "./panel-hooks";
import { saveSharedConnection } from "./shared-connection";

describe("useSharedConnection", () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it("initialises from localStorage > overrides > defaults", () => {
        localStorage.setItem("selfpatch.gatewayUrl", "http://stored:8080");
        const { result } = renderHook(() => useSharedConnection({ gatewayUrl: "http://override:9000" }));
        expect(result.current.conn.gatewayUrl).toBe("http://stored:8080");
    });

    it("update() persists and exposes the new value on next render", () => {
        const { result } = renderHook(() => useSharedConnection());
        act(() => {
            result.current.update({ gatewayUrl: "http://new:1234", basePath: "v9" });
        });
        expect(result.current.conn).toEqual({ gatewayUrl: "http://new:1234", basePath: "v9" });
        expect(localStorage.getItem("selfpatch.gatewayUrl")).toBe("http://new:1234");
        expect(localStorage.getItem("selfpatch.basePath")).toBe("v9");
    });

    it("picks up changes broadcast by another panel", () => {
        const { result } = renderHook(() => useSharedConnection());
        act(() => {
            saveSharedConnection({ gatewayUrl: "http://peer:5000", basePath: "api/v1" });
        });
        expect(result.current.conn.gatewayUrl).toBe("http://peer:5000");
    });
});

describe("useDialogA11y", () => {
    it("calls onClose on Escape while active", () => {
        const onClose = vi.fn();
        renderHook(() => useDialogA11y(true, onClose));
        act(() => {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("ignores Escape while inactive", () => {
        const onClose = vi.fn();
        renderHook(() => useDialogA11y(false, onClose));
        act(() => {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        });
        expect(onClose).not.toHaveBeenCalled();
    });
});
