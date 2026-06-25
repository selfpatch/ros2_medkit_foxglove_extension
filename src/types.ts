// Copyright 2024-2026 bburda. Apache-2.0 license.

/**
 * SOVD types for the ros2_medkit gateway API.
 * Derived from sovd_web_ui — simplified for Foxglove panels.
 */

import type { TopicSchema } from "./schema-utils";

// =============================================================================
// Entity Types
// =============================================================================

export type SovdResourceEntityType = "areas" | "components" | "apps" | "functions";

export interface SovdEntity {
  id: string;
  name: string;
  type: string;
  href: string;
  hasChildren?: boolean;
}

// =============================================================================
// Topic / Data
// =============================================================================

export interface ComponentTopic {
  topic: string;
  timestamp: number;
  data: unknown;
  status?: "data" | "metadata_only";
  type?: string;
  publisher_count?: number;
  subscriber_count?: number;
  isPublisher?: boolean;
  isSubscriber?: boolean;
}

// =============================================================================
// Configurations (ROS 2 Parameters)
// =============================================================================

export type ParameterType =
  | "bool"
  | "int"
  | "double"
  | "string"
  | "byte_array"
  | "bool_array"
  | "int_array"
  | "double_array"
  | "string_array";

export interface Parameter {
  name: string;
  value: unknown;
  type: ParameterType;
  description?: string;
  read_only?: boolean;
}

export interface ComponentConfigurations {
  component_id: string;
  node_name: string;
  parameters: Parameter[];
}

// =============================================================================
// Operations (ROS 2 Services & Actions)
// =============================================================================

export type OperationKind = "service" | "action";

export interface OperationTypeInfo {
  /** Converted input schema for the operation (request fields for a service,
   *  goal fields for an action). Populated from x-medkit.type_info via
   *  convertJsonSchemaToTopicSchema; absent when the gateway omits type_info.
   *  Simplified vs web_ui: stores ONLY the input sub-schema as a flat TopicSchema,
   *  not the full ServiceSchema/ActionSchema envelope. */
  schema?: TopicSchema;
}

export interface Operation {
  name: string;
  path: string;
  type: string;
  kind: OperationKind;
  type_info?: OperationTypeInfo;
}

export interface CreateExecutionRequest {
  type?: string;
  request?: unknown;
  goal?: unknown;
  parameters?: unknown;
}

/**
 * Status of a create-execution response. A synchronous service (200) returns
 * only `{parameters}` with no status field. An asynchronous action (202)
 * returns `{id, status:"running"}` - the gateway emits "running" even for a
 * freshly accepted goal and never emits the SOVD "accepted" alias.
 */
export type CreateExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface CreateExecutionResponse {
  id?: string;
  // Optional: a synchronous service response carries neither status nor kind -
  // only `parameters`. Present for an async action (202), which returns
  // status:"running".
  status?: CreateExecutionStatus;
  kind?: OperationKind;
  result?: unknown;
  parameters?: unknown;
  error?: string;
}

/**
 * Execution state polled via GET .../executions/{execution_id}.
 *
 * Schema fields: id?, status, capability?, parameters?, "x-medkit"?(goal_id, ros2_status).
 * There is no distinct `feedback` field in the schema. We map:
 *   - `parameters` as both live feedback (while running) and result (when terminal).
 *   - `ros2_status` from x-medkit as supplemental info.
 */
/** The execution status values the gateway emits over the wire. */
export type GatewayExecutionStatus = "pending" | "running" | "completed" | "failed";

/**
 * Execution status as the UI tracks it. `canceled` is a client-only terminal
 * state set after a successful DELETE; the gateway never emits it on the wire.
 */
export type ExecutionStatus = GatewayExecutionStatus | "canceled";

export interface OperationExecution {
  id?: string | null;
  status: ExecutionStatus;
  parameters?: unknown | null;
  ros2_status?: string | null;
}

// =============================================================================
// Faults
// =============================================================================

export type FaultSeverity = "info" | "warning" | "error" | "critical";
export type FaultStatus = "active" | "pending" | "cleared";

export interface Fault {
  code: string;
  message: string;
  severity: FaultSeverity;
  status: FaultStatus;
  timestamp: string;
  entity_id: string;
  entity_type: string;
  parameters?: Record<string, unknown>;
}

export interface ListFaultsResponse {
  items: Fault[];
  count: number;
}

// =============================================================================
// Apps
// =============================================================================

