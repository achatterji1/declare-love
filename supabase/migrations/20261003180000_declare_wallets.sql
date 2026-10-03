create table if not exists public.declare_wallets (
  id text primary key,
  chips integer not null check (chips >= 0),
  claim_available_at timestamptz,
  version integer not null default 0,
  applied_keys jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.declare_wallets enable row level security;

grant all on public.declare_wallets to service_role;
