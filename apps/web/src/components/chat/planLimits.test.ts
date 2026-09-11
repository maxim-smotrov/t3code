import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { ServerProviderUsageLimits } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  countdownBoundHoldMs,
  formatCountdown,
  formatCountdownBound,
  formatResetIn,
  hasRenderableLimits,
  planLimitAppliesToModel,
  planLimitDisplayWindows,
  planLimitColor,
  planLimitCountdownTarget,
  planLimitGauge,
  planLimitsTitle,
  planLimitsTitleText,
  planLimitTrackColor,
} from "./planLimits";

const makeLimits = (
  windows: ServerProviderUsageLimits["windows"],
  overrides?: Partial<ServerProviderUsageLimits>,
): ServerProviderUsageLimits => ({
  checkedAt: "2026-08-25T16:48:28.377Z",
  windows,
  ...overrides,
});

const makeWindow = (
  kind: "session" | "weekly" | "monthly" | "other",
  usedPercent: number,
  windowMinutes: number | null,
  model?: string,
  resetsAt: string | null = null,
): ServerProviderUsageLimits["windows"][number] => ({
  kind,
  usedPercent,
  id: `${kind}:${windowMinutes}:${model ?? ""}`,
  label: model !== undefined ? `Weekly · ${model}` : kind === "other" ? "Extra quota" : kind,
  ...(resetsAt === null ? {} : { resetsAt }),
  ...(windowMinutes === null ? {} : { windowDurationMins: windowMinutes }),
  ...(model === undefined ? {} : { modelSlugs: [`claude-${model.toLowerCase()}-5`] }),
});

describe("buildPlanLimitDisplayWindows", () => {
  it("titles each window from the duration the provider reported", () => {
    const windows = planLimitDisplayWindows(
      makeLimits([makeWindow("session", 16, 300), makeWindow("weekly", 8, 10080)]),
    );

    expect(windows.map((window) => window.title)).toEqual(["5-hour", "Weekly"]);
  });

  it("does not call a lone weekly window a session", () => {
    // Codex reported exactly this shape for six days: one window, seven days
    // long, in the slot a reader would assume is the session.
    const windows = planLimitDisplayWindows(makeLimits([makeWindow("session", 44, 10080)]));

    expect(windows).toHaveLength(1);
    expect(windows[0]?.title).toBe("Weekly");
  });

  it("orders the shortest window first however the provider sent them", () => {
    const windows = planLimitDisplayWindows(
      makeLimits([makeWindow("weekly", 8, 10080), makeWindow("session", 16, 300)]),
    );

    expect(windows.map((window) => window.title)).toEqual(["5-hour", "Weekly"]);
  });

  it("falls back to the window kind when no duration is reported", () => {
    const windows = planLimitDisplayWindows(makeLimits([makeWindow("session", 25, null)]));

    expect(windows[0]?.title).toBe("Session");
    expect(windows[0]?.remainingPercent).toBe(75);
  });

  it("reports the unspent side, because the gauges drain rather than fill", () => {
    const windows = planLimitDisplayWindows(
      makeLimits([makeWindow("session", 16, 300), makeWindow("weekly", 100, 10080)]),
    );

    expect(windows.map((window) => window.remainingPercent)).toEqual([84, 0]);
  });

  it("rounds the remaining percentage to one decimal place", () => {
    const windows = planLimitDisplayWindows(makeLimits([makeWindow("session", 64.1, 300)]));

    expect(windows[0]?.remainingPercent).toBe(35.9);
  });

  it("clamps a percentage the provider sent out of range", () => {
    const windows = planLimitDisplayWindows(makeLimits([makeWindow("session", 140, 300)]));

    expect(windows[0]?.remainingPercent).toBe(0);
  });

  it("warns below 20% remaining", () => {
    const windows = planLimitDisplayWindows(
      makeLimits([makeWindow("session", 81, 300), makeWindow("weekly", 80, 10080)]),
    );

    expect(windows.map((window) => window.status)).toEqual(["warning", "ok"]);
  });

  it("titles a scoped cap by its model and keys it apart from the weekly window", () => {
    const windows = planLimitDisplayWindows(
      makeLimits([makeWindow("weekly", 39, 10080), makeWindow("weekly", 60, 10080, "Fable")]),
    );

    expect(windows.map((window) => window.title)).toEqual(["Weekly", "Weekly · Fable"]);
    expect(new Set(windows.map((window) => window.key)).size).toBe(2);
  });

  it("orders scoped caps after the weekly window and by model name", () => {
    const windows = planLimitDisplayWindows(
      makeLimits([
        makeWindow("weekly", 10, 10080, "Sonnet"),
        makeWindow("weekly", 60, 10080, "Fable"),
        makeWindow("weekly", 39, 10080),
        makeWindow("session", 21, 300),
      ]),
    );

    expect(windows.map((window) => window.title)).toEqual([
      "5-hour",
      "Weekly",
      "Weekly · Fable",
      "Weekly · Sonnet",
    ]);
  });

  it("only marks the window that reached its limit", () => {
    const windows = planLimitDisplayWindows(
      makeLimits([makeWindow("session", 100, 300), makeWindow("weekly", 51, 10080)]),
    );

    expect(windows.map((window) => window.status)).toEqual(["exhausted", "ok"]);
  });
});

