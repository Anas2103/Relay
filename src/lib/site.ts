import { useSyncExternalStore } from "react";
import { SITE_FEATURES, type SiteFeature, type SiteFeatures, type SiteSettings } from "../../shared/types";

/** Everything on: used until the real settings arrive (the server enforces them anyway). */
export const ALL_FEATURES_ON = Object.fromEntries(SITE_FEATURES.map(([k]) => [k, true])) as SiteFeatures;

let current: SiteSettings | null = null;
const listeners = new Set<() => void>();

/** The owner's site settings, shared app-wide (set by the chat screen when it loads them). */
export const siteStore = {
  get: () => current,
  set(next: SiteSettings | null) {
    current = next;
    listeners.forEach((fn) => fn());
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};

export function useSite(): SiteSettings | null {
  return useSyncExternalStore(siteStore.subscribe, siteStore.get);
}

/**
 * Whether a feature is available to this person. Admins keep everything; for
 * everyone else read-only mode turns off everything that sends.
 */
export function useFeature(feature: SiteFeature, isAdmin: boolean): boolean {
  const site = useSite();
  if (isAdmin || !site) return true;
  if (site.readOnly && feature !== "ai") return false;
  return site.features[feature] !== false;
}
