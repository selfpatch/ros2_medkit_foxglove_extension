// Copyright 2024-2026 bburda. Apache-2.0 license.

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
  OperationExecution,
  GatewayExecutionStatus,
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

export type { OperationExecution };

import { createGatewayClient, MedkitApiError, isMedkitError, normalizeBaseUrl } from "./gateway-client";
import type { MedkitClient } from "./gateway-client";
import { joinConnection } from "./shared-connection";
import { convertJsonSchemaToTopicSchema } from "./schema-utils";
import {
  getEntityData,
  getEntityDataItem,
  getEntityConfigurations,
  putEntityConfiguration,
  getEntityOperations,
  postEntityExecution,
  getExecution as dispatchGetExecution,
  cancelExecution as dispatchCancelExecution,
  getEntityFaults,
  deleteEntityFault,
  deleteAllEntityFaults,
  getEntityFault,
  getEntityBulkDataCategories,
  getEntityBulkDataDescriptors,
} from "./api-dispatch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap an openapi-fetch error value (GenericError schema or MedkitError at runtime) into a thrown Error. */
function throwApiError(error: unknown): never {
  if (isMedkitError(error)) throw new MedkitApiError(error);
  throw new Error(typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : String(error));
}

/** Extract the array from a gateway collection response.
 *
 * The gateway's collection endpoints are contractually `{items: [...]}`
 * (AreaList / ComponentList / FunctionList in the OpenAPI schema). The bare
 * `Array.isArray` branch is defensive only - kept so a non-conformant gateway
 * returning a raw array still yields a usable list rather than nothing. */
function unwrapItems<T>(response: unknown): T[] {
  if (Array.isArray(response)) return response as T[];
  const w = response as { items?: T[] };
  return w.items ?? [];
}

const GATEWAY_EXECUTION_STATUSES: ReadonlySet<GatewayExecutionStatus> = new Set([
  "pending",
  "running",
  "completed",
  "failed",
]);

/**
 * Narrow an untrusted wire status string to a known gateway execution status.
 * An unrecognized value falls back to "pending" (non-terminal) so the UI keeps
 * polling rather than silently treating an unknown state as terminal.
 */
