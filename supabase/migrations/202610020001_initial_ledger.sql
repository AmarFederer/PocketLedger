begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 60),
  currency text not null default 'INR' check (currency in ('USD', 'EUR', 'GBP', 'INR', 'JPY')),
  time_zone text not null default 'UTC',
  currency_locked boolean not null default false,
  onboarded boolean not null default false,
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  color text not null check (color in ('#287c62', '#dc9846', '#4786b8', '#bd6a83', '#827ab4', '#707e88')),
  archived boolean not null default false,
  unique (user_id, id)
);
create unique index category_names on public.categories(user_id, lower(name));

create table public.expenses (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null,
  amount_minor bigint not null check (amount_minor between 1 and 1000000000),
  expense_date date not null check (expense_date >= '1900-01-01'::date),
  merchant text not null check (length(trim(merchant)) between 1 and 100),
  note text not null default '' check (length(note) <= 500),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  foreign key (user_id, category_id) references public.categories(user_id, id)
);
create index expense_dates on public.expenses(user_id, expense_date);
create index expense_categories on public.expenses(user_id, category_id, expense_date);

create table public.monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  month date not null check (extract(day from month) = 1 and month >= '1900-01-01'::date),
  limit_minor bigint not null check (limit_minor between 1 and 1000000000),
  unique (user_id, month),
  unique (user_id, id)
);

create table public.category_budgets (
  user_id uuid not null references public.profiles(id) on delete cascade,
  monthly_budget_id uuid not null,
  category_id uuid not null,
  limit_minor bigint not null check (limit_minor between 1 and 1000000000),
  primary key (monthly_budget_id, category_id),
  foreign key (user_id, monthly_budget_id) references public.monthly_budgets(user_id, id) on delete cascade,
  foreign key (user_id, category_id) references public.categories(user_id, id)
);

create table public.mutation_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash text not null,
  revision integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  primary key (user_id, idempotency_key)
);
create index receipt_times on public.mutation_receipts(user_id, created_at);

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.expenses enable row level security;
alter table public.monthly_budgets enable row level security;
alter table public.category_budgets enable row level security;
alter table public.mutation_receipts enable row level security;
create policy own_profile on public.profiles for select to authenticated using (id = auth.uid());
create policy own_categories on public.categories for select to authenticated using (user_id = auth.uid());
create policy own_expenses on public.expenses for select to authenticated using (user_id = auth.uid());
create policy own_budgets on public.monthly_budgets for select to authenticated using (user_id = auth.uid());
create policy own_allocations on public.category_budgets for select to authenticated using (user_id = auth.uid());
create policy own_receipts on public.mutation_receipts for select to authenticated using (user_id = auth.uid());
revoke all on public.profiles, public.categories, public.expenses, public.monthly_budgets, public.category_budgets, public.mutation_receipts from anon, authenticated;

create function public.initialize_ledger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles(id, display_name)
    values (new.id, coalesce(nullif(left(trim(new.raw_user_meta_data->>'display_name'), 60), ''), 'My ledger'));
  insert into public.categories(user_id, name, color) values
    (new.id, 'Food & groceries', '#287c62'), (new.id, 'Shopping', '#dc9846'),
    (new.id, 'Transport', '#4786b8'), (new.id, 'Home & bills', '#bd6a83'),
    (new.id, 'Entertainment', '#827ab4'), (new.id, 'Health', '#707e88');
  return new;
end;
$$;
revoke all on function public.initialize_ledger() from public, anon, authenticated;
create trigger on_new_account after insert on auth.users for each row execute function public.initialize_ledger();

create function public.ledger_snapshot() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  owner_id uuid := auth.uid();
  result jsonb;