describe("planLimitTrackColor", () => {
  it("puts the alarm on the track, since a spent window has no fill to colour", () => {
    expect(planLimitTrackColor("exhausted")).toContain("--color-error");
    expect(planLimitTrackColor("ok")).toContain("--color-muted-foreground");
  });
});

describe("planLimitColor", () => {
  it("uses each window's verdict", () => {
    expect(planLimitColor("warning")).toBe("var(--color-warning)");
    expect(planLimitColor("exhausted")).toBe("var(--color-error)");
    expect(planLimitColor("ok")).toContain("--color-muted-foreground");
  });
});

describe("planLimitGauge", () => {
  it("puts the shortest window on the needle and the next longer window on the arc", () => {
    const gauge = planLimitGauge(
      makeLimits([makeWindow("weekly", 8, 10080), makeWindow("session", 16, 300)]),
    );

    expect(gauge.needle?.title).toBe("5-hour");
    expect(gauge.arc?.title).toBe("Weekly");
  });

  it("sends a lone weekly window to the needle even in the session slot", () => {
    const gauge = planLimitGauge(makeLimits([makeWindow("session", 44, 10080)]));

    expect(gauge.needle?.title).toBe("Weekly");
    expect(gauge.arc).toBeNull();
  });

  it("sends a lone session window to the needle", () => {
    const gauge = planLimitGauge(makeLimits([makeWindow("session", 16, 300)]));

    expect(gauge.arc).toBeNull();
    expect(gauge.needle?.title).toBe("5-hour");
  });

  it("pulls the needle into the alarm when the long window is spent", () => {
    const gauge = planLimitGauge(
      makeLimits([makeWindow("session", 16, 300), makeWindow("weekly", 100, 10080)]),
    );

    expect(gauge.arc?.status).toBe("exhausted");
    expect(gauge.needle?.status).toBe("exhausted");
  });

  it("keeps the arc calm when only the short window is spent", () => {
    const gauge = planLimitGauge(
      makeLimits([makeWindow("session", 100, 300), makeWindow("weekly", 16, 10080)]),
    );

    expect(gauge.needle?.status).toBe("exhausted");
    expect(gauge.arc?.status).toBe("ok");
  });

  it("draws nothing when there are no quota windows", () => {
    const gauge = planLimitGauge(makeLimits([]));

    expect(gauge.arc).toBeNull();
    expect(gauge.needle).toBeNull();
  });

  it("retains monthly and other window labels without a duration", () => {
    const monthly = planLimitGauge(makeLimits([makeWindow("monthly", 44, null)]));
    expect(monthly.needle?.title).toBe("Monthly");
    expect(monthly.arc).toBeNull();
    expect(planLimitDisplayWindows(makeLimits([makeWindow("other", 20, null)]))[0]?.title).toBe(
      "Extra quota",
    );
  });

  it("orders windows by kind when durations are missing", () => {
    const gauge = planLimitGauge(
      makeLimits([makeWindow("weekly", 20, null), makeWindow("monthly", 100, null)]),
    );
    expect(gauge.needle).toMatchObject({
      title: "Weekly",
      status: "exhausted",
    });
    expect(gauge.arc).toMatchObject({ title: "Monthly", status: "exhausted" });
  });

  it("accepts older snapshots without model slugs", () => {
    const limits: ServerProviderUsageLimits = {
      checkedAt: "2026-08-25T16:48:28.377Z",
      windows: [{ id: "primary", kind: "session", label: "Session", usedPercent: 10 }],
    };
    expect(planLimitGauge(limits).needle).toMatchObject({
      remainingPercent: 90,
      status: "ok",
    });
  });

  it("puts the selected model's cap on the arc when it has less remaining", () => {
    const gauge = planLimitGauge(
      makeLimits([
        makeWindow("session", 16, 300),
        makeWindow("weekly", 39, 10080),
        makeWindow("weekly", 60, 10080, "Fable"),
      ]),
      "claude-fable-5",
    );

    expect(gauge.arc?.modelSlugs).toEqual(["claude-fable-5"]);
    expect(gauge.needle?.title).toBe("5-hour");
  });

  it("keeps the weekly window on the arc when it is the tighter limit", () => {
    const gauge = planLimitGauge(
      makeLimits([
        makeWindow("session", 16, 300),
        makeWindow("weekly", 80, 10080),
        makeWindow("weekly", 60, 10080, "Fable"),
      ]),
      "claude-fable-5",
    );

    expect(gauge.arc?.modelSlugs).toBeNull();
  });

  it("ignores scoped caps when the slug matches none of them", () => {
    const limits = makeLimits([
      makeWindow("weekly", 39, 10080),
      makeWindow("weekly", 100, 10080, "Fable"),
    ]);

    expect(planLimitGauge(limits, "claude-sonnet-5").needle?.modelSlugs).toBeNull();
    expect(planLimitGauge(limits, undefined).needle?.modelSlugs).toBeNull();
    expect(planLimitGauge(limits, "gpt-5-codex").needle?.modelSlugs).toBeNull();
  });

  it("lets a lone matching cap drive the needle by itself", () => {
    const gauge = planLimitGauge(
      makeLimits([makeWindow("weekly", 60, 10080, "Fable")]),
      "claude-fable-5",
    );

    expect(gauge.needle?.modelSlugs).toEqual(["claude-fable-5"]);
    expect(gauge.arc).toBeNull();
  });

  it("uses the next duration even when a third window is exhausted", () => {
    const gauge = planLimitGauge(
      makeLimits([
        makeWindow("monthly", 100, 43200),
        makeWindow("session", 16, 300),
        makeWindow("weekly", 39, 10080),
      ]),
    );

    expect(gauge.needle).toMatchObject({
      title: "5-hour",
      status: "exhausted",
    });
    expect(gauge.arc).toMatchObject({ title: "Weekly", remainingPercent: 61 });
  });

  it("keeps two short durations separate regardless of reset order", () => {
    const gauge = planLimitGauge(
      makeLimits([
        makeWindow("session", 80, 300, undefined, "2026-08-25T17:00:00.000Z"),
        makeWindow("session", 10, 60, undefined, "2026-08-25T18:00:00.000Z"),
      ]),
    );

    expect(gauge.needle?.title).toBe("1-hour");
    expect(gauge.arc?.title).toBe("5-hour");
  });

  it("combines weekly caps on the needle and follows model changes", () => {
    const limits = makeLimits([
      makeWindow("weekly", 39, 10080),
      makeWindow("weekly", 60, 10080, "Fable"),
    ]);

    expect(planLimitGauge(limits, "claude-fable-5")).toMatchObject({
      needle: { title: "Weekly · Fable", remainingPercent: 40 },
      arc: null,
    });
    expect(planLimitGauge(limits, "claude-sonnet-5")).toMatchObject({
      needle: { title: "Weekly", remainingPercent: 61 },
      arc: null,
    });
  });

  it.each([null, 0])("groups a weekly cap with missing or zero duration (%s)", (duration) => {
    const gauge = planLimitGauge(
      makeLimits([makeWindow("weekly", 39, 10080), makeWindow("weekly", 60, duration, "Fable")]),
      "claude-fable-5",
    );

    expect(gauge.needle?.modelSlugs).toEqual(["claude-fable-5"]);
    expect(gauge.arc).toBeNull();
  });

  it("keeps tied caps stable when provider order changes", () => {
    const windows = [makeWindow("weekly", 60, 10080, "Fable"), makeWindow("weekly", 60, 10080)];
    const gauge = planLimitGauge(makeLimits(windows), "claude-fable-5");

    expect(gauge.needle?.modelSlugs).toBeNull();
    expect(planLimitGauge(makeLimits(windows.toReversed()), "claude-fable-5")).toEqual(gauge);
  });
});

