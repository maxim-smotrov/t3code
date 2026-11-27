/**
 * Fork-only stopgap for the plan limits gauge: reads quota through `agy -p "/usage"`, so T3 Code
 * never calls Google's quota APIs itself. It uses the user's own `agy` sign-in, not the
 * instance's, so it supports a single-account setup only.
 */
import type { ServerProviderModel, ServerProviderUsageLimits } from "@t3tools/contracts";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import { clampPercent, makeUsageLimits } from "@t3tools/provider-core/server/usageLimits";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import type { AntigravityInstallationError } from "./AntigravityInstallation.ts";

// Slightly under the 5-minute default health-check interval so timer jitter does not skip a cycle.
const MIN_READ_INTERVAL_MS = 4 * 60_000;
// Without a valid sign-in the CLI waits for a browser login instead of exiting.
const READ_TIMEOUT = "30 seconds";

const Bucket = Schema.Struct({
  id: Schema.String,
  window: Schema.String,
  remaining_fraction: Schema.Number,
  reset_time: Schema.optional(Schema.NullOr(Schema.String)),
});
const Group = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  buckets: Schema.Array(Bucket),
});
const UsageOutput = Schema.Struct({
  command: Schema.Struct({
    name: Schema.Literal("usage"),
    data: Schema.Struct({ groups: Schema.Array(Group) }),
  }),
});
const decodeUsageOutput = Schema.decodeUnknownOption(Schema.fromJsonString(UsageOutput));

const WINDOWS: Record<string, { kind: "session" | "weekly"; label: string; mins: number }> = {
  "5h": { kind: "session", label: "Session", mins: 5 * 60 },
  weekly: { kind: "weekly", label: "Weekly", mins: 7 * 24 * 60 },
};

// agy names a group's models only in its description; slug prefixes cover renamed models.
function groupModelIds(
  group: typeof Group.Type,
  bucketId: string,
  models: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<string> {
  const names = new Set(
    (group.description?.replace(/^[^:]*:/, "") ?? "").split(",").map((name) => name.trim()),
  );
  const family = bucketId.startsWith("gemini-") ? /^gemini/ : undefined;
  return models
    .filter((model) => names.has(model.name) || (family?.test(model.slug) ?? false))
    .map((model) => model.slug);
}

function usageWindows(output: typeof UsageOutput.Type, models: ReadonlyArray<ServerProviderModel>) {
  return output.command.data.groups.flatMap((group) => {
    const groupLabel = group.name.replace(/\s+models$/i, "");
    return group.buckets.flatMap((bucket) => {
      if (bucket.id.startsWith("3p-")) return [];
      const window = WINDOWS[bucket.window];
      const modelIds = groupModelIds(group, bucket.id, models);
      // A window without models would apply to every model in the gauge and model fallback.
      if (window === undefined || modelIds.length === 0) return [];
      // agy reports the epoch for a window with no usage yet.
      const resetsAt = DateTime.make(bucket.reset_time ?? "").pipe(
        Option.filter((time) => DateTime.toEpochMillis(time) > 0),
      );
      return [
        {
          id: bucket.id,
          kind: window.kind,
          label: `${window.label} · ${groupLabel}`,
          modelIds,
          usedPercent: clampPercent((1 - bucket.remaining_fraction) * 100),
          windowDurationMins: window.mins,
          ...(Option.isSome(resetsAt) ? { resetsAt: DateTime.formatIso(resetsAt.value) } : {}),
        },
      ];
    });
  });
}

/**
 * Builds a rate-limited reader for one Antigravity instance. A read returns `undefined` when it
 * is skipped, still running elsewhere, or fails.
 */
export const makeAntigravityCliUsageReader = Effect.fn("makeAntigravityCliUsageReader")(
  function* (input: {
    readonly environment: NodeJS.ProcessEnv;
    readonly resolveExecutable: Effect.Effect<string, AntigravityInstallationError>;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const host = yield* ProviderHost.ProviderHost;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    let nextReadAt = 0;
    const inFlight = yield* Ref.make<Deferred.Deferred<
      ServerProviderUsageLimits | undefined
    > | null>(null);

    const read = Effect.fn("AntigravityCliUsage.read")(function* (
      models: ReadonlyArray<ServerProviderModel>,
    ) {
      const executable = yield* input.resolveExecutable;
      // Isolate PyInstaller's ~1 GB unpack dir so a timed-out force-kill does not leak into system temp.
      const tempDir = yield* Effect.acquireRelease(
        fs.makeTempDirectory({ prefix: "t3-agy-usage-" }),
        (dir) => fs.remove(dir, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const env = Object.fromEntries(
        Object.entries(input.environment).filter(
          ([key]) =>
            !/^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_GENAI_USE_VERTEXAI)$/i.test(
              key,
            ),
        ),
      );
      const stdout = yield* spawner.string(
        ChildProcess.make(executable, ["-p", "/usage", "--output-format", "json"], {
          cwd: tempDir,
          env: {
            ...env,
            AGY_CLI_DISABLE_AUTO_UPDATE: "true",
            BROWSER: "/usr/bin/false",
            TMPDIR: tempDir,
          },
          extendEnv: false,
          stdin: "ignore",
          stderr: "ignore",
          forceKillAfter: "2 seconds",
        }),
      );
      const output = decodeUsageOutput(stdout);
      if (Option.isNone(output)) return undefined;
      const windows = usageWindows(output.value, models);
      if (windows.length === 0) return undefined;
      return makeUsageLimits({ checkedAt: DateTime.formatIso(yield* DateTime.now), windows });
    }, Effect.scoped);

    return Effect.fn("AntigravityCliUsage.readIfDue")(function* (
      models: ReadonlyArray<ServerProviderModel>,
      options?: { readonly force?: boolean },
    ): Effect.fn.Return<ServerProviderUsageLimits | undefined> {
      if (!options?.force && !(yield* host.shouldRunBackgroundWork({ type: "provider-status" }))) {
        return undefined;
      }
      const existing = yield* Ref.get(inFlight);
      if (existing !== null) {
        return options?.force ? yield* Deferred.await(existing) : undefined;
      }
      const now = yield* Clock.currentTimeMillis;
      // Windows need models to map to, which arrive with the first session.
      if (models.length === 0 || (!options?.force && now < nextReadAt)) {
        return undefined;
      }
      const pending = yield* Deferred.make<ServerProviderUsageLimits | undefined>();
      const claimed = yield* Ref.modify(inFlight, (current) =>
        current === null ? ([null, pending] as const) : ([current, current] as const),
      );
      if (claimed !== null) {
        return options?.force ? yield* Deferred.await(claimed) : undefined;
      }
      // Failed reads back off too, so a broken sign-in does not start the CLI repeatedly.
      nextReadAt = now + MIN_READ_INTERVAL_MS;
      return yield* read(models).pipe(
        Effect.timeoutOption(READ_TIMEOUT),
        Effect.catch((cause) =>
          Effect.logDebug("Antigravity CLI usage read failed", cause).pipe(
            Effect.as(Option.none()),
          ),
        ),
        Effect.map(Option.getOrUndefined),
        Effect.tap((limits) => Deferred.succeed(pending, limits)),
        Effect.ensuring(
          Deferred.succeed(pending, undefined).pipe(
            Effect.andThen(
              Ref.update(inFlight, (current) => (current === pending ? null : current)),
            ),
          ),
        ),
      );
    });
  },
);
