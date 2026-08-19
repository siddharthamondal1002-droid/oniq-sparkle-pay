/**
 * The one distinction ~30 ONIQ screens were missing: a query that FAILED is
 * not a query that returned NOTHING.
 *
 * The 2026-08-19 audit found the same shape everywhere —
 *   const { data } = await supabase...; return data ?? []
 * The queryFn swallowed the Supabase error into an empty return, so React
 * Query recorded SUCCESS-with-no-rows and the screen rendered its "you have
 * nothing" empty state over what was really a network/DB failure. On money,
 * health and consent surfaces that reads as data loss.
 *
 * The fix has two halves and this helper is the second:
 *   1. queryFn THROWS on error (`if (error) throw error`) so React Query can
 *      actually see the failure — otherwise isError is never true.
 *   2. the view is chosen from the real state, here, once, testably.
 *
 * `isEmpty` is supplied by the caller because emptiness is shape-specific
 * (null profile, [] list, 0 rows). Everything else is uniform.
 */
export type ViewState = "loading" | "error" | "empty" | "data";

export function viewState(
  q: { isLoading: boolean; isError: boolean },
  isEmpty: boolean,
): ViewState {
  // Error wins over a stale loading flag: a background refetch that is failing
  // should surface the failure, never a spinner that hides it.
  if (q.isError) return "error";
  if (q.isLoading) return "loading";
  return isEmpty ? "empty" : "data";
}
