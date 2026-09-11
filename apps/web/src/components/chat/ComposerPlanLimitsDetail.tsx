import type { ServerProviderUsageLimits } from "@t3tools/contracts";
import { RefreshCwIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  formatResetIn,
  planLimitDisplayWindows,
  planLimitColor,
  planLimitTrackColor,
  type PlanLimitsTitle,
} from "./planLimits";

/** A popover, triggered by the gauge composer icon and showing selected account's plan limits. */
export function ComposerPlanLimitsDetail({
  limits,
  title,
  nowMs,
  onRefresh,
  refreshing,
}: {
  readonly limits: ServerProviderUsageLimits;
  readonly title: PlanLimitsTitle;
  readonly nowMs: number;
  readonly onRefresh: () => void;
  readonly refreshing: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 p-(--floating-content-inset)">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-muted-foreground text-xs">
          {title.kind === "provider" ? (
            `${title.label} limits`
          ) : (
            <span className="flex items-center gap-1">
              <code className="text-foreground pr-0.5">{title.name}</code>
              limits
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={refreshing ? "Refreshing limits" : "Refresh limits"}
          className="flex items-center gap-1 rounded text-secondary-label text-[11px] hover:text-foreground disabled:hover:text-secondary-label"
        >
          {formatRelativeTimeLabel(limits.checkedAt)}
          <RefreshCwIcon
            aria-hidden="true"
            className={cn("size-3", refreshing && "animate-spin")}
          />
        </button>
      </div>

      {planLimitDisplayWindows(limits).map((window) => {
        const reset = window.resetsAt === null ? null : formatResetIn(window.resetsAt, nowMs);
        return (
          <div key={window.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-[11px] leading-4">
              <span className="text-secondary-label">{window.title}</span>
              <span
                className={`font-medium tabular-nums ${
                  window.status === "exhausted" ? "text-error-foreground" : "text-secondary-label"
                }`}
              >
                {window.remainingPercent}% left
                {window.status === "exhausted"
                  ? " · limit reached"
                  : window.status === "warning"
                    ? " · warning"
                    : ""}
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full"
              style={{ backgroundColor: planLimitTrackColor("ok") }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(window.remainingPercent)}
              aria-label={`${window.title} remaining`}
            >
              <div
                className="h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
                style={{
                  width: `${window.remainingPercent}%`,
                  backgroundColor: planLimitColor(window.status),
                }}
              />
            </div>
            {reset === null ? null : (
              <div className="text-[11px] text-secondary-label">{reset}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
