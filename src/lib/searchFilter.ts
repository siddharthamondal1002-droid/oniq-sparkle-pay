/**
 * SECURITY — neutralise PostgREST filter-injection in user-typed search.
 *
 * Several people-search boxes build a PostgREST filter by hand:
 *
 *   .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
 *
 * PostgREST parses that argument as a boolean expression, splitting on
 * top-level commas and grouping with parentheses. So a `q` containing `,`,
 * `(` or `)` breaks out of the intended `ilike` term and injects arbitrary
 * additional conditions on the SAME table — e.g. typing
 *
 *   x,is_admin.eq.true,username.ilike.%
 *
 * turns the OR list into one that also matches `is_admin.eq.true`, returning
 * every admin profile regardless of name. It can also use any other visible
 * boolean column as an oracle. The blast radius is bounded to the queried
 * table and its RLS (`.or()` cannot reach other tables), but it is a real
 * injection, not a theoretical one.
 *
 * The fix is to strip the characters that STRUCTURE that grammar before
 * interpolation: comma, parentheses, and backslash. `%` and `_` are left
 * intact — they are `ilike` wildcards, not breakout characters, and removing
 * them would change matching behaviour without adding any safety.
 */
export function sanitizeLikeQuery(term: string): string {
  return term.replace(/[,()\\]/g, "").trim();
}