describe("planLimitCountdownTarget", () => {
  const sessionReset = "2026-08-25T18:00:00.000Z";
  const weeklyReset = "2026-08-29T00:00:00.000Z";

  it("counts to the reset of the exhausted window", () => {
    const limits = makeLimits([
      makeWindow("session", 16, 300, undefined, sessionReset),
      makeWindow("weekly", 100, 10080, undefined, weeklyReset),
    ]);

    expect(planLimitCountdownTarget(limits, null)).toBe(Date.parse(weeklyReset));
  });

  it("waits for every applicable reset", () => {
    const limits = makeLimits([
      makeWindow("session", 100, 300, undefined, sessionReset),
      makeWindow("weekly", 100, 10080, undefined, weeklyReset),
    ]);
    expect(planLimitCountdownTarget(limits, null)).toBe(Date.parse(weeklyReset));
  });

  it("cannot promise recovery if an applicable blocker has no known reset", () => {
    const limits = makeLimits([
      makeWindow("session", 100, 300, undefined, sessionReset),
      makeWindow("weekly", 100, 10080),
    ]);
    expect(planLimitCountdownTarget(limits, null)).toBeNull();
  });

  it("starts nothing for a healthy account", () => {
    const limits = makeLimits([makeWindow("session", 16, 300, undefined, sessionReset)]);

    expect(planLimitCountdownTarget(limits, null)).toBeNull();
  });

  it("ignores a spent cap of a model that is not selected", () => {
    const limits = makeLimits([
      makeWindow("weekly", 39, 10080, undefined, weeklyReset),
      makeWindow("weekly", 100, 10080, "Fable", weeklyReset),
    ]);

    expect(planLimitCountdownTarget(limits, "claude-sonnet-5")).toBeNull();
    expect(planLimitCountdownTarget(limits, "claude-fable-5")).toBe(Date.parse(weeklyReset));
  });
});

