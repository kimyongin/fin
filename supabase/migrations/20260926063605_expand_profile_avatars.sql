alter table public.profiles
  drop constraint profiles_avatar_key_allowed;

alter table public.profiles
  add constraint profiles_avatar_key_allowed
  check (avatar_key in (
    'bear', 'cat', 'fox', 'dog', 'rabbit', 'panda', 'penguin', 'owl', 'frog', 'turtle',
    'apple', 'cherry', 'lemon', 'peach', 'strawberry', 'grape', 'watermelon', 'banana', 'pineapple', 'kiwi'
  ));

create or replace function public.app_set_profile_avatar(input_avatar_key text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  selected_key text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if input_avatar_key not in (
    'bear', 'cat', 'fox', 'dog', 'rabbit', 'panda', 'penguin', 'owl', 'frog', 'turtle',
    'apple', 'cherry', 'lemon', 'peach', 'strawberry', 'grape', 'watermelon', 'banana', 'pineapple', 'kiwi'
  ) or input_avatar_key is null then
    raise exception 'Invalid profile avatar';
  end if;
  insert into public.profiles (user_id, avatar_key)
  values (auth.uid(), input_avatar_key)
  on conflict (user_id) do update set avatar_key = excluded.avatar_key
  returning avatar_key into selected_key;
  return selected_key;
end;
$$;
