// RETIRED ROUTE — Jobs is one screen now.
//
// The job & gig directory that used to live here is `JobAppsDirectory` in
// src/components/jobs/, rendered as the "Job & gig apps" tab of /app/jobs.
//
// Splitting Jobs across two routes meant two identical 18+ gates, two country
// pickers, two headers, and two tiles on the home grid whose names ("Jobs" and
// "Job apps") did not tell anyone which was which. One screen, one gate.
//
// This file stays as a redirect rather than being deleted: /app/jobs-apps has
// shipped, is in the Android build already on people's phones, and may be
// linked from the Play listing. A deleted route would 404 those users. The
// redirect is `replace` so it does not sit in the back stack — pressing back
// from Jobs should leave Jobs, not bounce through here again.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/app/jobs-apps")({
  beforeLoad: () => {
    throw redirect({ to: "/app/jobs", search: { tab: "apps" as const }, replace: true });
  },
});
