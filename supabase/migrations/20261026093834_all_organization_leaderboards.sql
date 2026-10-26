-- Admins can compare live leaderboards across organisations. The selected/own organisation
-- is returned first; the participant data remains limited to public leaderboard fields.
create function get_running_organization_leaderboards()
returns table (
  organization_id uuid,
  organization_name text,
  is_current_organization boolean,
  contest_id uuid,
  contest_name text,
  start_at timestamptz,
  end_at timestamptz,
  categories jsonb,
  member_id uuid,
  display_name text,
  points int,
  tasks_completed int,
  rank int,
  is_me boolean,
  category_counts jsonb,
  member_order int
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not is_admin() then
    raise exception 'forbidden: Admins only.' using errcode = '42501';
  end if;

  return query
  with running_contests as (
    select o.id as organization_id,
           o.name as organization_name,
           (o.id = current_organization_id()) as is_current_organization,
           c.id as contest_id,
           c.name as contest_name,
           c.start_at,
           c.end_at
    from organizations o
    join lateral (
      select current_contest.*
      from contests current_contest
      where current_contest.organization_id = o.id
      order by current_contest.created_at desc
      limit 1
    ) c on true
    where contest_effective_status(c.id) = 'open'
  )
  select rc.organization_id,
         rc.organization_name,
         rc.is_current_organization,
         rc.contest_id,
         rc.contest_name,
         rc.start_at,
         rc.end_at,
         coalesce(category_list.categories, '[]'::jsonb),
         st.member_id,
         st.display_name,
         st.points,
         st.tasks_completed,
         st.rank,
         coalesce(st.member_id = auth.uid(), false),
         coalesce(st.category_counts, '{}'::jsonb),
         st.ord
  from running_contests rc
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'points', c.points,
        'reference_label', c.reference_label,
        'reference_hint', c.reference_hint,
        'active', c.active,
        'sort_order', c.sort_order
      ) order by c.sort_order
    ) as categories
    from categories c
    where c.contest_id = rc.contest_id and c.active
  ) category_list on true
  left join lateral (
    select standings.*
    from _standings(rc.contest_id) standings
    where standings.active
    order by standings.ord
  ) st on true
  order by rc.is_current_organization desc, lower(rc.organization_name), st.ord nulls last;
end $$;

revoke all on function get_running_organization_leaderboards() from public, anon, authenticated;
grant execute on function get_running_organization_leaderboards() to authenticated, service_role;