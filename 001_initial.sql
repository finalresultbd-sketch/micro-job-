-- MicroJob BD starter schema. Run in Supabase SQL Editor.
-- Amounts are stored in paisa: ৳1.00 = 100 paisa.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'User',
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);
create table public.tasks (
  id bigint generated always as identity primary key,
  title text not null check (length(title) between 2 and 120),
  description text not null check (length(description) between 2 and 5000),
  category text not null check (category in ('data_entry','survey','website_testing','content_review','other')),
  reward_paisa integer not null check (reward_paisa > 0),
  status text not null default 'draft' check (status in ('draft','published','closed')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.submissions (
  id bigint generated always as identity primary key,
  task_id bigint not null references public.tasks(id),
  user_id uuid not null references auth.users(id),
  proof_url text check (proof_url is null or proof_url like 'https://%'),
  answer_text text not null check (length(answer_text) between 1 and 5000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id,user_id)
);
create table public.wallet_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  amount_paisa bigint not null check (amount_paisa > 0),
  transaction_type text not null check (transaction_type in ('credit','debit')),
  reference text not null unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.withdrawals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  amount_paisa bigint not null check (amount_paisa >= 5000),
  method text not null check (method in ('bkash','nagad')),
  account_number text not null check (account_number ~ '^01[3-9][0-9]{8}$'),
  status text not null default 'pending' check (status in ('pending','paid','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index tasks_status_created_idx on public.tasks(status,created_at desc);
create index submissions_user_created_idx on public.submissions(user_id,created_at desc);
create index submissions_status_idx on public.submissions(status);
create index wallet_transactions_user_created_idx on public.wallet_transactions(user_id,created_at desc);
create index withdrawals_user_created_idx on public.withdrawals(user_id,created_at desc);
create index withdrawals_status_idx on public.withdrawals(status);

-- Profile row created by a trusted database trigger on sign-up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id,display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name',''),'User'))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.submissions enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.withdrawals enable row level security;

create policy "profile read self or admin" on public.profiles
for select to authenticated using (id = (select auth.uid()) or public.is_admin());
create policy "profile update own display name only" on public.profiles
for update to authenticated using (id = (select auth.uid()))
with check (id = (select auth.uid()) and role = 'user');

create policy "published tasks readable" on public.tasks
for select to authenticated using (status = 'published' or public.is_admin());
create policy "admin manage tasks" on public.tasks
for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "submissions read self or admin" on public.submissions
for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy "users submit own task" on public.submissions
for insert to authenticated with check (
  user_id = (select auth.uid()) and status = 'pending'
  and exists (select 1 from public.tasks t where t.id = task_id and t.status = 'published')
);
-- No user update/delete policy: submitted proof and review state are immutable from browser.

create policy "transactions read self or admin" on public.wallet_transactions
for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
-- No browser insert/update/delete policy for ledger.

create policy "withdrawals read self or admin" on public.withdrawals
for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
-- Withdrawal requests are created and finalized through security-definer RPCs only.

-- Returns spendable balance: ledger balance minus funds reserved by pending withdrawals.
create or replace function public.get_my_wallet()
returns bigint language plpgsql stable security definer set search_path = ''
as $$
declare v_user uuid := (select auth.uid()); v_balance bigint;
begin
  if v_user is null then raise exception 'Login required'; end if;
  select
    coalesce((select sum(case when wt.transaction_type='credit' then wt.amount_paisa else -wt.amount_paisa end)
      from public.wallet_transactions wt where wt.user_id=v_user),0)
    - coalesce((select sum(w.amount_paisa) from public.withdrawals w
      where w.user_id=v_user and w.status='pending'),0)
  into v_balance;
  return v_balance;
end;
$$;
revoke all on function public.get_my_wallet() from public;
grant execute on function public.get_my_wallet() to authenticated;

create or replace function public.admin_create_task(
  p_title text, p_description text, p_category text, p_reward_paisa integer
) returns bigint language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  if not public.is_admin() then raise exception 'Admin permission required'; end if;
  if p_reward_paisa is null or p_reward_paisa <= 0 then raise exception 'Invalid reward'; end if;
  insert into public.tasks(title,description,category,reward_paisa,status,created_by)
  values (left(trim(p_title),120),trim(p_description),p_category,p_reward_paisa,'published',(select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.admin_create_task(text,text,text,integer) from public;
grant execute on function public.admin_create_task(text,text,text,integer) to authenticated;

create or replace function public.admin_review_submission(p_submission_id bigint,p_approve boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.submissions%rowtype; v_reward integer;
begin
  if not public.is_admin() then raise exception 'Admin permission required'; end if;
  select * into s from public.submissions where id=p_submission_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if s.status <> 'pending' then raise exception 'Submission already reviewed'; end if;
  update public.submissions set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=(select auth.uid()),reviewed_at=now() where id=s.id;
  if p_approve then
    select reward_paisa into v_reward from public.tasks where id=s.task_id;
    insert into public.wallet_transactions(user_id,amount_paisa,transaction_type,reference,created_by)
    values(s.user_id,v_reward,'credit','submission:'||s.id,(select auth.uid()))
    on conflict(reference) do nothing;
  end if;
end;
$$;
revoke all on function public.admin_review_submission(bigint,boolean) from public;
grant execute on function public.admin_review_submission(bigint,boolean) to authenticated;

create or replace function public.request_withdrawal(
  p_amount_paisa bigint, p_method text, p_account_number text
) returns bigint language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := (select auth.uid()); v_balance bigint; v_id bigint;
begin
  if v_user is null then raise exception 'Login required'; end if;
  if p_amount_paisa < 5000 then raise exception 'Minimum withdrawal is BDT 50'; end if;
  if p_method not in ('bkash','nagad') then raise exception 'Invalid payment method'; end if;
  if p_account_number !~ '^01[3-9][0-9]{8}$' then raise exception 'Invalid Bangladesh mobile number'; end if;
  -- Serialize a user's withdrawal requests to prevent simultaneous overspending.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
  select
    coalesce((select sum(case when wt.transaction_type='credit' then wt.amount_paisa else -wt.amount_paisa end)
      from public.wallet_transactions wt where wt.user_id=v_user),0)
    - coalesce((select sum(w.amount_paisa) from public.withdrawals w
      where w.user_id=v_user and w.status='pending'),0)
  into v_balance;
  if p_amount_paisa > v_balance then raise exception 'Insufficient available balance'; end if;
  insert into public.withdrawals(user_id,amount_paisa,method,account_number)
  values(v_user,p_amount_paisa,p_method,p_account_number) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.request_withdrawal(bigint,text,text) from public;
grant execute on function public.request_withdrawal(bigint,text,text) to authenticated;

create or replace function public.admin_finalize_withdrawal(p_withdrawal_id bigint,p_result text)
returns void language plpgsql security definer set search_path = ''
as $$
declare w public.withdrawals%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin permission required'; end if;
  if p_result not in ('paid','rejected') then raise exception 'Invalid result'; end if;
  select * into w from public.withdrawals where id=p_withdrawal_id for update;
  if not found then raise exception 'Withdrawal not found'; end if;
  if w.status <> 'pending' then raise exception 'Withdrawal already finalized'; end if;
  if p_result='paid' then
    insert into public.wallet_transactions(user_id,amount_paisa,transaction_type,reference,created_by)
    values(w.user_id,w.amount_paisa,'debit','withdrawal:'||w.id,(select auth.uid()))
    on conflict(reference) do nothing;
  end if;
  update public.withdrawals set status=p_result,reviewed_by=(select auth.uid()),reviewed_at=now()
  where id=w.id;
end;
$$;
revoke all on function public.admin_finalize_withdrawal(bigint,text) from public;
grant execute on function public.admin_finalize_withdrawal(bigint,text) to authenticated;

-- IMPORTANT: create an account first, then promote ONLY your own verified account
-- from Supabase SQL Editor, replacing the UUID below with your auth.users.id:
-- update public.profiles set role='admin' where id='YOUR-AUTH-USER-UUID';
-- Never expose the service_role key. Never let users set their own role.
