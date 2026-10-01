begin;

create or replace function public.apply_ledger_change(p_key uuid, p_revision integer, p_issued_at timestamptz, p_change jsonb) returns jsonb
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
  uuid_pattern text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if owner_id is null or not exists (select 1 from auth.users where id = owner_id and email_confirmed_at is not null) then
    raise exception 'verified authentication required' using errcode = '42501';
  end if;
  if p_key is null or p_revision is null or p_revision < 0 or p_change is null or p_issued_at is null or p_issued_at < now() - interval '7 days' or p_issued_at > now() + interval '5 minutes' then raise exception 'invalid or expired request'; end if;
  if jsonb_typeof(p_change) is distinct from 'object' or jsonb_typeof(p_change->'type') is distinct from 'string' then raise exception 'invalid change payload'; end if;
  if operation not in ('saveExpense', 'deleteExpense', 'saveBudget', 'deleteBudget', 'saveCategory', 'saveProfile') then raise exception 'unknown change'; end if;

  if operation in ('saveExpense', 'saveBudget', 'saveCategory', 'saveProfile') then
    payload := p_change->case operation when 'saveExpense' then 'expense' when 'saveBudget' then 'budget' when 'saveCategory' then 'category' else 'profile' end;
    if jsonb_typeof(payload) is distinct from 'object' then raise exception 'invalid change payload'; end if;
  else
    payload := p_change;
  end if;
  if operation in ('saveExpense', 'deleteExpense', 'saveCategory') then
    if jsonb_typeof(payload->'id') is distinct from 'string' or not coalesce(payload->>'id' ~ uuid_pattern, false) then raise exception 'invalid change payload'; end if;
  end if;
  if operation in ('saveExpense', 'deleteExpense') then
    if jsonb_typeof(payload->'version') is distinct from 'number' or not coalesce(payload->>'version' ~ '^[0-9]+$', false) then raise exception 'invalid change payload'; end if;
    if (payload->>'version')::numeric not between 1 and 2147483647 then raise exception 'invalid change payload'; end if;
  end if;
  if operation = 'saveExpense' then
    if jsonb_typeof(payload->'categoryId') is distinct from 'string' or not coalesce(payload->>'categoryId' ~ uuid_pattern, false)
      or jsonb_typeof(payload->'date') is distinct from 'string'
      or jsonb_typeof(payload->'merchant') is distinct from 'string'
      or jsonb_typeof(payload->'note') is distinct from 'string'
      or jsonb_typeof(payload->'amount') is distinct from 'number'
      or not coalesce(payload->>'amount' ~ '^[0-9]+$', false) then raise exception 'invalid change payload'; end if;
    if (payload->>'amount')::numeric not between 1 and 1000000000 then raise exception 'invalid change payload'; end if;
  elsif operation in ('saveBudget', 'deleteBudget') then
    if jsonb_typeof(payload->'month') is distinct from 'string' or not coalesce(payload->>'month' ~ '^\d{4}-\d{2}$', false) then raise exception 'invalid month'; end if;
    if operation = 'saveBudget' then
      if jsonb_typeof(payload->'limit') is distinct from 'number' or not coalesce(payload->>'limit' ~ '^[0-9]+$', false) then raise exception 'invalid change payload'; end if;
      if (payload->>'limit')::numeric not between 1 and 1000000000 then raise exception 'invalid change payload'; end if;
      if jsonb_typeof(payload->'allocations') is distinct from 'object' then raise exception 'invalid allocations'; end if;
      for allocation in select * from jsonb_each(payload->'allocations') loop
        if allocation.key !~ uuid_pattern or jsonb_typeof(allocation.value) is distinct from 'number' then raise exception 'invalid allocation'; end if;
      end loop;
    end if;
  elsif operation = 'saveCategory' then
    if jsonb_typeof(payload->'name') is distinct from 'string' or jsonb_typeof(payload->'color') is distinct from 'string'
      or jsonb_typeof(payload->'archived') is distinct from 'boolean' then raise exception 'invalid change payload'; end if;
  elsif operation = 'saveProfile' then
    if jsonb_typeof(payload->'name') is distinct from 'string' or jsonb_typeof(payload->'currency') is distinct from 'string'
      or jsonb_typeof(payload->'timeZone') is distinct from 'string' or jsonb_typeof(payload->'currencyLocked') is distinct from 'boolean'
      or jsonb_typeof(payload->'onboarded') is distinct from 'boolean' then raise exception 'invalid change payload'; end if;
  end if;

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
    select * into old_expense from public.expenses where id = (payload->>'id')::uuid and user_id = owner_id;
    if found and old_expense.version <> (payload->>'version')::integer then raise exception 'stale expense'; end if;
    category_id := (payload->>'categoryId')::uuid;
    select category.archived into archived from public.categories category where category.id = category_id and category.user_id = owner_id;
    if not found or (archived and old_expense.category_id is distinct from category_id) then raise exception 'inactive category'; end if;
    if payload->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or (payload->>'date')::date > (now() at time zone profile.time_zone)::date then raise exception 'invalid expense date'; end if;
    if old_expense.id is null then
      insert into public.expenses(id, user_id, category_id, amount_minor, expense_date, merchant, note)
        values ((payload->>'id')::uuid, owner_id, category_id, (payload->>'amount')::bigint, (payload->>'date')::date, trim(payload->>'merchant'), payload->>'note');
    else
      update public.expenses set category_id = (payload->>'categoryId')::uuid, amount_minor = (payload->>'amount')::bigint, expense_date = (payload->>'date')::date, merchant = trim(payload->>'merchant'), note = payload->>'note', version = version + 1 where id = old_expense.id and user_id = owner_id;
    end if;
    update public.profiles set currency_locked = true where id = owner_id;
  elsif operation = 'deleteExpense' then
    delete from public.expenses where id = (payload->>'id')::uuid and user_id = owner_id and version = (payload->>'version')::integer;
    if not found then raise exception 'stale or missing expense'; end if;
  elsif operation = 'saveBudget' then
    if not profile.onboarded then raise exception 'complete onboarding'; end if;
    budget_month := ((payload->>'month') || '-01')::date;
    select id into budget_id from public.monthly_budgets where user_id = owner_id and month = budget_month;
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
    delete from public.monthly_budgets where user_id = owner_id and month = ((payload->>'month') || '-01')::date;
  elsif operation = 'saveCategory' then
    if exists (select 1 from public.categories where id = (payload->>'id')::uuid and user_id <> owner_id) then raise exception 'invalid category ownership'; end if;
    insert into public.categories(id, user_id, name, color, archived) values ((payload->>'id')::uuid, owner_id, trim(payload->>'name'), payload->>'color', (payload->>'archived')::boolean)
      on conflict (id) do update set name = excluded.name, color = excluded.color, archived = excluded.archived where categories.user_id = owner_id;
  elsif operation = 'saveProfile' then
    if profile.currency_locked and payload->>'currency' <> profile.currency then raise exception 'currency locked'; end if;
    if not exists (select 1 from pg_timezone_names where name = payload->>'timeZone') then raise exception 'invalid time zone'; end if;
    update public.profiles set display_name = trim(payload->>'name'), currency = payload->>'currency', time_zone = payload->>'timeZone', onboarded = true where id = owner_id;
  end if;
  update public.profiles set revision = revision + 1 where id = owner_id;
  insert into public.mutation_receipts(user_id, idempotency_key, request_hash, revision) values (owner_id, p_key, hash, profile.revision + 1);
  return public.ledger_snapshot();
end;
$$;

revoke all on function public.apply_ledger_change(uuid, integer, timestamptz, jsonb) from public, anon;
grant execute on function public.apply_ledger_change(uuid, integer, timestamptz, jsonb) to authenticated;

commit;