export interface App extends SovdEntity {
  node_name: string;
  namespace: string;
  fqn: string;
  component_id?: string;
}

// =============================================================================
// Snapshots & Environment Data
// =============================================================================

export interface SnapshotBase {
  type: "freeze_frame" | "rosbag";
  name: string;
}

export interface FreezeFrameSnapshot extends SnapshotBase {
  type: "freeze_frame";
  data: unknown;
  "x-medkit"?: {
    topic: string;
    message_type: string;
    full_data: unknown;
    captured_at: string;
    parse_error?: string;
  };
}

export interface RosbagSnapshot extends SnapshotBase {
  type: "rosbag";
  bulk_data_uri: string;
  size_bytes: number;
  duration_sec: number;
  format: "mcap" | "sqlite3" | "db3";
  "x-medkit"?: {
    captured_at: string;
    fault_code: string;
  };
}

export type Snapshot = FreezeFrameSnapshot | RosbagSnapshot;

export function isFreezeFrameSnapshot(s: Snapshot): s is FreezeFrameSnapshot {
  return s.type === "freeze_frame";
}

export function isRosbagSnapshot(s: Snapshot): s is RosbagSnapshot {
  return s.type === "rosbag";
}

export interface ExtendedDataRecords {
  first_occurrence: string;
  last_occurrence: string;
}

export interface EnvironmentData {
  extended_data_records: ExtendedDataRecords;
  snapshots: Snapshot[];
}

export interface SovdFaultStatus {
  aggregatedStatus: "active" | "passive" | "cleared";
  testFailed: "0" | "1";
  confirmedDTC: "0" | "1";
  pendingDTC: "0" | "1";
}

export interface FaultItem {
  code: string;
  fault_name: string;
  severity: number;
  status: SovdFaultStatus;
}

export interface FaultExtensions {
  occurrence_count: number;
  reporting_sources: string[];
  severity_label: string;
}

export interface FaultResponse {
  item: FaultItem;
  environment_data: EnvironmentData;
  "x-medkit"?: FaultExtensions;
}

// =============================================================================
// Bulk Data
// =============================================================================

export interface BulkDataCategory {
  items: string[];
}

export interface BulkDataDescriptor {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  creation_date: string;
  "x-medkit"?: {
    fault_code: string;
    duration_sec: number;
    format: string;
  };
}

export interface BulkDataList {
  items: BulkDataDescriptor[];
}

// =============================================================================
// Logs
// =============================================================================

export type LogSeverity = "debug" | "info" | "warning" | "error" | "fatal";

/** Source location carried per log entry under context. */
export interface LogContext {
  /** Logger FQN, e.g. "powertrain/engine/temp_sensor" */
  node: string;
  file?: string | null;
  function?: string | null;
  line?: number | null;
}

/**
 * Single log entry as returned by GET .../logs.
 * Schema: LogEntry { id, timestamp (ISO 8601), severity (string), message, context? }
 */
export interface LogEntry {
  id: string;
  timestamp: string;
  severity: LogSeverity;
  message: string;
  context: LogContext;
}

/**
 * Aggregation metadata carried in the x-medkit field of a LogEntryList response.
 * Populated by area/component/function log aggregation in the gateway.
 */
export interface LogListXMedkit {
  entity_id?: string | null;
  aggregation_level?: "function" | "area" | "component" | null;
  aggregated?: boolean | null;
  aggregation_sources?: string[] | null;
  host_count?: number | null;
  component_count?: number | null;
  app_count?: number | null;
  partial?: boolean | null;
  contributors?: string[] | null;
  failed_peers?: string[] | null;
  peer_dropped_items?: number | null;
}

/**
 * Log configuration for an entity (GET/PUT .../logs/configuration).
 *
 * The OpenAPI schema marks `max_entries` as nullable, but the gateway's cap is a
 * non-nullable size_t: GET always returns a number, a value of 0 is rejected
 * (400), and a null in a PUT body is treated as absent and leaves the cap
 * unchanged (it does NOT clear it). There is no "unlimited" - max_entries is
 * always a concrete 1..10000 value.
 */
export interface LogConfiguration {
  /** Cap on returned entries; must be in range 1-10000. */
  max_entries?: number;
  severity_filter?: string | null;
}

// =============================================================================
// Server Info
// =============================================================================

export interface VersionInfo {
  items: Array<{
    base_uri: string;
    version: string;
    vendor_info?: { name: string; version: string } | null;
  }>;
}
