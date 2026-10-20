-- Substring filters on talent-pool profiles (/company/profiles).
--
-- PostgREST can't `ilike` inside a text[] column, so each filterable array gets
-- a computed field: a function over the user_info row that PostgREST exposes as
-- a column, e.g. `?desired_roles_search=ilike.*backend*`. The elements are
-- lowercased and joined with a newline, which the app strips from search terms,
-- so a term never matches across two elements.

create or replace function public.desired_roles_search(public.user_info)
returns text
language sql
immutable
as $$ select lower(array_to_string($1.desired_roles, E'\n')) $$;

create or replace function public.top_skills_search(public.user_info)
returns text
language sql
immutable
as $$ select lower(array_to_string($1.top_skills, E'\n')) $$;

create or replace function public.work_style_preferences_search(public.user_info)
returns text
language sql
immutable
as $$ select lower(array_to_string($1.work_style_preferences, E'\n')) $$;

create or replace function public.industry_preferences_search(public.user_info)
returns text
language sql
immutable
as $$ select lower(array_to_string($1.industry_preferences, E'\n')) $$;
