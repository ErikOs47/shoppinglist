-- Einkaufsliste: Grundschema
-- Mandantentrennung über household_id; jede Tabelle ist per RLS auf den
-- Haushalt des angemeldeten Nutzers beschränkt.

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  -- 12 Zeichen aus 32 Symbolen ≈ 60 Bit, damit der Code nicht erraten werden kann.
  invite_code text not null unique,
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id),
  -- Ein Nutzer gehört genau zu einem Haushalt.
  unique (user_id)
);

create table public.products (
  -- id wird vom Client erzeugt, damit Offline-Anlagen beim Nachsenden idempotent sind.
  id           uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80 and name = btrim(name)),
  category     text not null default 'Sonstiges'
               check (char_length(category) between 1 and 40 and category = btrim(category)),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Ziel für den zusammengesetzten Fremdschlüssel aus list_items.
  unique (id, household_id)
);

-- Keine doppelten Produkte je Haushalt, unabhängig von Groß-/Kleinschreibung
-- und Mehrfach-Leerzeichen. Muss zu normalizeName() im Client passen.
create unique index products_household_name_uq
  on public.products (household_id, lower(regexp_replace(name, '\s+', ' ', 'g')));

create table public.list_items (
  id           uuid primary key,
  household_id uuid not null,
  product_id   uuid not null,
  checked      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Ein Produkt steht höchstens einmal auf dem Zettel.
  unique (product_id),
  -- Erzwingt, dass Produkt und Listeneintrag zum selben Haushalt gehören.
  foreign key (product_id, household_id)
    references public.products (id, household_id) on delete cascade
);

create index list_items_household_idx on public.list_items (household_id);
create index products_household_idx on public.products (household_id);

-- ---------------------------------------------------------------------------
-- updated_at automatisch pflegen
-- ---------------------------------------------------------------------------

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger list_items_touch before update on public.list_items
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Hilfsfunktion für RLS
-- security definer, damit die Policy auf household_members nicht rekursiv
-- sich selbst auswertet.
-- ---------------------------------------------------------------------------

create function public.my_household_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.household_members where user_id = auth.uid()
$$;

revoke all on function public.my_household_id() from public, anon;
grant execute on function public.my_household_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.products          enable row level security;
alter table public.list_items        enable row level security;

-- Nicht angemeldete Clients bekommen gar keinen Tabellenzugriff.
revoke all on public.households, public.household_members,
              public.products, public.list_items from anon;

-- Haushalt: lesen und umbenennen nur durch Mitglieder.
-- Anlegen und Beitreten laufen ausschließlich über die RPCs unten.
create policy households_select on public.households
  for select to authenticated using (id = public.my_household_id());
create policy households_update on public.households
  for update to authenticated
  using (id = public.my_household_id()) with check (id = public.my_household_id());

-- Mitglieder: nur lesen, Änderungen nur über RPCs.
create policy members_select on public.household_members
  for select to authenticated using (household_id = public.my_household_id());

-- Produkte und Zettel: voller Zugriff, aber nur im eigenen Haushalt.
create policy products_all on public.products
  for all to authenticated
  using (household_id = public.my_household_id())
  with check (household_id = public.my_household_id());

create policy list_items_all on public.list_items
  for all to authenticated
  using (household_id = public.my_household_id())
  with check (household_id = public.my_household_id());

-- Spalten, die der Client nicht umschreiben darf.
revoke update on public.households from authenticated;
grant update (name) on public.households to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs: Haushalt anlegen / beitreten
-- ---------------------------------------------------------------------------

create function public.generate_invite_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  -- Ohne 0/O/1/I, damit der Code sich gut abtippen lässt.
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(12);
  result text := '';
begin
  for i in 0..11 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end $$;

revoke all on function public.generate_invite_code() from public, anon, authenticated;

create function public.create_household(p_name text) returns public.households
language plpgsql security definer set search_path = '' as $$
declare
  h public.households;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet' using errcode = '42501';
  end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'Du gehörst bereits zu einem Haushalt' using errcode = 'P0001';
  end if;

  insert into public.households (name, invite_code, created_by)
  values (btrim(p_name), public.generate_invite_code(), auth.uid())
  returning * into h;

  insert into public.household_members (household_id, user_id) values (h.id, auth.uid());
  return h;
end $$;

create function public.join_household(p_code text) returns public.households
language plpgsql security definer set search_path = '' as $$
declare
  h public.households;
  member_count int;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet' using errcode = '42501';
  end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'Du gehörst bereits zu einem Haushalt' using errcode = 'P0001';
  end if;

  select * into h from public.households
   where invite_code = upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'))
   for update;
  if not found then
    raise exception 'Einladungscode ungültig' using errcode = 'P0001';
  end if;

  -- Haushalt ist für zwei Personen ausgelegt. Ist er voll, bringt ein
  -- geleakter Code einem Fremden nichts mehr.
  select count(*) into member_count from public.household_members where household_id = h.id;
  if member_count >= 2 then
    raise exception 'Haushalt hat bereits zwei Mitglieder' using errcode = 'P0001';
  end if;

  insert into public.household_members (household_id, user_id) values (h.id, auth.uid());
  return h;
end $$;

revoke all on function public.create_household(text) from public, anon;
revoke all on function public.join_household(text) from public, anon;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.products, public.list_items;
