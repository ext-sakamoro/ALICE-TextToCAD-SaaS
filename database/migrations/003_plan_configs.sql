create table if not exists public.plan_configs (
  id uuid primary key default uuid_generate_v4(),
  plan_name text unique not null, max_projects int default 5, max_api_calls_per_hour int default 100,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
insert into public.plan_configs (plan_name, max_projects, max_api_calls_per_hour) values ('Free',5,100),('Pro',100,10000),('Enterprise',-1,-1) on conflict (plan_name) do nothing;
