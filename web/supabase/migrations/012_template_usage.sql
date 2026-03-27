-- Track per-user template usage so sorting persists across devices
create table template_usage (
  user_id  uuid not null references auth.users on delete cascade,
  template_id text not null references templates(id) on delete cascade,
  usage_count int not null default 1,
  last_used_at timestamptz not null default now(),
  primary key (user_id, template_id)
);

alter table template_usage enable row level security;

create policy "Users can view own usage"
  on template_usage for select
  using (auth.uid() = user_id);

create policy "Users can insert own usage"
  on template_usage for insert
  with check (auth.uid() = user_id);

create policy "Users can update own usage"
  on template_usage for update
  using (auth.uid() = user_id);

-- Atomic upsert: insert or increment usage_count
create or replace function increment_template_usage(
  p_user_id uuid,
  p_template_id text
) returns void as $$
begin
  insert into template_usage (user_id, template_id, usage_count, last_used_at)
  values (p_user_id, p_template_id, 1, now())
  on conflict (user_id, template_id)
  do update set
    usage_count = template_usage.usage_count + 1,
    last_used_at = now();
end;
$$ language plpgsql security definer;