begin
  if owner_id is null or not exists (select 1 from auth.users where id = owner_id and email_confirmed_at is not null) then
    raise exception 'verified authentication required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'revision', profile.revision,
    'profile', jsonb_build_object('name', profile.display_name, 'currency', profile.currency, 'timeZone', profile.time_zone, 'currencyLocked', profile.currency_locked, 'onboarded', profile.onboarded),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', category.id, 'name', category.name, 'color', category.color, 'archived', category.archived) order by category.name) from public.categories category where category.user_id = owner_id), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(jsonb_build_object('id', expense.id, 'amount', expense.amount_minor, 'date', expense.expense_date, 'categoryId', expense.category_id, 'merchant', expense.merchant, 'note', expense.note, 'version', expense.version) order by expense.expense_date desc, expense.id) from public.expenses expense where expense.user_id = owner_id), '[]'::jsonb),
    'budgets', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(budget.month, 'YYYY-MM'), 'limit', budget.limit_minor, 'allocations', coalesce((select jsonb_object_agg(allocation.category_id::text, allocation.limit_minor) from public.category_budgets allocation where allocation.user_id = owner_id and allocation.monthly_budget_id = budget.id), '{}'::jsonb))) from public.monthly_budgets budget where budget.user_id = owner_id), '[]'::jsonb)
  ) into result from public.profiles profile where profile.id = owner_id;
  if result is null then raise exception 'profile missing'; end if;
  return result;
end;
$$;
revoke all on function public.ledger_snapshot() from public, anon;
grant execute on function public.ledger_snapshot() to authenticated;

