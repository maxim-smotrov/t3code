import type {
  EnvironmentId,
  ProviderInstanceId,
  ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ComposerPlanLimitsDetail } from "./ComposerPlanLimitsDetail";
import { composerFloatingLayerProps } from "./composerEventScope";
import {
  countdownBoundHoldMs,
  formatCountdownBound,
  planLimitColor,
  planLimitCountdownTarget,
  planLimitGauge,
  planLimitDisplayWindows,
  planLimitsTitleText,
  planLimitTrackColor,
  type PlanLimitsTitle,
} from "./planLimits";

const GAUGE_SWEEP_DEGREES = 240;
const ARC_LENGTH = (GAUGE_SWEEP_DEGREES / 360) * 2 * Math.PI * 10;
const NEEDLE_FULL_DEGREES = 75;
const IDLE_TICK_MS = 30_000;

/**
 * A fuel gauge with the shortest applicable window on the needle and the
 * next longer window on the arc. Both drain counterclockwise.
 */
export function ComposerPlanLimits({
  environmentId,
  instanceId,
  limits,
  model,
  title,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly limits: ServerProviderUsageLimits;
  readonly model: string | null;
  readonly title: PlanLimitsTitle;
}) {
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    void refreshProviders({ environmentId, input: { instanceId } }).finally(() =>
      setRefreshing(false),
    );
  }, [environmentId, instanceId, refreshProviders, refreshing]);

  const { arc, needle } = planLimitGauge(limits, model);
  const windows = planLimitDisplayWindows(limits);
  const countdownTargetMs = planLimitCountdownTarget(limits, model);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const now = Date.now();
      setNowMs(now);
      const remaining = countdownTargetMs === null ? 0 : countdownTargetMs - now;
      timer = setTimeout(tick, remaining > 0 ? countdownBoundHoldMs(remaining) : IDLE_TICK_MS);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [countdownTargetMs]);
  const remainingMs = countdownTargetMs === null ? Number.NaN : countdownTargetMs - nowMs;
  const countdown = remainingMs > 0 ? formatCountdownBound(remainingMs) : null;

  const summary = windows
    .map(
      (window) =>
        `${window.title} ${Math.round(window.remainingPercent)}% left${window.status === "ok" ? "" : `, ${window.status}`}`,
    )
    .join(", ");

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={150}
        render={
          <Button
            size="icon-sm"
            variant="ghost-muted"
            className="size-7 rounded-lg hover:text-muted-foreground data-pressed:text-muted-foreground"
            aria-label={`${planLimitsTitleText(title)}: ${summary}`}
          >
            <span
              className="relative flex size-5 items-center justify-center transition-transform duration-500 ease-out motion-reduce:transition-none"
              style={{
                transform: countdown === null ? "none" : "translateY(-3px) scale(0.8)",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                className="absolute inset-0 size-full mx-0!"
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path
                  d="M3.34 17a10 10 0 1 1 17.32 0"
                  stroke={planLimitTrackColor(arc?.status ?? "ok")}
                  className="transition-[stroke] duration-500 motion-reduce:transition-none"
                />
                {arc !== null ? (
                  <path
                    d="M3.34 17a10 10 0 1 1 17.32 0"
                    stroke={planLimitColor(arc.status)}
                    strokeDasharray={ARC_LENGTH}
                    strokeDashoffset={ARC_LENGTH * (1 - arc.remainingPercent / 100)}
                    className="transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"
                  />
                ) : null}
                {needle !== null ? (
                  <path
                    d="m12 12 4-4"
                    stroke={planLimitColor(needle.status)}
                    className="transition-[transform,stroke] duration-500 ease-out motion-reduce:transition-none"
                    style={{
                      transform: `rotate(${NEEDLE_FULL_DEGREES - (GAUGE_SWEEP_DEGREES * (100 - needle.remainingPercent)) / 100}deg)`,
                      transformOrigin: "12px 12px",
                    }}
                  />
                ) : null}
              </svg>
            </span>
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0.75 text-center font-semibold text-[7px] leading-none tabular-nums text-muted-foreground transition-opacity duration-500 ease-out motion-reduce:transition-none"
              style={{ opacity: countdown === null ? 0 : 1 }}
            >
              {countdown ?? ""}
            </span>
          </Button>
        }
      />
      <PopoverPopup
        {...composerFloatingLayerProps}
        tooltipStyle
        side="top"
        align="end"
        viewportClassName="p-0"
        className="w-56 max-w-none text-left whitespace-normal"
      >
        <ComposerPlanLimitsDetail
          limits={limits}
          title={title}
          nowMs={nowMs}
          onRefresh={refresh}
          refreshing={refreshing}
        />
      </PopoverPopup>
    </Popover>
  );
}
