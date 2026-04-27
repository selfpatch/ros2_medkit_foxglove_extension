// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_CONNECTION,
    joinConnection,
    loadSharedConnection,
    onSharedConnectionChange,
    saveSharedConnection,
} from "./shared-connection";

describe("shared-connection", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it("loads defaults when localStorage is empty and no overrides", () => {
        expect(loadSharedConnection()).toEqual(DEFAULT_CONNECTION);
    });

    it("falls back to overrides when localStorage is empty", () => {
        const c = loadSharedConnection({ gatewayUrl: "http://override:9000" });
        expect(c.gatewayUrl).toBe("http://override:9000");
        expect(c.basePath).toBe(DEFAULT_CONNECTION.basePath);
    });

    it("prefers localStorage over overrides", () => {
        localStorage.setItem("selfpatch.gatewayUrl", "http://stored:8080");
        const c = loadSharedConnection({ gatewayUrl: "http://override:9000" });
        expect(c.gatewayUrl).toBe("http://stored:8080");
    });

    it("save writes both keys to localStorage", () => {
        saveSharedConnection({ gatewayUrl: "http://x:1234", basePath: "v2" });
        expect(localStorage.getItem("selfpatch.gatewayUrl")).toBe("http://x:1234");
        expect(localStorage.getItem("selfpatch.basePath")).toBe("v2");
    });

    it("save dispatches a same-tab change event", () => {
        const handler = vi.fn();
        const off = onSharedConnectionChange(handler);
        saveSharedConnection({ gatewayUrl: "http://y:5678", basePath: "api/v1" });
        expect(handler).toHaveBeenCalledWith({ gatewayUrl: "http://y:5678", basePath: "api/v1" });
        off();
    });

    it("unsubscribe removes the listener", () => {
        const handler = vi.fn();
        const off = onSharedConnectionChange(handler);
        off();
        saveSharedConnection({ gatewayUrl: "http://z:9999", basePath: "v" });
        expect(handler).not.toHaveBeenCalled();
    });

    it("joinConnection composes URL + base path with no double slashes", () => {
        expect(joinConnection({ gatewayUrl: "http://x:8080", basePath: "api/v1" })).toBe(
            "http://x:8080/api/v1",
        );
        expect(joinConnection({ gatewayUrl: "http://x:8080/", basePath: "/api/v1/" })).toBe(
            "http://x:8080/api/v1",
        );
        expect(joinConnection({ gatewayUrl: "http://x:8080", basePath: "" })).toBe("http://x:8080");
    });
});