create function public.apply_ledger_change(p_key uuid, p_revision integer, p_issued_at timestamptz, p_change jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  owner_id uuid := auth.uid();
  profile public.profiles%rowtype;
  receipt public.mutation_receipts%rowtype;
  old_expense public.expenses%rowtype;
  hash text := encode(sha256(convert_to(p_change::text, 'UTF8')), 'hex');
  operation text := p_change->>'type';
  payload jsonb;
  category_id uuid;
  archived boolean;
  budget_id uuid;
  budget_month date;
  allocation record;
  allocation_total bigint;
begin
  if owner_id is null or not exists (select 1 from auth.users where id = owner_id and email_confirmed_at is not null) then
    raise exception 'verified authentication required' using errcode = '42501';
  end if;
  if p_key is null or p_revision is null or p_change is null or p_issued_at is null or p_issued_at < now() - interval '7 days' or p_issued_at > now() + interval '5 minutes' then raise exception 'invalid or expired request'; end if;
  select * into profile from public.profiles where id = owner_id for update;
  if not found then raise exception 'profile missing'; end if;
  select * into receipt from public.mutation_receipts where user_id = owner_id and idempotency_key = p_key;
  if found then
    if receipt.request_hash <> hash then raise exception 'idempotency payload conflict'; end if;
    if receipt.expires_at <= now() then raise exception 'expired request'; end if;
    return public.ledger_snapshot();
  end if;
  if profile.revision <> p_revision then raise exception 'stale ledger revision'; end if;
  if (select count(*) from public.mutation_receipts where user_id = owner_id and created_at > now() - interval '1 minute') >= 60 then raise exception 'mutation rate exceeded'; end if;

  if operation = 'saveExpense' then
    if not profile.onboarded then raise exception 'complete onboarding'; end if;
    payload := p_change->'expense';
    select * into old_expense from public.expenses where id = (payload->>'id')::uuid and user_id = owner_id;
    if found and old_expense.version <> (payload->>'version')::integer then raise exception 'stale expense'; end if;
    category_id := (payload->>'categoryId')::uuid;
    select category.archived into archived from public.categories category where category.id = category_id and category.user_id = owner_id;
    if not found or (archived and old_expense.category_id is distinct from category_id) then raise exception 'inactive category'; end if;
    if payload->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or (payload->>'date')::date > (now() at time zone profile.time_zone)::date then raise exception 'invalid expense date'; end if;
    if old_expense.id is null then
      insert into public.expenses(id, user_id, category_id, amount_minor, expense_date, merchant, note)
        values ((payload->>'id')::uuid, owner_id, category_id, (payload->>'amount')::bigint, (payload->>'date')::date, trim(payload->>'merchant'), coalesce(payload->>'note', ''));
    else
      update public.expenses set category_id = (payload->>'categoryId')::uuid, amount_minor = (payload->>'amount')::bigint, expense_date = (payload->>'date')::date, merchant = trim(payload->>'merchant'), note = coalesce(payload->>'note', ''), version = version + 1 where id = old_expense.id and user_id = owner_id;
    end if;
    update public.profiles set currency_locked = true where id = owner_id;
  elsif operation = 'deleteExpense' then
    delete from public.expenses where id = (p_change->>'id')::uuid and user_id = owner_id and version = (p_change->>'version')::integer;
    if not found then raise exception 'stale or missing expense'; end if;
  elsif operation = 'saveBudget' then
    if not profile.onboarded then raise exception 'complete onboarding'; end if;
    payload := p_change->'budget';
    if payload->>'month' !~ '^\d{4}-\d{2}$' then raise exception 'invalid month'; end if;
    budget_month := ((payload->>'month') || '-01')::date;
    select id into budget_id from public.monthly_budgets where user_id = owner_id and month = budget_month;
    if jsonb_typeof(payload->'allocations') <> 'object' then raise exception 'invalid allocations'; end if;
    allocation_total := 0;
    for allocation in select * from jsonb_each_text(payload->'allocations') loop
      if allocation.value !~ '^\d+$' or allocation.value::bigint not between 1 and 1000000000 then raise exception 'invalid allocation'; end if;
      allocation_total := allocation_total + allocation.value::bigint;
      select category.archived into archived from public.categories category where category.id = allocation.key::uuid and category.user_id = owner_id;
      if not found or (archived and not exists (select 1 from public.category_budgets where monthly_budget_id = budget_id and category_budgets.category_id = allocation.key::uuid and user_id = owner_id)) then raise exception 'inactive allocation category'; end if;
    end loop;
    if allocation_total > (payload->>'limit')::bigint then raise exception 'allocations exceed overall budget'; end if;
    insert into public.monthly_budgets(user_id, month, limit_minor) values (owner_id, budget_month, (payload->>'limit')::bigint)
      on conflict (user_id, month) do update set limit_minor = excluded.limit_minor returning id into budget_id;
    delete from public.category_budgets where monthly_budget_id = budget_id and user_id = owner_id;
    for allocation in select * from jsonb_each_text(payload->'allocations') loop
      insert into public.category_budgets(user_id, monthly_budget_id, category_id, limit_minor) values (owner_id, budget_id, allocation.key::uuid, allocation.value::bigint);
    end loop;
    update public.profiles set currency_locked = true where id = owner_id;
  elsif operation = 'deleteBudget' then
    if p_change->>'month' !~ '^\d{4}-\d{2}$' then raise exception 'invalid month'; end if;
    delete from public.monthly_budgets where user_id = owner_id and month = ((p_change->>'month') || '-01')::date;
  elsif operation = 'saveCategory' then
    payload := p_change->'category';
    if exists (select 1 from public.categories where id = (payload->>'id')::uuid and user_id <> owner_id) then raise exception 'invalid category ownership'; end if;
    insert into public.categories(id, user_id, name, color, archived) values ((payload->>'id')::uuid, owner_id, trim(payload->>'name'), payload->>'color', (payload->>'archived')::boolean)
      on conflict (id) do update set name = excluded.name, color = excluded.color, archived = excluded.archived where categories.user_id = owner_id;
  elsif operation = 'saveProfile' then
    payload := p_change->'profile';
    if profile.currency_locked and payload->>'currency' <> profile.currency then raise exception 'currency locked'; end if;
    if not exists (select 1 from pg_timezone_names where name = payload->>'timeZone') then raise exception 'invalid time zone'; end if;
    update public.profiles set display_name = trim(payload->>'name'), currency = payload->>'currency', time_zone = payload->>'timeZone', onboarded = true where id = owner_id;
  else
    raise exception 'unknown change';
  end if;
  update public.profiles set revision = revision + 1 where id = owner_id;
  insert into public.mutation_receipts(user_id, idempotency_key, request_hash, revision) values (owner_id, p_key, hash, profile.revision + 1);
  return public.ledger_snapshot();
end;
$$;
revoke all on function public.apply_ledger_change(uuid, integer, timestamptz, jsonb) from public, anon;
grant execute on function public.apply_ledger_change(uuid, integer, timestamptz, jsonb) to authenticated;

commit;