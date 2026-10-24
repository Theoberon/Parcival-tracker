-- Return the approved submission count for each active category on every leaderboard row.
-- The setup migrations create this function earlier, then the title migration replaces it.
drop function get_leaderboard();

create function get_leaderboard()
returns table (
  display_name text,
  points int,
  tasks_completed int,
  rank int,
  reached_at timestamptz,
  is_me boolean,
  category_counts jsonb
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not (is_member() or is_admin()) then
    raise exception 'forbidden: Login required.' using errcode = '42501';
  end if;
  return query
    select st.display_name, st.points, st.tasks_completed, st.rank, st.reached_at,
           (st.member_id = auth.uid()), coalesce(counts.by_category, '{}'::jsonb)
    from _standings(current_contest_id()) st
    left join lateral (
      select jsonb_object_agg(category_totals.category_id::text, category_totals.task_count
                              order by category_totals.sort_order) as by_category
      from (
        select c.id as category_id, c.sort_order, count(s.id)::int as task_count
        from categories c
        left join submissions s
          on s.contest_id = c.contest_id
         and s.category_id = c.id
         and s.member_id = st.member_id
         and s.status = 'approved'
        where c.contest_id = current_contest_id()
          and c.active
        group by c.id, c.sort_order
      ) category_totals
    ) counts on true
    where st.active
    order by st.ord;
end $$;

revoke all on function get_leaderboard() from public, anon, authenticated;
grant execute on function get_leaderboard() to service_role, authenticated;