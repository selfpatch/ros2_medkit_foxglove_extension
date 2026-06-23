// Copyright 2024-2026 bburda. Apache-2.0 license.

/**
 * Entity-type dispatch helpers for the generated openapi-fetch client.
 *
 * The generated client uses per-entity-type paths (/apps/{app_id}/data,
 * /components/{component_id}/data, etc.) rather than a generic
 * /{entity_type}/{entity_id}/... path. These helpers route calls to the
 * correct typed path based on the entity type string so each call site
 * sees a literal path and full param/response typing.
 *
 * Pattern mirrors the web_ui's src/lib/api-dispatch.ts.
 */

import type { MedkitClient } from "./gateway-client";
import type { SovdResourceEntityType } from "./types";

// =============================================================================
// Data (Topics)
// =============================================================================

export function getEntityData(
  client: MedkitClient,
  entityType: SovdResourceEntityType,
  entityId: string,
) {
  switch (entityType) {
    case "apps":
      return client.GET("/apps/{app_id}/data", { params: { path: { app_id: entityId } } });
    case "components":
      return client.GET("/components/{component_id}/data", { params: { path: { component_id: entityId } } });
    case "areas":
      return client.GET("/areas/{area_id}/data", { params: { path: { area_id: entityId } } });
    case "functions":
      return client.GET("/functions/{function_id}/data", { params: { path: { function_id: entityId } } });
  }
}

export function getEntityDataItem(
  client: MedkitClient,
  entityType: SovdResourceEntityType,
  entityId: string,
  dataId: string,
) {
  switch (entityType) {
    case "apps":
      return client.GET("/apps/{app_id}/data/{data_id}", {
        params: { path: { app_id: entityId, data_id: dataId } },
      });
    case "components":
      return client.GET("/components/{component_id}/data/{data_id}", {
        params: { path: { component_id: entityId, data_id: dataId } },
      });
    case "areas":
      return client.GET("/areas/{area_id}/data/{data_id}", {
        params: { path: { area_id: entityId, data_id: dataId } },
      });
    case "functions":
      return client.GET("/functions/{function_id}/data/{data_id}", {
        params: { path: { function_id: entityId, data_id: dataId } },
      });
  }
}

// =============================================================================
// Configurations
// =============================================================================

export function getEntityConfigurations(
  client: MedkitClient,
  entityType: SovdResourceEntityType,
  entityId: string,
) {
  switch (entityType) {
    case "apps":
      return client.GET("/apps/{app_id}/configurations", {
        params: { path: { app_id: entityId } },
      });
    case "components":
      return client.GET("/components/{component_id}/configurations", {
        params: { path: { component_id: entityId } },
      });
    case "areas":
      return client.GET("/areas/{area_id}/configurations", {
        params: { path: { area_id: entityId } },
      });
    case "functions":
      return client.GET("/functions/{function_id}/configurations", {
        params: { path: { function_id: entityId } },
      });
  }
}

export function putEntityConfiguration(
  client: MedkitClient,
  entityType: SovdResourceEntityType,
  entityId: string,
  configId: string,
  body: { data?: unknown },
) {
  switch (entityType) {
    case "apps":
      return client.PUT("/apps/{app_id}/configurations/{config_id}", {
        params: { path: { app_id: entityId, config_id: configId } },
        body,
      });
    case "components":
      return client.PUT("/components/{component_id}/configurations/{config_id}", {
        params: { path: { component_id: entityId, config_id: configId } },
        body,
      });
    case "areas":
      return client.PUT("/areas/{area_id}/configurations/{config_id}", {
        params: { path: { area_id: entityId, config_id: configId } },
        body,
      });
    case "functions":
      return client.PUT("/functions/{function_id}/configurations/{config_id}", {
        params: { path: { function_id: entityId, config_id: configId } },
        body,
      });
  }
}

// =============================================================================
// Operations
// =============================================================================

export function getEntityOperations(
  client: MedkitClient,
  entityType: SovdResourceEntityType,
  entityId: string,
) {
  switch (entityType) {
    case "apps":
      return client.GET("/apps/{app_id}/operations", {
        params: { path: { app_id: entityId } },
      });
    case "components":
      return client.GET("/components/{component_id}/operations", {
        params: { path: { component_id: entityId } },
      });
    case "areas":
      return client.GET("/areas/{area_id}/operations", {
        params: { path: { area_id: entityId } },
      });
    case "functions":
      return client.GET("/functions/{function_id}/operations", {
        params: { path: { function_id: entityId } },
      });
  }
}

// =============================================================================
// Executions
// =============================================================================

export function postEntityExecution(
  client: MedkitClient,
  entityType: SovdResourceEntityType,
  entityId: string,
  operationId: string,
  body: { type?: string | null; request?: unknown; goal?: unknown; parameters?: unknown },
) {
  switch (entityType) {
    case "apps":
      return client.POST("/apps/{app_id}/operations/{operation_id}/executions", {
        params: { path: { app_id: entityId, operation_id: operationId } },
        body,
      });
    case "components":
      return client.POST("/components/{component_id}/operations/{operation_id}/executions", {
        params: { path: { component_id: entityId, operation_id: operationId } },
        body,
      });
    case "areas":
      return client.POST("/areas/{area_id}/operations/{operation_id}/executions", {
        params: { path: { area_id: entityId, operation_id: operationId } },
        body,
      });
    case "functions":
      return client.POST("/functions/{function_id}/operations/{operation_id}/executions", {
        params: { path: { function_id: entityId, operation_id: operationId } },
        body,
      });
  }
}
