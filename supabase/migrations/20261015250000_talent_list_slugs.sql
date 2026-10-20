-- Talent lists as tabs (PL-TASK-051): /company/profiles?tab=<slug>.
--
-- A list's slug is its name lowercased, with every run of other characters
-- turned into one hyphen ("Backend shortlist" → backend-shortlist). The app
-- computes it (slugifyListName, utils/talent-list-tabs.ts) on create and
-- rename. It's unique per company, so two lists can't share a name, and it's
-- never a built-in tab ("all", "saved").

alter table public.talent_lists add column if not exists slug text;

-- Backfill with the same rule. An empty or reserved slug gets "list" in it,
-- and the rare duplicate a numeric suffix (oldest list keeps the plain slug).
with base as (
  select id, company_id, created_at,
         nullif(trim(both '-' from regexp_replace(lower(name), '[^[:alnum:]]+', '-', 'g')), '') as s
    from public.talent_lists
   where slug is null
),
safe as (
  select id, company_id, created_at,
         case
           when s is null then 'list'
           when s in ('all', 'saved') then s || '-list'
           else left(s, 60)
         end as s
    from base
),
numbered as (
  select id, s,
         row_number() over (partition by company_id, s order by created_at, id) as n
    from safe
)
update public.talent_lists t
   set slug = case when numbered.n = 1 then numbered.s else left(numbered.s, 55) || '-' || numbered.n end
  from numbered
 where t.id = numbered.id;

alter table public.talent_lists alter column slug set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'talent_lists_slug_check') then
    alter table public.talent_lists add constraint talent_lists_slug_check
      check (char_length(slug) between 1 and 60 and slug not in ('all', 'saved'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'talent_lists_company_slug_key') then
    alter table public.talent_lists add constraint talent_lists_company_slug_key
      unique (company_id, slug);
  end if;
end $$;
