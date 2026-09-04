import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Flame } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { HEALTH_BLOCKED_MESSAGE, healthWritesAllowed } from "@/lib/healthGuard";
import {
  cycleSummary,
  exerciseStreak,
  METRICS,
  sparkPoints,
  summarise,
  type Metric,
  type Reading,
  type Summary,
} from "@/lib/insights";
import {
  OniqCanvas,
  OniqCard,
  OniqEmpty,
  OniqHeader,
  OniqSectionHeader,
  OniqSkeletonRows,
} from "@/components/oniq";

export const Route = createFileRoute("/_authenticated/app/insights")({
  component: InsightsScreen,
});

/**
 * INSIGHTS — the person's own logs, read back to them.
 *
 * Owner reference, 2026-09-04. Everything here comes from rows the person
 * wrote themselves in Vitals: `health_checkins` and `cycle_logs`, both
 * row-level-secured to their own account. Nothing is generated, nothing is
 * inferred from anyone else's data, and no model is called — which is why this
 * screen carries no AI label. Putting one on a page of a person's own numbers
 * would be a false claim in the other direction.
 *
 * THE ARITHMETIC LIVES IN src/lib/insights.ts and is unit-tested there,
 * including every case where it declines to draw a conclusion. This file is
 * the rendering of those answers and adds no reasoning of its own.
 *
 * NOT A DIAGNOSIS, AND NOT A SCORECARD. Direction is shown; goodness is not.
 * More sleep is usually better and more sleep can be a symptom, and nothing
 * here can tell which — so nothing is coloured green or red.
 *
 * WHY 60 DAYS. Two months is long enough for the halves the trend compares to
 * be halves of something, and short enough that a change of season or of job
 * does not sit inside one window pretending to be a trend.
 */
const WINDOW_DAYS = 60;
const SPARK_W = 120;
const SPARK_H = 28;

type Checkin = {
  day: string;
  mood: number | null;
  energy: number | null;
  sleep_hrs: number | null;
  water_glasses: number | null;
  exercised: boolean | null;
};

function since(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function readingsFor(rows: Checkin[], metric: Metric): Reading[] {
  return rows
    .map((r) => ({ day: r.day, value: r[metric.id] }))
    .filter((r): r is Reading => typeof r.value === "number");
}

function InsightsScreen() {
  const allowed = healthWritesAllowed();

  const { data: rows, isPending: rowsPending } = useQuery({
    queryKey: ["insights-checkins"],
    enabled: allowed,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [] as Checkin[];
      const { data } = await supabase
        .from("health_checkins")
        .select("day, mood, energy, sleep_hrs, water_glasses, exercised")
        .eq("user_id", u.user.id)
        .gte("day", since(WINDOW_DAYS))
        .order("day", { ascending: false });
      return (data as Checkin[]) ?? [];
    },
  });

  const { data: cycles, isPending: cyclesPending } = useQuery({
    queryKey: ["insights-cycles"],
    enabled: allowed,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [] as string[];
      const { data } = await supabase
        .from("cycle_logs")
        .select("period_start")
        .eq("user_id", u.user.id)
        .order("period_start", { ascending: false })
        .limit(12);
      return ((data as { period_start: string }[]) ?? []).map((r) => r.period_start);
    },
  });

  // The two axes of the UAE health block. Vitals stops the WRITE; this screen
  // has nothing to read, so it says why rather than showing an empty shelf.
  if (!allowed) {
    return (
      <OniqCanvas world="vitals" className="pb-28">
        <OniqHeader eyebrow="Vitals" title="Insights" back="/app/vitals" />
        <div className="mt-4 px-5">
          <OniqEmpty emoji="🔒" title="Not available here" body={HEALTH_BLOCKED_MESSAGE} />
        </div>
      </OniqCanvas>
    );
  }

  const loading = rowsPending || cyclesPending;
  const checkins = rows ?? [];
  const tracked = METRICS.map((metric) => ({
    metric,
    readings: readingsFor(checkins, metric),
  }));
  const withData = tracked.filter((t) => t.readings.length > 0);
  const untracked = tracked.filter((t) => t.readings.length === 0).map((t) => t.metric.label);
  const streak = exerciseStreak(checkins);
  const cycle = cycleSummary(cycles ?? []);

  return (
    <OniqCanvas world="vitals" className="pb-28">
      <OniqHeader
        eyebrow="Vitals"
        title="Insights"
        subtitle={`Your own logs, over the last ${WINDOW_DAYS} days.`}
        back="/app/vitals"
      />

      <div className="mt-4 px-5">
        {loading ? (
          <OniqSkeletonRows rows={3} />
        ) : withData.length === 0 ? (
          <OniqEmpty
            emoji="📈"
            title="Nothing to show yet"
            body="Check in on Vitals for a few days and your trends appear here."
          />
        ) : (
          <div className="grid gap-2">
            {withData.map(({ metric, readings }) => (
              <MetricCard key={metric.id} metric={metric} readings={readings} />
            ))}
          </div>
        )}

        {!loading && streak > 0 ? (
          <OniqCard variant="surface" className="mt-2 p-4" testId="insight-streak">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 shrink-0 text-world" aria-hidden="true" />
              <span className="text-[13px] text-foreground">
                {streak === 1
                  ? "1 day of exercise in a row"
                  : `${streak} days of exercise in a row`}
              </span>
            </div>
          </OniqCard>
        ) : null}

        {!loading && cycle.lastStart ? (
          <div className="mt-6">
            <OniqSectionHeader eyebrow="Cycle" title="What you've logged" />
            <OniqCard variant="surface" className="mt-3 p-4" testId="insight-cycle">
              <p className="text-[13px] text-foreground">Last period began {cycle.lastStart}.</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {/* An average over one gap is that gap. It says how many it had. */}
                {cycle.averageLength === null
                  ? "Log another period to see an average length."
                  : `About ${Math.round(cycle.averageLength)} days between periods, over ${cycle.measuredOver} gaps.`}
              </p>
            </OniqCard>
          </div>
        ) : null}

        {!loading && untracked.length > 0 ? (
          <p className="mt-4 text-[12px] text-muted-foreground">
            Nothing logged yet for {untracked.join(", ")}.
          </p>
        ) : null}

        <p className="mt-4 text-[11px] text-muted-foreground">
          {/* The same standing line Vitals carries, for the same reason. */}
          Informational only — not a diagnosis. See a real doctor 🩺
        </p>
      </div>
    </OniqCanvas>
  );
}

