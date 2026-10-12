/*
 * Compatibility barrel (Phase 16, Stage 5). The client lives in lib/api/client.ts and each
 * domain's calls and types in features/<domain>/api.ts. New code should import from the
 * domain module directly; existing imports of "@/lib/api" keep working through this file.
 */
export {
  type ProblemDetails,
  ApiError,
  getApiBaseUrl,
  newCorrelationId,
  getAccessToken,
  setAccessToken,
  subscribeAccessToken,
  clearAccessToken,
  apiFetch,
} from "@/lib/api/client";
export * from "@/features/identity/api";
export * from "@/features/events/api";
export * from "@/features/ticketing/api";
export * from "@/features/artists/api";
export * from "@/features/catalog/api";
export * from "@/features/streaming/api";
export * from "@/features/commerce/api";
export * from "@/features/royalties/api";
export * from "@/features/finance/api";
export * from "@/features/campaigns/api";
export * from "@/features/notifications/api";
export * from "@/features/search/api";
export * from "@/features/analytics/api";
export * from "@/features/admin/api";
