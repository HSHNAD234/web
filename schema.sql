-- Run this once in Supabase Dashboard > SQL Editor.
create table if not exists public.players (
    steam_id text primary key check (steam_id ~ '^[0-9]{17}$'),
    display_name text not null default 'Player' check (char_length(display_name) between 1 and 64),
    level integer not null default 1 check (level >= 1),
    experience bigint not null default 0 check (experience >= 0),
    gold bigint not null default 0 check (gold >= 0),
    gem bigint not null default 0 check (gem >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.server_settings (
    id text primary key default 'main' check (id = 'main'),
    is_online boolean not null default true,
    closed_until timestamptz,
    correct_version boolean not null default true,
    server_version text not null default '1.0.6.0',
    server_dev_version text not null default '0.0.0.1',
    updated_at timestamptz not null default now()
);

alter table public.players enable row level security;
alter table public.server_settings enable row level security;

revoke all on public.players from anon, authenticated;
revoke all on public.server_settings from anon, authenticated;
grant all on public.players to service_role;
grant all on public.server_settings to service_role;

insert into public.server_settings (id) values ('main') on conflict (id) do nothing;
