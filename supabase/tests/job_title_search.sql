-- Job title search (supabase/migrations/20261022120000_job_title_search.sql).
-- Runs in a transaction that always rolls back:
--   npx supabase db query --linked -f supabase/tests/job_title_search.sql
-- Any failed check raises an exception; success prints 'job_title_search: ok'.

begin;

do $$
declare
  v_id uuid;
  v_search text;
begin
  -- Normalization.
  if public.job_title_search_text('Full-Stack Developer (React/Node.js)')
     <> 'full stack developer react node js | fullstack stackdeveloper developerreact reactnode nodejs' then
    raise exception 'normalizes words and joins adjacent pairs';
  end if;
  if public.job_title_search_text('C++ / C# Engineer') <> 'c++ c# engineer | c++c# c#engineer' then
    raise exception 'keeps + and # inside words';
  end if;
  if public.job_title_search_text('Engineer') <> 'engineer | ' then
    raise exception 'one word has no pairs';
  end if;
  if public.job_title_search_text(null) <> '' or public.job_title_search_text(' - ') <> '' then
    raise exception 'empty titles give an empty string';
  end if;

  -- The spellings meet: what the query side searches for each of them.
  if not public.job_title_search_text('Full Stack Developer') ~* '(^| )fullstack' then
    raise exception '"fullstack" finds "Full Stack"';
  end if;
  if not public.job_title_search_text('Fullstack Developer') ~* '(^| )full stack|(^| )fullstack' then
    raise exception '"full stack" finds "Fullstack"';
  end if;
  if public.job_title_search_text('Airspace Training Supervisor') ~* '(^| )ai( |$)' then
    raise exception '"ai" must not find "Airspace"';
  end if;

  -- The trigger keeps the column in step with the title. Uses an existing
  -- row: inserting one would fire the embedding trigger.
  select id into v_id from public.all_jobs limit 1;
  if v_id is not null then
    update public.all_jobs set job_name = 'Front-End Engineer' where id = v_id;
    select job_name_search into v_search from public.all_jobs where id = v_id;
    if v_search <> 'front end engineer | frontend endengineer' then
      raise exception 'trigger fills job_name_search on update (got %)', v_search;
    end if;

    -- Updates that don't touch the title leave the column alone.
    update public.all_jobs set job_name_search = 'untouched' where id = v_id;
    update public.all_jobs set status = status where id = v_id;
    select job_name_search into v_search from public.all_jobs where id = v_id;
    if v_search <> 'untouched' then
      raise exception 'trigger only runs on job_name updates (got %)', v_search;
    end if;
  end if;
end;
$$;

select 'job_title_search: ok' as result;

rollback;
