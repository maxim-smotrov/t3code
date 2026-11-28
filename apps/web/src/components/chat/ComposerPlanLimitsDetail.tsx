import type { ServerProviderUsageLimits } from "@t3tools/contracts";
import { paceOf, paceRemainingPercent } from "@t3tools/shared/usageLimits";
import { formatResetsIn } from "@t3tools/shared/usageLimitsCopy";
import { T, Var, useGT, useMessages } from "gt-react";
import { RefreshCwIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { PaceIcon } from "../usage/UsageLimits";
import {
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
  const gt = useGT();
  const m = useMessages();
  return (
    <div className="flex flex-col gap-3 p-(--floating-content-inset)">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-muted-foreground text-xs">
          {title.kind === "provider" ? (
            gt("{provider} limits", { provider: title.label })
          ) : (
            <span className="flex items-center gap-1">
              <T>
                <code className="text-foreground pr-0.5">
                  <Var>{title.name}</Var>
                </code>{" "}
                limits
              </T>
            </span>
          )}
        </div>
        <Button
          size="micro"
          variant="ghost-muted"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={refreshing ? gt("Refreshing limits") : gt("Refresh limits")}
        >
          {formatRelativeTimeLabel(limits.checkedAt)}
          <RefreshCwIcon aria-hidden="true" className={cn(refreshing && "animate-spin")} />
        </Button>
      </div>

      {planLimitDisplayWindows(limits).map((window) => {
        const reset = formatResetsIn(window.source, nowMs, m);
        const pace = paceOf(window.source, nowMs);
        const timeLeft = paceRemainingPercent(window.source, nowMs);
        return (
          <div key={window.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-2xs leading-4">
              <span className="text-secondary-label">{window.title}</span>
              <span
                className={`font-medium tabular-nums ${
                  window.status === "exhausted" ? "text-error-foreground" : "text-secondary-label"
                }`}
              >
                {window.status === "exhausted"
                  ? gt("{remaining}% left · limit reached", { remaining: window.remainingPercent })
                  : window.status === "warning"
                    ? gt("{remaining}% left · warning", { remaining: window.remainingPercent })
                    : gt("{remaining}% left", { remaining: window.remainingPercent })}
              </span>
            </div>
            <div
              className="relative h-1.5 w-full"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={window.remainingPercent}
              aria-label={gt("{window} remaining", { window: window.title })}
              aria-valuetext={
                timeLeft === null
                  ? gt("{remaining}% left", { remaining: window.remainingPercent })
                  : gt("{remaining}% left, {timeLeft}% of the window left", {
                      remaining: window.remainingPercent,
                      timeLeft,
                    })
              }
            >
              <div
                className="h-full overflow-hidden rounded-full"
                style={{ backgroundColor: planLimitTrackColor("ok") }}
              >
                <div
                  className="h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
                  style={{
                    width: `${window.remainingPercent}%`,
                    backgroundColor: planLimitColor(window.status),
                  }}
                />
              </div>
              {timeLeft === null ? null : (
                <span
                  aria-hidden
                  className="absolute -inset-y-0.5 w-px -translate-x-1/2 bg-foreground/60"
                  style={{ left: `${timeLeft}%` }}
                />
              )}
            </div>
            {reset === null ? null : (
              <div className="flex items-center justify-between gap-3 text-2xs text-secondary-label">
                {reset}
                {pace === null ? null : <PaceIcon pace={pace} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
