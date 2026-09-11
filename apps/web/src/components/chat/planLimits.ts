/**
 * Presentation rules for the composer's plan-limit icon and detail panel.
 *
 * @module components/chat/planLimits
 */
import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import type { ServerProviderUsageWindow, ServerProviderUsageLimits } from "@t3tools/contracts";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { formatProviderDriverKindLabel } from "../../providerModels";

type PlanLimitStatus = "ok" | "warning" | "exhausted";

interface PlanLimitDisplayWindow {
  readonly key: string;
  readonly title: string;
  readonly remainingPercent: number;
  readonly resetsAt: string | null;
  readonly status: PlanLimitStatus;
  readonly kind: ServerProviderUsageWindow["kind"];
  readonly windowMinutes: number | null;
  readonly modelSlugs: ReadonlyArray<string> | null;
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

const WARNING_REMAINING_PERCENT = 20;

/**
 * Names a time window from the duration the provider reported.
 */
export function planLimitWindowTitle(window: ServerProviderUsageWindow): string {
  if (window.modelSlugs !== undefined) return window.label;
  const minutes = window.windowDurationMins;
  if (minutes === undefined || minutes <= 0) {
    return window.kind === "other"
      ? window.label
      : window.kind.charAt(0).toUpperCase() + window.kind.slice(1);
  }
  if (minutes % MINUTES_PER_WEEK === 0) {
    const weeks = minutes / MINUTES_PER_WEEK;
    return weeks === 1 ? "Weekly" : `${weeks}-week`;
  }
  if (minutes % MINUTES_PER_DAY === 0) {
    const days = minutes / MINUTES_PER_DAY;
    return `${days}-day`;
  }
  if (minutes % MINUTES_PER_HOUR === 0) {
    const hours = minutes / MINUTES_PER_HOUR;
    return `${hours}-hour`;
  }
  return `${minutes}-minute`;
}

/** Builds usage-window display data. */
export function planLimitDisplayWindows(
  limits: ServerProviderUsageLimits,
): readonly PlanLimitDisplayWindow[] {
  return [...limits.windows]
    .sort(
      (a, b) =>
        (a.windowDurationMins ?? 0) - (b.windowDurationMins ?? 0) || a.label.localeCompare(b.label),
    )
    .map((window) => {
      const usedPercent = Math.min(100, Math.max(0, window.usedPercent));
      const remaining = Math.round((100 - usedPercent) * 10) / 10;
      return {
        key: window.id,
        title: planLimitWindowTitle(window),
        remainingPercent: remaining,
        resetsAt: window.resetsAt ?? null,
        kind: window.kind,
        windowMinutes: window.windowDurationMins ?? null,
        modelSlugs: window.modelSlugs ?? null,
        status:
          usedPercent === 100
            ? "exhausted"
            : remaining < WARNING_REMAINING_PERCENT
              ? "warning"
              : "ok",
      };
    });
}

/** Display colour for one quota window. */
export function planLimitColor(status: PlanLimitStatus): string {
  if (status === "exhausted") return "var(--color-error)";
  if (status === "warning") return "var(--color-warning)";
  return "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)";
}

/** Track colour behind the fuel. */
export function planLimitTrackColor(status: PlanLimitStatus): string {
  return status === "exhausted"
    ? "color-mix(in oklab, var(--color-error) 45%, transparent)"
    : "color-mix(in oklab, var(--color-muted-foreground) 24%, transparent)";
}

/** True when a usage window constrains the given model. */
export function planLimitAppliesToModel(
  window: { readonly modelSlugs: ReadonlyArray<string> | null },
  selectedModel: string | null | undefined,
): boolean {
  if (window.modelSlugs === null) return true;
  if (selectedModel === null || selectedModel === undefined) return false;
  return window.modelSlugs.includes(selectedModel);
}

function planLimitWindowOrder(window: PlanLimitDisplayWindow): number {
  if (window.windowMinutes !== null && window.windowMinutes > 0) return window.windowMinutes;
  switch (window.kind) {
    case "session":
      return 5 * MINUTES_PER_HOUR;
    case "weekly":
      return MINUTES_PER_WEEK;
    case "monthly":
      return 30 * MINUTES_PER_DAY;
    case "other":
      return Infinity;
  }
}

/** The needle shows the shortest window and the arc the next longer window. */
export function planLimitGauge(
  limits: ServerProviderUsageLimits,
  selectedModel?: string | null,
): {
  readonly arc: PlanLimitDisplayWindow | null;
  readonly needle: PlanLimitDisplayWindow | null;
} {
  const windows = planLimitDisplayWindows(limits)
    .filter((window) => planLimitAppliesToModel(window, selectedModel))
    .sort(
      (a, b) =>
        planLimitWindowOrder(a) - planLimitWindowOrder(b) ||
        Number(b.status === "exhausted") - Number(a.status === "exhausted") ||
        a.remainingPercent - b.remainingPercent ||
        a.title.localeCompare(b.title) ||
        a.key.localeCompare(b.key),
    );
  let needle = windows[0] ?? null;
  const arc =
    windows.find(
      (window) => needle !== null && planLimitWindowOrder(window) > planLimitWindowOrder(needle),
    ) ?? null;
  // Any applicable blocker prevents spending the shortest-window allowance.
  if (needle !== null && windows.some((window) => window.status === "exhausted")) {
    needle = { ...needle, status: "exhausted" };
  }
  return { needle, arc };
}

/** Latest reset time of every applicable blocker. */
export function planLimitCountdownTarget(
  limits: ServerProviderUsageLimits,
  selectedModel: string | null | undefined,
): number | null {
  const blockers = planLimitDisplayWindows(limits).filter(
    (window) => window.status === "exhausted" && planLimitAppliesToModel(window, selectedModel),
  );
  if (blockers.length === 0) return null;
  const resets = blockers.map((window) =>
    window.resetsAt === null ? NaN : Date.parse(window.resetsAt),
  );
  return resets.every(Number.isFinite) ? Math.max(...resets) : null;
}

/** Whether limits are available for rendering. */
export function hasRenderableLimits(
  limits: ServerProviderUsageLimits | null,
): limits is ServerProviderUsageLimits {
  return limits !== null && limits.windows.length > 0;
}

export type PlanLimitsTitle =
  | { readonly kind: "provider"; readonly label: string }
  | { readonly kind: "account"; readonly name: string };

export function planLimitsTitle(
  entry: ProviderInstanceEntry,
  entries: Iterable<ProviderInstanceEntry>,
): PlanLimitsTitle {
  let sharedDriverCount = 0;
  for (const candidate of entries) {
    if (candidate.driverKind === entry.driverKind && ++sharedDriverCount > 1) {
      return { kind: "account", name: entry.displayName };
    }
  }
  return {
    kind: "provider",
    label:
      PROVIDER_DISPLAY_NAMES[entry.driverKind] ?? formatProviderDriverKindLabel(entry.driverKind),
  };
}

/** Spoken form of the title, for the icon's accessible label. */
export function planLimitsTitleText(title: PlanLimitsTitle): string {
  return `${title.kind === "provider" ? title.label : title.name} limits`;
}

/**
 * A wait as the largest two units that still say something, e.g. `3h 20m`,
 * `2d 4h`, `42m`..
 */
export function formatCountdown(remainingMs: number): string {
  const minutes = Math.floor(remainingMs / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainderMinutes = minutes % 60;
    return remainderMinutes === 0 ? `${hours}h` : `${hours}h ${remainderMinutes}m`;
  }

  const days = Math.floor(hours / 24);
  const remainderHours = hours % 24;
  return remainderHours === 0 ? `${days}d` : `${days}d ${remainderHours}h`;
}

/** A wait in one unit for spots too small for {@link formatCountdown}. */
export function formatCountdownBound(remainingMs: number): string {
  const seconds = Math.ceil(remainingMs / 1_000);
  if (seconds < 60) return `${Math.max(seconds, 1)}s`;

  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `<${hours}h`;

  const days = Math.ceil(hours / 24);
  return minutes % 1_440 === 0 ? `${days}d` : `<${days}d`;
}

/** How long the {@link formatCountdownBound} label for this wait stays valid. */
export function countdownBoundHoldMs(remainingMs: number): number {
  const step = remainingMs <= 60_000 ? 1_000 : 60_000;
  const untilBoundary = remainingMs % step;
  return untilBoundary === 0 ? step : untilBoundary;
}

/** Countdown to a quota window rolling over, e.g. `resets in 3h 20m`. */
export function formatResetIn(resetsAt: string, nowMs: number = Date.now()): string | null {
  const target = Date.parse(resetsAt);
  if (Number.isNaN(target)) return null;

  const remainingMs = target - nowMs;
  // A window whose reset has passed but whose snapshot predates it: the
  // provider simply has not told us the new numbers yet.
  if (remainingMs <= 0) return "resets soon";
  if (remainingMs < 60_000) return "resets in under a minute";
  return `resets in ${formatCountdown(remainingMs)}`;
}
