-- Contestant "title" (e.g. "HubSpot Specialist"): collected in the registration Form, synced by Apps Script,
-- shown to admins (the member leaderboard hides it: see the next migration). Optional; people who registered before this
-- existed simply have none.
--
-- The standings functions gain a column, which Postgres only allows by dropping and recreating them.

alter table members add column title text
  check (title is null or char_length(btrim(title)) between 1 and 80);

-- Store titles tidy: trimmed, and a blank title is no title.
create function trg_members_title() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  new.title := nullif(btrim(new.title), '');
  return new;
end $$;
create trigger members_title_tidy before insert or update of title on members
  for each row execute function trg_members_title();

drop function get_leaderboard();
drop function get_admin_leaderboard();
drop function _standings(uuid);

create function _standings(p_contest uuid)
returns table (member_id uuid, email citext, display_name text, title text, active boolean, points int,
               tasks_completed int, reached_at timestamptz, pending_count int, rank int, ord int)
language sql stable security definer set search_path = public, pg_temp as $$
  with agg as (
    select m.id, m.email, m.display_name, m.title, m.active,
           coalesce(sum(s.points_awarded) filter (where s.status = 'approved'), 0)::int as pts,
           (count(*) filter (where s.status = 'approved'))::int as tasks,
           max(s.submitted_at) filter (where s.status = 'approved') as reached,
           (count(*) filter (where s.status = 'pending'))::int as pend
    from members m
    left join submissions s on s.member_id = m.id
    where m.contest_id = p_contest
    group by m.id
  )
  select a.id, a.email, a.display_name, a.title, a.active, a.pts, a.tasks, a.reached, a.pend,
         case when a.active and a.pts > 0 then
           (row_number() over (partition by (a.active and a.pts > 0)
                               order by a.pts desc, a.reached asc nulls last, lower(a.display_name)))::int
         end,
         (row_number() over (order by a.active desc, (a.pts > 0) desc, a.pts desc,
                             a.reached asc nulls last, lower(a.display_name)))::int
  from agg a
$$;

create function get_leaderboard()
returns table (display_name text, title text, points int, tasks_completed int, rank int, reached_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not (is_member() or is_admin()) then
    raise exception 'forbidden: Login required.' using errcode = '42501';
  end if;
  return query
    select st.display_name, st.title, st.points, st.tasks_completed, st.rank, st.reached_at,
           (st.member_id = auth.uid())
    from _standings(current_contest_id()) st
    where st.active
    order by st.ord;
end $$;

create function get_admin_leaderboard()
returns table (member_id uuid, email citext, display_name text, title text, points int, tasks_completed int,
               rank int, reached_at timestamptz, pending_count int, active boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  perform _require_admin();
  return query
    select st.member_id, st.email, st.display_name, st.title, st.points, st.tasks_completed, st.rank,
           st.reached_at, st.pending_count, st.active
    from _standings(current_contest_id()) st
    order by st.ord;
end $$;

-- same access as before: nobody by default; signed-in users may call the two RPCs (they check the role inside)
revoke all on function _standings(uuid), get_leaderboard(), get_admin_leaderboard() from public, anon, authenticated;
grant execute on function _standings(uuid), get_leaderboard(), get_admin_leaderboard() to service_role;
grant execute on function get_leaderboard(), get_admin_leaderboard() to authenticated;

-- New functions are closed by default. (Postgres grants EXECUTE to PUBLIC on every new function unless
-- that default is revoked globally; the schema-level revoke in the security migration does not remove it.)
revoke all on function trg_members_title() from public, anon, authenticated;
alter default privileges revoke execute on functions from public;