describe("planLimitAppliesToModel", () => {
  it("matches account-wide windows always and scoped windows by exact slug", () => {
    const fable = { modelSlugs: ["claude-fable-5-1", "claude-fable-5"] };
    expect(planLimitAppliesToModel({ modelSlugs: null }, undefined)).toBe(true);
    expect(planLimitAppliesToModel(fable, "claude-fable-5")).toBe(true);
    expect(planLimitAppliesToModel(fable, "claude-fable")).toBe(false);
    expect(planLimitAppliesToModel(fable, "claude-sonnet-5")).toBe(false);
    expect(planLimitAppliesToModel({ modelSlugs: [] }, "claude-fable-5")).toBe(false);
    expect(planLimitAppliesToModel(fable, undefined)).toBe(false);
    expect(planLimitAppliesToModel(fable, null)).toBe(false);
  });
});

describe("hasRenderableLimits", () => {
  it("needs at least one window to render", () => {
    expect(hasRenderableLimits(makeLimits([]))).toBe(false);
    expect(hasRenderableLimits(makeLimits([makeWindow("session", 0, 300)]))).toBe(true);
    expect(hasRenderableLimits(null)).toBe(false);
  });
});

describe("planLimitsTitle", () => {
  const makeEntry = (driver: string, instanceId: string, displayName: string) =>
    ({
      driverKind: ProviderDriverKind.make(driver),
      instanceId: ProviderInstanceId.make(instanceId),
      displayName,
    }) as ProviderInstanceEntry;

  const codex = makeEntry("codex", "codex", "Codex");
  const codexWork = makeEntry("codex", "codex_work", "Work");
  const claude = makeEntry("claudeAgent", "claudeAgent", "Claude");

  it("names the provider while it has a single account", () => {
    expect(planLimitsTitle(codex, [codex, claude])).toEqual({
      kind: "provider",
      label: "Codex",
    });
    expect(planLimitsTitle(claude, [codex, claude])).toEqual({
      kind: "provider",
      label: "Claude",
    });
  });

  it("names the account once the provider has several", () => {
    const entries = [codex, codexWork, claude];
    expect(planLimitsTitle(codex, entries)).toEqual({
      kind: "account",
      name: "Codex",
    });
    expect(planLimitsTitle(codexWork, entries)).toEqual({
      kind: "account",
      name: "Work",
    });
    expect(planLimitsTitle(claude, entries)).toEqual({
      kind: "provider",
      label: "Claude",
    });
  });

  it("speaks both forms the same way", () => {
    expect(planLimitsTitleText({ kind: "provider", label: "Codex" })).toBe("Codex limits");
    expect(planLimitsTitleText({ kind: "account", name: "Work" })).toBe("Work limits");
  });
});

