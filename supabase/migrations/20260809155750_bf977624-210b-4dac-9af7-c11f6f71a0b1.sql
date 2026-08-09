-- Stories ships switched OFF, and stays off until generation is priced.
--
-- The previous migration defaulted story_config.enabled to true, which was
-- written before anyone checked how the AI gateway is billed. It is billed out
-- of the SAME credit balance that builds ONIQ: deployed-app AI usage gets a
-- 4-credit monthly grant on every plan, it does not roll over, and once it is
-- gone further gateway usage draws general credits.
--
-- Four credits is roughly three moderate build prompts. Episode 3 alone was
-- ~120 generations. So a free tier served by the gateway is not a cost line,
-- it is a mechanism by which end users exhaust the pool the project is built
-- with — and unlike a metered bill, that pool running out stops the building
-- too.
--
-- Stories is therefore being rebuilt to render motion in-house on CPU. Until
-- that lands and the remaining per-Story gateway cost is measured rather than
-- guessed, the feature must not be reachable. A default of true is a feature
-- that turns itself on the moment someone deploys the screen.
--
-- Flipping it back is one UPDATE, deliberately: it should take a person who
-- knows the number, not a migration written by someone who did not.
alter table public.story_config alter column enabled set default false;

-- And turn off the row that already exists, if the first migration has been
-- applied anywhere. Not conditional on the current value: the only correct
-- state before pricing is off.
update public.story_config set enabled = false, updated_at = now() where id = true;