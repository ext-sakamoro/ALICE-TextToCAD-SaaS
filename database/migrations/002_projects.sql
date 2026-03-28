create table if not exists public.projects (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid references public.profiles(id) on delete cascade not null,
  name text not null default 'Untitled', config jsonb default '{}', is_public boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists idx_projects_owner on public.projects(owner_id);
alter table public.projects enable row level security;
create policy "Users can view own projects" on public.projects for select using (auth.uid() = owner_id or is_public = true);
create policy "Users can create projects" on public.projects for insert with check (auth.uid() = owner_id);
create policy "Users can update own projects" on public.projects for update using (auth.uid() = owner_id);
create policy "Users can delete own projects" on public.projects for delete using (auth.uid() = owner_id);