describe("formatCountdown", () => {
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  it("shows the largest two units that still say something", () => {
    expect(formatCountdown(42 * minute)).toBe("42m");
    expect(formatCountdown(3 * hour + 20 * minute)).toBe("3h 20m");
    expect(formatCountdown(3 * hour)).toBe("3h");
    expect(formatCountdown(2 * day + 4 * hour)).toBe("2d 4h");
    expect(formatCountdown(2 * day)).toBe("2d");
  });

  it("does not let one unit inherit another's rounding", () => {
    expect(formatCountdown(day + minute)).toBe("1d");
    expect(formatCountdown(23 * hour + 59 * minute + 30_000)).toBe("23h 59m");
    expect(formatCountdown(59 * minute + 59_000)).toBe("59m");
  });

  it("names a sub-minute wait instead of showing zero", () => {
    expect(formatCountdown(30_000)).toBe("<1m");
  });
});

describe("formatCountdownBound", () => {
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  it("reads hours and days plain on the whole unit", () => {
    expect(formatCountdownBound(2 * hour)).toBe("2h");
    expect(formatCountdownBound(hour)).toBe("1h");
    expect(formatCountdownBound(day)).toBe("1d");
  });

  it("bounds hours and days in between", () => {
    expect(formatCountdownBound(125 * minute)).toBe("<3h");
    expect(formatCountdownBound(78 * minute)).toBe("<2h");
    expect(formatCountdownBound(hour + 1_000)).toBe("<2h");
    expect(formatCountdownBound(day + minute)).toBe("<2d");
    expect(formatCountdownBound(47 * hour)).toBe("<2d");
    expect(formatCountdownBound(23 * hour + 30 * minute)).toBe("<1d");
  });

  it("rounds minutes up and reads them plain", () => {
    expect(formatCountdownBound(58 * minute + 46_000)).toBe("59m");
    expect(formatCountdownBound(minute + 1_000)).toBe("2m");
    expect(formatCountdownBound(minute)).toBe("1m");
  });

  it("promotes a minute rounding that reaches the whole unit", () => {
    expect(formatCountdownBound(59 * minute + 15_000)).toBe("1h");
    expect(formatCountdownBound(hour + 59 * minute + 15_000)).toBe("2h");
    expect(formatCountdownBound(23 * hour + 59 * minute + 30_000)).toBe("1d");
  });

  it("rounds seconds up under a minute", () => {
    expect(formatCountdownBound(59_000)).toBe("59s");
    expect(formatCountdownBound(30_500)).toBe("31s");
    expect(formatCountdownBound(59_500)).toBe("1m");
    expect(formatCountdownBound(200)).toBe("1s");
  });
});

describe("countdownBoundHoldMs", () => {
  it("holds until the next whole minute above a minute", () => {
    expect(countdownBoundHoldMs(120_000)).toBe(60_000);
    expect(countdownBoundHoldMs(60_500)).toBe(500);
    expect(countdownBoundHoldMs(125 * 60_000 + 15_000)).toBe(15_000);
  });

  it("holds until the next whole second from a minute down", () => {
    expect(countdownBoundHoldMs(60_000)).toBe(1_000);
    expect(countdownBoundHoldMs(59_990)).toBe(990);
    expect(countdownBoundHoldMs(1_000)).toBe(1_000);
  });
});

describe("formatResetIn", () => {
  const now = Date.parse("2026-08-25T12:00:00.000Z");

  it("formats the time remaining until the reset", () => {
    expect(formatResetIn("2026-08-25T15:20:00.000Z", now)).toBe("resets in 3h 20m");
  });

  it("says a reset is imminent rather than counting seconds", () => {
    expect(formatResetIn("2026-08-25T12:00:30.000Z", now)).toBe("resets in under a minute");
  });

  it("reports an elapsed reset as pending, since the snapshot predates it", () => {
    expect(formatResetIn("2026-08-25T11:00:00.000Z", now)).toBe("resets soon");
  });

  it("returns null for an instant it cannot read", () => {
    expect(formatResetIn("whenever", now)).toBeNull();
  });
});
