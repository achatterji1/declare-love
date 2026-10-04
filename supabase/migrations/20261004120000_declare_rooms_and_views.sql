create table if not exists public.declare_rooms (
  code text primary key,
  n integer not null,
  cards_n integer not null,
  seats jsonb not null default '[]'::jsonb,
  status text not null default 'lobby',
  state jsonb,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.declare_views (
  code text not null,
  seat integer not null,
  view jsonb not null,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (code, seat)
);

alter table public.declare_rooms enable row level security;
alter table public.declare_views enable row level security;

grant all on public.declare_rooms to service_role;
grant select on public.declare_views to anon, authenticated;
grant all on public.declare_views to service_role;

drop policy if exists "deny all" on public.declare_rooms;
create policy "deny all" on public.declare_rooms
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "views are publicly readable" on public.declare_views;
create policy "views are publicly readable" on public.declare_views
  for select to anon, authenticated
  using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'declare_views'
  ) then
    alter publication supabase_realtime add table public.declare_views;
  end if;
end $$;
