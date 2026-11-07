-- Olax Gas: owner tools that run inside the database.
-- Lets the owner create users and reset passwords from the Users page.
-- Run once in Supabase: SQL Editor > New query > paste > Run.

create extension if not exists pgcrypto with schema extensions;

-- create a login + profile in one step (owner only)
create or replace function public.owner_create_user(p_email text, p_password text, p_username text, p_full_name text, p_role text)
returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare uid uuid := gen_random_uuid();
begin
  if public.my_role() is distinct from 'owner' then raise exception 'Only the owner can create users'; end if;
  if p_role not in ('partner','salesman') then raise exception 'Role must be partner or salesman'; end if;
  if length(coalesce(p_password,'')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  if p_username !~ '^[a-z0-9._-]{3,30}$' then raise exception 'Username: 3-30 letters, numbers, dots, dashes'; end if;
  if exists (select 1 from public.profiles where username = p_username) or exists (select 1 from auth.users where email = lower(p_email)) then
    raise exception 'That username is taken';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change_token_current, email_change,
    phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', lower(p_email),
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_full_name), now(), now(),
    '', '', '', '', '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
    jsonb_build_object('sub', uid::text, 'email', lower(p_email), 'email_verified', true),
    'email', now(), now(), now());

  insert into public.profiles (id, username, full_name, role) values (uid, p_username, p_full_name, p_role);
  return uid;
end $$;

-- set a new password for anyone (owner only)
create or replace function public.owner_set_password(p_user uuid, p_password text)
returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if public.my_role() is distinct from 'owner' then raise exception 'Only the owner can reset passwords'; end if;
  if p_user = auth.uid() then raise exception 'Change your own password with Forgot password on the login page'; end if;
  if length(coalesce(p_password,'')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user;
  if not found then raise exception 'User not found'; end if;
end $$;

revoke all on function public.owner_create_user(text,text,text,text,text) from public, anon;
revoke all on function public.owner_set_password(uuid,text) from public, anon;
grant execute on function public.owner_create_user(text,text,text,text,text) to authenticated;
grant execute on function public.owner_set_password(uuid,text) to authenticated;