function MetricCard({ metric, readings }: { metric: Metric; readings: Reading[] }) {
  const summary = summarise(readings, metric.flatBand);
  const points = sparkPoints(readings, SPARK_W, SPARK_H);
  const latest = summary.latest;

  return (
    <OniqCard variant="surface" className="p-4" testId={`insight-${metric.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] text-muted-foreground">{metric.label}</p>
          <p className="text-[20px] font-semibold text-foreground">
            {latest ? latest.value.toFixed(metric.places) : "—"}
            <span className="text-[12px] font-normal text-muted-foreground">{metric.unit}</span>
          </p>
          <TrendLine metric={metric} summary={summary} />
        </div>
        <Spark points={points} label={metric.label} />
      </div>
    </OniqCard>
  );
}

/** Direction and size. Never a verdict — see the header of insights.ts. */
function TrendLine({ metric, summary }: { metric: Metric; summary: Summary }) {
  if (summary.trend === "unknown" || summary.change === null) {
    return (
      <p className="mt-1 text-[12px] text-muted-foreground">
        {summary.count === 1
          ? "1 reading — not enough for a trend yet"
          : `${summary.count} readings — not enough for a trend yet`}
      </p>
    );
  }
  const Icon =
    summary.trend === "up" ? ArrowUpRight : summary.trend === "down" ? ArrowDownRight : ArrowRight;
  const size = Math.abs(summary.change).toFixed(metric.places);
  return (
    <p className="mt-1 flex items-center gap-1 text-[12px] text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {summary.trend === "flat"
        ? `About the same across ${summary.count} readings`
        : `${summary.trend === "up" ? "Up" : "Down"} ${size}${metric.unit} across ${summary.count} readings`}
    </p>
  );
}

/**
 * The shape of the run. Decorative by design — every number it could be read
 * for is printed beside it in words, so it carries aria-hidden rather than a
 * description a screen reader would have to interpret from a path.
 */
function Spark({ points, label }: { points: Array<{ x: number; y: number }>; label: string }) {
  if (points.length === 0) return null;
  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="shrink-0 overflow-visible text-world"
      role="img"
      aria-label={`${label} over time`}
    >
      {points.length === 1 ? (
        // One reading is a point, not a line: a line between nothing and
        // itself would imply a direction that was never measured.
        <circle cx={points[0].x} cy={points[0].y} r="2.5" fill="currentColor" />
      ) : (
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
