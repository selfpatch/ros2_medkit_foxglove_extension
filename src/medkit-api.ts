// Copyright 2024–2026 Selfpatch GmbH. Apache-2.0 license.

/**
 * HTTP API client for the ros2_medkit gateway.
 * Simplified port of sovd_web_ui for use inside Foxglove extensions.
 */

import type {
  SovdEntity,
  SovdResourceEntityType,
  ComponentTopic,
  ComponentConfigurations,
  Parameter,
  Operation,
  CreateExecutionRequest,
  CreateExecutionResponse,
  Fault,
  FaultSeverity,
  FaultStatus,
  ListFaultsResponse,
  App,
  VersionInfo,
  FaultResponse,
  BulkDataCategory,
  BulkDataList,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeUrl(url: string): string {
  let u = url.trim();
  if (u.endsWith("/")) u = u.slice(0, -1);
  if (!u.startsWith("http://") && !u.startsWith("https://")) u = `http://${u}`;
  return u;
}

function normalizeBasePath(path: string): string {
  let p = path.trim();
  while (p.startsWith("/")) p = p.slice(1);
  while (p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/**
 * Error thrown by MedkitApiClient on a non-2xx HTTP response. Carries
 * the status code so callers can branch (e.g. 404 = "no /logs endpoint
 * for this entity" vs 503 = "feature unavailable" vs other failures).
 */
export class MedkitApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "MedkitApiError";
  }
}

async function fetchJSON<T>(url: string, init?: RequestInit, timeout = 10_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new MedkitApiError(`HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError")
      throw new MedkitApiError("Request timeout", 0);
    throw err;
  }
}

function unwrapItems<T>(response: unknown): T[] {
  if (Array.isArray(response)) return response as T[];
  const w = response as { items?: T[] };
  return w.items ?? [];
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class MedkitApiClient {
  private readonly base: string;
  private readonly prefix: string;

  constructor(serverUrl: string, baseEndpoint = "") {
    this.base = normalizeUrl(serverUrl);
    this.prefix = normalizeBasePath(baseEndpoint);
  }

  private url(endpoint: string): string {
    const p = this.prefix ? `${this.prefix}/` : "";
    return `${this.base}/${p}${endpoint}`;
  }

  // ── Health ────────────────────────────────────────────────────────

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(this.url("health"), {
        signal: AbortSignal.timeout(3_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getVersionInfo(): Promise<VersionInfo> {
    return fetchJSON<VersionInfo>(this.url("version-info"));
  }

  // ── Entity tree ───────────────────────────────────────────────────

  async listAreas(): Promise<SovdEntity[]> {
    const raw = await fetchJSON<unknown>(this.url("areas"));
    const items = Array.isArray(raw) ? raw : ((raw as Record<string, unknown>).areas ?? (raw as Record<string, unknown>).items ?? []) as Array<{ id: string }>;
    return items.map((a) => ({
      id: a.id,
      name: a.id,
      type: "area",
      href: `/areas/${a.id}`,
      hasChildren: true,
    }));
  }

  /** Top-level component list - used as tree roots when /areas is empty
   * (gateway running in runtime_only mode without a manifest still
   * discovers synthetic components per ROS namespace). */
  async listComponents(): Promise<SovdEntity[]> {
    const raw = await fetchJSON<unknown>(this.url("components"));
    const items = (Array.isArray(raw)
      ? raw
      : ((raw as Record<string, unknown>).items ?? [])) as Array<{
        id: string;
        name?: string;
        description?: string;
      }>;
    return items.map((c) => ({
      id: c.id,
      // Auto-discovered components come back with name == id (a
      // hostname-derived hash like 'e9e6f682e4bf'). Prefer the human-
      // readable description when the name is just the id.
      name: c.name && c.name !== c.id ? c.name : c.description || c.id,
      type: "component",
      href: `/components/${c.id}`,
      hasChildren: true,
    }));
  }

  async listAreaComponents(areaId: string): Promise<SovdEntity[]> {
    const raw = await fetchJSON<unknown>(this.url(`areas/${areaId}/components`));
    const items = Array.isArray(raw) ? raw : ((raw as Record<string, unknown>).components ?? (raw as Record<string, unknown>).items ?? []) as Array<{ id: string; fqn?: string }>;
    return items.map((c) => ({
      id: c.id,
      name: c.fqn || c.id,
      type: "component",
      href: `/${areaId}/${c.id}`,
      hasChildren: true,
    }));
  }

  async listComponentApps(componentId: string): Promise<App[]> {
    interface ApiApp {
      id: string;
      name: string;
      href?: string;
      "x-medkit"?: { ros2?: { node?: string }; component_id?: string };
    }
    const items = unwrapItems<ApiApp>(
      await fetchJSON<unknown>(this.url(`components/${componentId}/hosts`))
    );
    return items.map((item) => {
      const nodePath = item["x-medkit"]?.ros2?.node || `/${item.name}`;
      const lastSlash = nodePath.lastIndexOf("/");
      return {
        id: item.id,
        name: item.name,
        type: "app",
        href: item.href || `/api/v1/apps/${item.id}`,
        hasChildren: false,
        node_name: lastSlash >= 0 ? nodePath.substring(lastSlash + 1) : item.name,
        namespace: lastSlash > 0 ? nodePath.substring(0, lastSlash) : "/",
        fqn: nodePath,
        component_id: componentId,
      };
    });
  }

  async listFunctions(): Promise<SovdEntity[]> {
    const items = unwrapItems<{ id: string; name: string; description?: string }>(
      await fetchJSON<unknown>(this.url("functions"))
    );
    return items.map((f) => ({
      id: f.id,
      name: f.name || f.id,
      type: "function",
      href: `/functions/${f.id}`,
      hasChildren: false,
    }));
  }

  // ── Data (Topics) ─────────────────────────────────────────────────

  async listEntityData(
    entityType: SovdResourceEntityType,
    entityId: string,
  ): Promise<ComponentTopic[]> {
    interface DataItem {
      id: string;
      name: string;
      "x-medkit"?: {
        ros2?: { topic?: string; type?: string; direction?: string };
        type_info?: { schema?: unknown };
      };
    }
    const items = unwrapItems<DataItem>(
      await fetchJSON<unknown>(this.url(`${entityType}/${entityId}/data`))
    );
    return items.map((item) => {
      const direction = item["x-medkit"]?.ros2?.direction;
      return {
        topic: item.name || item["x-medkit"]?.ros2?.topic || item.id,
        timestamp: Date.now() * 1_000_000,
        data: null,
        status: "metadata_only" as const,
        type: item["x-medkit"]?.ros2?.type,
        isPublisher: direction === "publish" || direction === "both",
        isSubscriber: direction === "subscribe" || direction === "both",
      };
    });
  }

  async getTopicData(
    entityType: SovdResourceEntityType,
    entityId: string,
    topicName: string,
  ): Promise<ComponentTopic> {
    interface Resp {
      data: unknown;
      id: string;
      "x-medkit"?: {
        ros2?: { type?: string; topic?: string; direction?: string };
        timestamp?: number;
        status?: string;
        publisher_count?: number;
        subscriber_count?: number;
      };
    }
    const item = await fetchJSON<Resp>(
      this.url(`${entityType}/${entityId}/data/${encodeURIComponent(topicName)}`)
    );
    const r = item["x-medkit"]?.ros2;
    return {
      topic: r?.topic || topicName,
      timestamp: item["x-medkit"]?.timestamp || Date.now() * 1_000_000,
      data: item.data,
      status: (item["x-medkit"]?.status as "data" | "metadata_only") || "data",
      type: r?.type,
      publisher_count: item["x-medkit"]?.publisher_count,
      subscriber_count: item["x-medkit"]?.subscriber_count,
      isPublisher: r?.direction === "publish" || r?.direction === "both",
      isSubscriber: r?.direction === "subscribe" || r?.direction === "both",
    };
  }

  // ── Configurations ────────────────────────────────────────────────

  async listConfigurations(
    entityType: SovdResourceEntityType,
    entityId: string,
  ): Promise<ComponentConfigurations> {
    const raw = await fetchJSON<unknown>(
      this.url(`${entityType}/${entityId}/configurations`)
    );
    const data = raw as {
      "x-medkit"?: {
        entity_id?: string;
        ros2?: { node?: string };
        parameters?: Parameter[];
      };
    };
    const xm = data["x-medkit"] || {};
    return {
      component_id: xm.entity_id || entityId,
      node_name: xm.ros2?.node || entityId,
      parameters: xm.parameters || [],
    };
  }

  async setConfiguration(
    entityType: SovdResourceEntityType,
    entityId: string,
    paramName: string,
    value: unknown,
  ): Promise<void> {
    await fetchJSON(
      this.url(`${entityType}/${entityId}/configurations/${encodeURIComponent(paramName)}`),
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: value }),
      }
    );
  }

  // ── Operations ────────────────────────────────────────────────────

  async listOperations(
    entityType: SovdResourceEntityType,
    entityId: string,
  ): Promise<Operation[]> {
    interface RawOp {
      id: string;
      name: string;
      asynchronous_execution?: boolean;
      "x-medkit"?: {
        ros2?: { kind?: "service" | "action"; service?: string; action?: string; type?: string };
        type_info?: import("./types").OperationTypeInfo;
      };
    }
    const items = unwrapItems<RawOp>(
      await fetchJSON<unknown>(this.url(`${entityType}/${entityId}/operations`))
    );
    return items.map((op) => {
      const r = op["x-medkit"]?.ros2;
      let kind: "service" | "action" = "service";
      if (r?.kind) kind = r.kind;
      else if (op.asynchronous_execution) kind = "action";
      return {
        name: op.name || op.id,
        path: r?.service || r?.action || `/${op.name}`,
        type: r?.type || "",
        kind,
        typeInfo: op["x-medkit"]?.type_info,
      };
    });
  }

  async createExecution(
    entityType: SovdResourceEntityType,
    entityId: string,
    operationName: string,
    request: CreateExecutionRequest,
  ): Promise<CreateExecutionResponse> {
    return fetchJSON<CreateExecutionResponse>(
      this.url(
        `${entityType}/${entityId}/operations/${encodeURIComponent(operationName)}/executions`
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
      30_000
    );
  }

  // Poll an action / async-service execution to terminal state. Returns
  // the latest snapshot (CreateExecutionResponse shape - the gateway
  // reuses it for GET responses on the same path).
  async getExecution(
    entityType: SovdResourceEntityType,
    entityId: string,
    operationName: string,
    executionId: string,
  ): Promise<CreateExecutionResponse> {
    return fetchJSON<CreateExecutionResponse>(
      this.url(
        `${entityType}/${entityId}/operations/${encodeURIComponent(operationName)}/executions/${encodeURIComponent(executionId)}`
      )
    );
  }

  async cancelExecution(
    entityType: SovdResourceEntityType,
    entityId: string,
    operationName: string,
    executionId: string,
  ): Promise<void> {
    await fetchJSON(
      this.url(
        `${entityType}/${entityId}/operations/${encodeURIComponent(operationName)}/executions/${encodeURIComponent(executionId)}`
      ),
      { method: "DELETE" }
    );
  }

  // ── Logs ──────────────────────────────────────────────────────────

  async listLogs(
    entityType: SovdResourceEntityType,
    entityId: string,
    params: import("./types").ListLogsParams = {},
  ): Promise<import("./types").LogEntry[]> {
    const qs = new URLSearchParams();
    if (params.severity) qs.set("severity", params.severity);
    if (params.limit != null) qs.set("limit", String(params.limit));
    if (params.context) qs.set("context", params.context);
    const path = `${entityType}/${entityId}/logs${qs.toString() ? `?${qs}` : ""}`;
    return unwrapItems<import("./types").LogEntry>(
      await fetchJSON<unknown>(this.url(path))
    );
  }

  // ── Faults ────────────────────────────────────────────────────────

  async listAllFaults(): Promise<ListFaultsResponse> {
    const raw = await fetchJSON<unknown>(this.url("faults"));
    const data = raw as { items?: unknown[]; "x-medkit"?: { count?: number } };
    const items = (data.items || []).map((f) => this.transformFault(f));
    return { items, count: data["x-medkit"]?.count || items.length };
  }

  async listEntityFaults(
    entityType: SovdResourceEntityType,
    entityId: string,
  ): Promise<ListFaultsResponse> {
    const raw = await fetchJSON<unknown>(
      this.url(`${entityType}/${entityId}/faults`)
    );
    const data = raw as { items?: unknown[]; "x-medkit"?: { count?: number } };
    const items = (data.items || []).map((f) => this.transformFault(f));
    return { items, count: data["x-medkit"]?.count || items.length };
  }

  async clearFault(
    entityType: SovdResourceEntityType,
    entityId: string,
    faultCode: string,
  ): Promise<void> {
    const res = await fetch(
      this.url(`${entityType}/${entityId}/faults/${encodeURIComponent(faultCode)}`),
      { method: "DELETE" }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async clearAllFaults(
    entityType: SovdResourceEntityType,
    entityId: string,
  ): Promise<void> {
    const res = await fetch(this.url(`${entityType}/${entityId}/faults`), {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  // ── Fault SSE stream ──────────────────────────────────────────────

  /**
   * Get fault details with environment data (snapshots) for a specific entity fault.
   */
  async getFaultWithEnvironmentData(
    entityType: SovdResourceEntityType,
    entityId: string,
    faultCode: string,
  ): Promise<FaultResponse> {
    return fetchJSON<FaultResponse>(
      this.url(`${entityType}/${entityId}/faults/${encodeURIComponent(faultCode)}`),
    );
  }

  // ── Bulk Data ─────────────────────────────────────────────────────

  /**
   * List bulk-data categories for an entity (e.g., ['rosbags']).
   */
  async listBulkDataCategories(
    entityType: SovdResourceEntityType,
    entityId: string,
  ): Promise<BulkDataCategory> {
    try {
      return await fetchJSON<BulkDataCategory>(
        this.url(`${entityType}/${entityId}/bulk-data`),
      );
    } catch {
      return { items: [] };
    }
  }

  /**
   * List bulk-data items in a category.
   */
  async listBulkData(
    entityType: SovdResourceEntityType,
    entityId: string,
    category: string,
  ): Promise<BulkDataList> {
    try {
      return await fetchJSON<BulkDataList>(
        this.url(`${entityType}/${entityId}/bulk-data/${encodeURIComponent(category)}`),
      );
    } catch {
      return { items: [] };
    }
  }

  /**
   * Build download URL for a bulk data URI (as returned in snapshot bulk_data_uri).
   */
  getBulkDataDownloadUrl(bulkDataUri: string): string {
    // bulkDataUri is an absolute path like "/apps/motor/bulk-data/rosbags/FAULT_CODE"
    // Strip leading slash to make it a relative endpoint for url()
    return this.url(bulkDataUri.replace(/^\//, ""));
  }

  subscribeFaultStream(
    onConfirmed: (f: Fault) => void,
    onCleared: (f: Fault) => void,
    onError?: (e: Error) => void,
  ): () => void {
    const es = new EventSource(this.url("faults/stream"));
    const parse = (ev: MessageEvent): Fault | null => {
      try {
        const raw = JSON.parse(ev.data);
        const fd = raw.fault || raw;
        if ("fault_code" in fd) return this.transformFault(fd);
        return fd as Fault;
      } catch {
        onError?.(new Error("Failed to parse fault event"));
        return null;
      }
    };
    es.addEventListener("fault_confirmed", (ev: MessageEvent) => {
      const f = parse(ev);
      if (f) onConfirmed(f);
    });
    es.addEventListener("fault_cleared", (ev: MessageEvent) => {
      const f = parse(ev);
      if (f) onCleared(f);
    });
    es.onmessage = (ev) => {
      const f = parse(ev);
      if (f) onConfirmed(f);
    };
    es.onerror = () => onError?.(new Error("Fault stream connection error"));
    return () => es.close();
  }

  // ── Private helpers ───────────────────────────────────────────────

  private transformFault(raw: unknown): Fault {
    const f = raw as {
      fault_code: string;
      description: string;
      severity: number;
      severity_label: string;
      status: string;
      first_occurred: number;
      last_occurred?: number;
      occurrence_count?: number;
      reporting_sources?: string[];
    };
    let severity: FaultSeverity = "info";
    const label = f.severity_label?.toLowerCase() || "";
    if (label === "critical" || f.severity >= 3) severity = "critical";
    else if (label === "error" || f.severity === 2) severity = "error";
    else if (label === "warn" || label === "warning" || f.severity === 1) severity = "warning";

    let status: FaultStatus = "active";
    const s = f.status?.toLowerCase() || "";
    if (s === "pending") status = "pending";
    else if (s === "cleared" || s === "resolved") status = "cleared";

    const source = f.reporting_sources?.[0] || "";
    const nodeName = source.split("/").pop() || "unknown";
    const entityId = nodeName.replace(/_/g, "-");

    return {
      code: f.fault_code,
      message: f.description,
      severity,
      status,
      timestamp: new Date(f.first_occurred * 1000).toISOString(),
      entity_id: entityId,
      entity_type: "app",
      parameters: {
        occurrence_count: f.occurrence_count,
        last_occurred: f.last_occurred,
        reporting_sources: f.reporting_sources,
      },
    };
  }
}
