grant all on public.declare_rooms to service_role;
grant select on public.declare_views to anon;
grant select on public.declare_views to authenticated;
grant all on public.declare_views to service_role;
drop policy if exists "deny all" on public.declare_rooms;
create policy "deny all" on public.declare_rooms for all to anon, authenticated using (false) with check (false);
drop policy if exists "views are publicly readable" on public.declare_views;
create policy "views are publicly readable" on public.declare_views for select to anon, authenticated using (true);