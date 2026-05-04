create extension if not exists pgcrypto;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  room_id text,
  user_id uuid references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  notes text,
  due_at timestamptz,
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  completed boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks add column if not exists room_id text;
alter table public.tasks alter column user_id drop not null;

update public.tasks
set room_id = 'legacy-auth-' || user_id::text
where room_id is null and user_id is not null;

delete from public.tasks where room_id is null;

alter table public.tasks alter column room_id set not null;

create index if not exists tasks_room_sort_idx on public.tasks (room_id, sort_order);
drop index if exists tasks_user_sort_idx;

alter table public.tasks enable row level security;

drop policy if exists "Users can read their own tasks" on public.tasks;
drop policy if exists "Users can insert their own tasks" on public.tasks;
drop policy if exists "Users can update their own tasks" on public.tasks;
drop policy if exists "Users can delete their own tasks" on public.tasks;
drop policy if exists "Rooms can read tasks" on public.tasks;
drop policy if exists "Rooms can insert tasks" on public.tasks;
drop policy if exists "Rooms can update tasks" on public.tasks;
drop policy if exists "Rooms can delete tasks" on public.tasks;

create policy "Rooms can read tasks"
  on public.tasks for select
  to anon
  using (room_id is not null);

create policy "Rooms can insert tasks"
  on public.tasks for insert
  to anon
  with check (room_id is not null);

create policy "Rooms can update tasks"
  on public.tasks for update
  to anon
  using (room_id is not null)
  with check (room_id is not null);

create policy "Rooms can delete tasks"
  on public.tasks for delete
  to anon
  using (room_id is not null);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row
  execute function public.set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.tasks;
exception
  when duplicate_object then null;
end;
$$;
