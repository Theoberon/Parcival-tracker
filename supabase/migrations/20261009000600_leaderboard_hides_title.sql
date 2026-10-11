-- Titles (Director, Senior Manager ...) are for organizers. The member leaderboard and the projector
-- board must not show them, so the function behind them stops returning the column at all.
-- Admins still get titles from get_admin_leaderboard(); a member can only ever read their own row of
-- `members` (their own title), never teammates'.

drop function get_leaderboard();

create function get_leaderboard()
returns table (display_name text, points int, tasks_completed int, rank int, reached_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not (is_member() or is_admin()) then
    raise exception 'forbidden: Login required.' using errcode = '42501';
  end if;
  return query
    select st.display_name, st.points, st.tasks_completed, st.rank, st.reached_at,
           (st.member_id = auth.uid())
    from _standings(current_contest_id()) st
    where st.active
    order by st.ord;
end $$;

revoke all on function get_leaderboard() from public, anon, authenticated;
grant execute on function get_leaderboard() to service_role, authenticated;
