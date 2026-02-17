// Copyright 2024–2026 Selfpatch GmbH. Apache-2.0 license.

/**
 * SOVD types for the ros2_medkit gateway API.
 * Derived from sovd_web_ui — simplified for Foxglove panels.
 */

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

export interface Operation {
  name: string;
  path: string;
  type: string;
  kind: OperationKind;
}

export interface CreateExecutionRequest {
  type?: string;
  request?: unknown;
  goal?: unknown;
  parameters?: unknown;
}

export interface CreateExecutionResponse {
  id?: string;
  status: string;
  kind: OperationKind;
  result?: unknown;
  parameters?: unknown;
  error?: string;
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
// Server Info
// =============================================================================

export interface VersionInfo {
  sovd_info: Array<{
    base_uri: string;
    version: string;
    vendor_info?: { name: string; version: string };
  }>;
}