function narrowExecutionStatus(raw: string): GatewayExecutionStatus {
  return GATEWAY_EXECUTION_STATUSES.has(raw as GatewayExecutionStatus)
    ? (raw as GatewayExecutionStatus)
    : "pending";
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class MedkitApiClient {
  private readonly resolvedBase: string;
  private readonly client: MedkitClient;

  constructor(serverUrl: string, baseEndpoint = "") {
    const conn = { gatewayUrl: serverUrl, basePath: baseEndpoint };
    // Resolve the base URL exactly as the typed client does internally
    // (joinConnection + normalizeBaseUrl, which forces a trailing /api/v1).
    // Bulk-data download URLs are built from this same value so they cannot
    // diverge from the client's request root for a non-default basePath.
    this.resolvedBase = normalizeBaseUrl(joinConnection(conn));
    this.client = createGatewayClient(conn);
  }

  // ── Health ────────────────────────────────────────────────────────

  async ping(): Promise<boolean> {
    try {
      const { error } = await this.client.GET("/health", {
        signal: AbortSignal.timeout(3000),
      });
      return !error;
    } catch {
      return false;
    }
  }

  async getVersionInfo(): Promise<VersionInfo> {
    const { data, error } = await this.client.GET("/version-info");
    if (error) throwApiError(error);
    // openapi-fetch leaves `data` undefined on a 2xx empty/204 body with no
    // error, but the return type promises a non-optional VersionInfo. Guard so
    // callers get a thrown error here instead of a TypeError at the access site.
    if (!data) throw new Error("Empty response from /version-info");
    return data;
  }

  // ── Entity tree ───────────────────────────────────────────────────

  async listAreas(): Promise<SovdEntity[]> {
    const { data, error } = await this.client.GET("/areas");
    if (error) throwApiError(error);
    const items = unwrapItems<{ id: string }>(data as unknown);
    return items.map((a) => ({
      id: a.id,
      name: a.id,
      type: "area",
      href: `/areas/${a.id}`,
      hasChildren: true,
    }));
  }

  /** Top-level component list - used as tree roots when /areas is empty.
   * In runtime_only mode without a manifest the gateway reports zero areas
   * but still exposes the host machine as a single Component (id = hostname,
   * via HostInfoProvider); it does NOT synthesize per-namespace components. */
  async listComponents(): Promise<SovdEntity[]> {
    const { data, error } = await this.client.GET("/components");
    if (error) throwApiError(error);
    const items = unwrapItems<{ id?: unknown; name?: string; description?: string }>(data as unknown);
    return items
      // Drop items without a string id, otherwise id:undefined produces a
      // bogus "/components/undefined" request when the node is expanded.
      .filter((c): c is { id: string; name?: string; description?: string } => typeof c.id === "string")
      .map((c) => ({
        id: c.id,
        // The host Component often comes back with name == id (a
        // hostname-derived hash like 'e9e6f682e4bf'). Use the description as
        // a friendlier label when present, else fall back to the id - the
        // list response is not guaranteed to carry a description.
        name: c.name && c.name !== c.id ? c.name : c.description || c.id,
        type: "component",
        href: `/components/${c.id}`,
        hasChildren: true,
      }));
  }

  async listAreaComponents(areaId: string): Promise<SovdEntity[]> {
    const { data, error } = await this.client.GET("/areas/{area_id}/components", {
      params: { path: { area_id: areaId } },
    });
    if (error) throwApiError(error);
    const items = unwrapItems<{ id: string; fqn?: string }>(data as unknown);
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
    const { data, error } = await this.client.GET("/components/{component_id}/hosts", {
      params: { path: { component_id: componentId } },
    });
    if (error) throwApiError(error);
    const items = unwrapItems<ApiApp>(data as unknown);
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
    const { data, error } = await this.client.GET("/functions");
    if (error) throwApiError(error);
    const items = unwrapItems<{ id: string; name: string; description?: string }>(data as unknown);
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
    const { data, error } = await getEntityData(this.client, entityType, entityId);
    if (error) throwApiError(error);
    const items = unwrapItems<DataItem>(data as unknown);
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
    const { data, error } = await getEntityDataItem(this.client, entityType, entityId, topicName);
    if (error) throwApiError(error);
    const item = data as unknown as Resp;
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
    const { data, error } = await getEntityConfigurations(this.client, entityType, entityId);
    if (error) throwApiError(error);
    const raw = data as unknown as {
      "x-medkit"?: {
        entity_id?: string;
        ros2?: { node?: string };
        parameters?: Parameter[];
      };
    };
    const xm = raw["x-medkit"] || {};
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
    const { error } = await putEntityConfiguration(
      this.client,
      entityType,
      entityId,
      paramName,
      { data: value },
    );
    if (error) throwApiError(error);
  }

  // ── Operations ────────────────────────────────────────────────────

  async listOperations(
    entityType: SovdResourceEntityType,
    entityId: string,
  ): Promise<Operation[]> {
    interface RawOpTypeInfo {
      request?: unknown;
      response?: unknown;
      goal?: unknown;
      result?: unknown;
      feedback?: unknown;
    }
    interface RawOp {
      id: string;
      name: string;
      asynchronous_execution?: boolean;
      "x-medkit"?: {
        ros2?: { kind?: "service" | "action"; service?: string; action?: string; type?: string };
        type_info?: RawOpTypeInfo;
      };
    }
    const { data, error } = await getEntityOperations(this.client, entityType, entityId);
    if (error) throwApiError(error);
    const items = unwrapItems<RawOp>(data as unknown);
    return items.map((op) => {
      const xm = op["x-medkit"];
      const r = xm?.ros2;
      let kind: "service" | "action" = "service";
      if (r?.kind) kind = r.kind;
      else if (op.asynchronous_execution) kind = "action";

      // Extract input schema from x-medkit.type_info, porting web_ui transforms.ts logic.
      // Services expose request schema; actions expose goal schema.
      let type_info: Operation["type_info"];
      const rawTypeInfo = xm?.type_info;
      if (rawTypeInfo) {
        if (kind === "service" && rawTypeInfo.request) {
          const schema = convertJsonSchemaToTopicSchema(rawTypeInfo.request);
          if (schema) type_info = { schema };
        } else if (kind === "action" && rawTypeInfo.goal) {
          const schema = convertJsonSchemaToTopicSchema(rawTypeInfo.goal);
          if (schema) type_info = { schema };
        }
      }

      return {
        name: op.name || op.id,
        path: r?.service || r?.action || `/${op.name}`,
        type: r?.type || "",
        kind,
        type_info,
      };
    });
  }

  async createExecution(
    entityType: SovdResourceEntityType,
    entityId: string,
    operationName: string,
    request: CreateExecutionRequest,
  ): Promise<CreateExecutionResponse> {
    const { data, error } = await postEntityExecution(
      this.client,
      entityType,
      entityId,
      operationName,
      request,
    );
    if (error) throwApiError(error);
    // Response intentionally flattens 200 (sync result) and 202 (async created)
    // into CreateExecutionResponse - callers do not disambiguate the two branches.
    return data as unknown as CreateExecutionResponse;
  }

  async getExecution(
    entityType: SovdResourceEntityType,
    entityId: string,
    operationName: string,
    executionId: string,
  ): Promise<OperationExecution> {
    const { data, error } = await dispatchGetExecution(
      this.client,
      entityType,
      entityId,
      operationName,
      executionId,
    );
    if (error) throwApiError(error);
    const raw = data as unknown as { id?: string | null; status: string; parameters?: unknown | null; "x-medkit"?: { ros2_status?: string | null } | null };
    return {
      id: raw.id,
      status: narrowExecutionStatus(raw.status),
      parameters: raw.parameters,
      ros2_status: raw["x-medkit"]?.ros2_status,
    };
  }

  async cancelExecution(
    entityType: SovdResourceEntityType,
    entityId: string,
    operationName: string,
    executionId: string,
  ): Promise<void> {
    const { error } = await dispatchCancelExecution(
      this.client,
      entityType,
      entityId,
      operationName,
      executionId,
    );
    if (error) throwApiError(error);
  }

  // ── Faults ────────────────────────────────────────────────────────

  async listAllFaults(): Promise<ListFaultsResponse> {
    const { data, error } = await this.client.GET("/faults");
    if (error) throwApiError(error);
    const raw = data as unknown as { items?: unknown[]; "x-medkit"?: { count?: number } };
    const items = (raw.items || []).map((f) => this.transformFault(f));
    return { items, count: raw["x-medkit"]?.count || items.length };
  }

  async listEntityFaults(
    entityType: SovdResourceEntityType,
    entityId: string,
  ): Promise<ListFaultsResponse> {
    const { data, error } = await getEntityFaults(this.client, entityType, entityId);
    if (error) throwApiError(error);
    const raw = data as unknown as { items?: unknown[]; "x-medkit"?: { count?: number } };
    const items = (raw.items || []).map((f) => this.transformFault(f));
    return { items, count: raw["x-medkit"]?.count || items.length };
  }

  async clearFault(
    entityType: SovdResourceEntityType,
    entityId: string,
    faultCode: string,
  ): Promise<void> {
    const { error } = await deleteEntityFault(this.client, entityType, entityId, faultCode);
    if (error) throwApiError(error);
  }

  async clearAllFaults(
    entityType: SovdResourceEntityType,
    entityId: string,
  ): Promise<void> {
    const { error } = await deleteAllEntityFaults(this.client, entityType, entityId);
    if (error) throwApiError(error);
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
    const { data, error } = await getEntityFault(this.client, entityType, entityId, faultCode);
    if (error) throwApiError(error);
    // The schema uses an open-form response object; cast through unknown to
    // our local FaultResponse type which maps the wire shape exactly.
    return data as unknown as FaultResponse;
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
      const { data, error } = await getEntityBulkDataCategories(this.client, entityType, entityId);
      if (error) throwApiError(error);
      return data as unknown as BulkDataCategory;
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
      const { data, error } = await getEntityBulkDataDescriptors(
        this.client,
        entityType,
        entityId,
        category,
      );
      if (error) throwApiError(error);
      return data as unknown as BulkDataList;
    } catch {
      return { items: [] };
    }
  }

  /**
   * Build download URL for a bulk data URI (as returned in snapshot bulk_data_uri).
   */
  getBulkDataDownloadUrl(bulkDataUri: string): string {
    // bulkDataUri is an absolute path like "/apps/motor/bulk-data/rosbags/FAULT_CODE".
    // Strip the leading slash and join onto the same resolved base the typed
    // client uses, so the download root always matches the API request root.
    return `${this.resolvedBase}/${bulkDataUri.replace(/^\//, "")}`;
  }

  /**
   * Subscribe to the fault SSE stream.
   *
   * Backed by the typed client's `SseStream` (async-iterable) rather than a raw
   * `EventSource`. Auto-reconnect IS preserved - the stream reconnects
   * internally with backoff up to `maxRetries`. Two behavior deltas vs a bare
   * `EventSource` remain and are intentional:
   *  - `onError` fires only after retries are exhausted, not on every transient
   *    drop (a brief reconnect no longer surfaces an error to the dashboard).
   *  - A clean server-side close ends the `for await` loop silently with no
   *    reconnect (a bare `EventSource` would have reconnected). The gateway
   *    keeps the stream open indefinitely, so this only happens on a deliberate
   *    server close; callers wanting unconditional reconnect must re-subscribe.
   */
  subscribeFaultStream(
    onConfirmed: (f: Fault) => void,
    onCleared: (f: Fault) => void,
    onError?: (e: Error) => void,
  ): () => void {
    let unsubscribed = false;
    const stream = this.client.streams.faults();

    const parseFaultData = (data: unknown): Fault | null => {
      try {
        if (data === null || typeof data !== "object") {
          throw new TypeError("Unexpected non-object fault event data");
        }
        const raw = data as Record<string, unknown>;
        const fd = (raw.fault as Record<string, unknown> | undefined) ?? raw;
        if (typeof fd === "object" && fd !== null && "fault_code" in fd) return this.transformFault(fd);
        return fd as unknown as Fault;
      } catch {
        if (!unsubscribed) onError?.(new Error("Failed to parse fault event"));
        return null;
      }
    };

    void (async () => {
      try {
        for await (const event of stream) {
          if (unsubscribed) break;
          const f = parseFaultData(event.data);
          if (!f) continue;
          if (event.event === "fault_confirmed") {
            if (!unsubscribed) onConfirmed(f);
          } else if (event.event === "fault_cleared") {
            if (!unsubscribed) onCleared(f);
          } else if (event.event === "message" || event.event === "") {
            if (!unsubscribed) onConfirmed(f);
          }
        }
      } catch (err) {
        if (!unsubscribed) {
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();

    return () => {
      unsubscribed = true;
      stream.close();
    };
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
