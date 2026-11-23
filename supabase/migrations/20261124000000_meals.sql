-- Gerichte und Wochenplan.
--
-- Rein additiv: bestehende Tabellen bleiben unverändert, ältere App-Versionen
-- funktionieren weiter.
--
-- Zutaten sind Produkte des Haushalts (ohne Mengen), gespeichert als Liste
-- von Produkt-ids in Reihenfolge. Umbenennen eines Produkts wirkt so in allen
-- Gerichten. Gelöschte Produkte bleiben als id stehen und werden von der App
-- ausgeblendet (ein Fremdschlüssel ist auf Array-Elemente nicht möglich).

create table public.meals (
  -- id wird vom Client erzeugt (offline anlegbar, Wiederholung idempotent)
  id           uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80 and name = btrim(name)),
  source_url   text check (source_url is null or (char_length(source_url) <= 2000 and source_url ~* '^https?://')),
  product_ids  uuid[] not null default '{}' check (cardinality(product_ids) <= 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Ziel für den zusammengesetzten Fremdschlüssel aus meal_plan
  unique (id, household_id)
);

create table public.meal_plan (
  id           uuid primary key,
  household_id uuid not null,
  meal_id      uuid not null,
  day          date not null,
  position     double precision,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Gericht und Planeintrag gehören zum selben Haushalt; Gericht gelöscht → Eintrag weg
  foreign key (meal_id, household_id)
    references public.meals (id, household_id) on delete cascade
);

create index meals_household_idx on public.meals (household_id);
create index meal_plan_household_day_idx on public.meal_plan (household_id, day);
create index meal_plan_meal_idx on public.meal_plan (meal_id);

create trigger meals_touch before update on public.meals
  for each row execute function public.touch_updated_at();
create trigger meal_plan_touch before update on public.meal_plan
  for each row execute function public.touch_updated_at();

-- RLS: voller Zugriff, aber nur im eigenen Haushalt (wie Produkte und Zettel)
alter table public.meals enable row level security;
alter table public.meal_plan enable row level security;

create policy meals_all on public.meals
  for all to authenticated
  using (household_id = public.my_household_id())
  with check (household_id = public.my_household_id());

create policy meal_plan_all on public.meal_plan
  for all to authenticated
  using (household_id = public.my_household_id())
  with check (household_id = public.my_household_id());

-- Rechte ausdrücklich (neue Supabase-Projekte vergeben keine Standardrechte,
-- siehe 20261122000000_explicit_grants.sql)
revoke all on public.meals, public.meal_plan from anon, authenticated;
grant select, insert, update, delete on public.meals, public.meal_plan to authenticated;

-- Echtzeit für beide Tabellen
alter publication supabase_realtime add table public.meals, public.meal_plan;

-- ---------------------------------------------------------------------------
-- Haushalt wechseln: Gerichte und Wochenplan mitnehmen
--
-- Ersetzt die Funktion aus 20261123000000_switch_household.sql. Unverändert
-- bis auf den markierten Block: War man allein im alten Haushalt, werden jetzt
-- auch Gerichte (mit neuer id) und deren Planeinträge übernommen. Gleichnamige
-- Gerichte werden nicht zusammengeführt, weil ihre Zutaten verschieden sein
-- können.
-- ---------------------------------------------------------------------------
create or replace function public.switch_household_for(p_user uuid, p_target uuid)
returns public.households
language plpgsql security definer set search_path = '' as $$
declare
  v_target public.households;
  v_old uuid;
  remaining int;
  base_pos double precision;
begin
  -- Ziel sperren, damit nicht zwei Personen gleichzeitig den letzten Platz belegen
  select * into v_target from public.households where id = p_target for update;
  if not found then
    raise exception 'Einladungscode ungültig' using errcode = 'P0001';
  end if;

  select household_id into v_old from public.household_members where user_id = p_user;
  if v_old = v_target.id then
    raise exception 'Du bist bereits in diesem Haushalt' using errcode = 'P0001';
  end if;
  if (select count(*) from public.household_members where household_id = v_target.id) >= 2 then
    raise exception 'Haushalt hat bereits zwei Mitglieder' using errcode = 'P0001';
  end if;

  if v_old is not null then
    perform 1 from public.households where id = v_old for update;
    delete from public.household_members where user_id = p_user;
    select count(*) into remaining from public.household_members where household_id = v_old;

    if remaining = 0 then
      -- Zuordnung alte Produkt-id → Produkt im Zielhaushalt
      create temp table if not exists pg_temp.product_map (old_id uuid primary key, new_id uuid not null) on commit drop;
      truncate pg_temp.product_map;

      -- gleichnamige Produkte: auf das vorhandene abbilden
      insert into pg_temp.product_map (old_id, new_id)
      select o.id, t.id
        from public.products o
        join public.products t
          on t.household_id = v_target.id
         and lower(regexp_replace(t.name, '\s+', ' ', 'g')) = lower(regexp_replace(o.name, '\s+', ' ', 'g'))
       where o.household_id = v_old;

      -- Stern und Kaufhistorie zusammenführen
      update public.products t
         set favorite = t.favorite or o.favorite,
             purchase_count = t.purchase_count + o.purchase_count,
             last_purchased_at = greatest(t.last_purchased_at, o.last_purchased_at)
        from pg_temp.product_map m
        join public.products o on o.id = m.old_id
       where t.id = m.new_id;

      -- übrige Produkte mit neuer id kopieren
      insert into pg_temp.product_map (old_id, new_id)
      select o.id, gen_random_uuid()
        from public.products o
       where o.household_id = v_old
         and not exists (select 1 from pg_temp.product_map m where m.old_id = o.id);

      insert into public.products (id, household_id, name, category, favorite, purchase_count, last_purchased_at, created_at)
      select m.new_id, v_target.id, o.name, o.category, o.favorite, o.purchase_count, o.last_purchased_at, o.created_at
        from public.products o
        join pg_temp.product_map m on m.old_id = o.id
       where o.household_id = v_old
         and not exists (select 1 from public.products t where t.id = m.new_id);

      -- Zettel-Einträge hinten anfügen; steht das Produkt schon drauf, bleibt der vorhandene Eintrag
      select coalesce(max(position), 0) into base_pos from public.list_items where household_id = v_target.id;
      insert into public.list_items (id, household_id, product_id, checked, position, created_at)
      select gen_random_uuid(), v_target.id, m.new_id, l.checked,
             base_pos + row_number() over (order by l.position nulls last, l.created_at, l.id),
             l.created_at
        from public.list_items l
        join pg_temp.product_map m on m.old_id = l.product_id
       where l.household_id = v_old
      on conflict (product_id) do nothing;

      -- NEU: Gerichte mit neuer id kopieren; ihre Zutaten auf die Produkte im
      -- Zielhaushalt umbiegen (Reihenfolge bleibt, Doppelte nach Zusammenführen
      -- gleichnamiger Produkte fallen weg); Planeinträge auf die neuen ids
      create temp table if not exists pg_temp.meal_map (old_id uuid primary key, new_id uuid not null) on commit drop;
      truncate pg_temp.meal_map;
      insert into pg_temp.meal_map (old_id, new_id)
      select id, gen_random_uuid() from public.meals where household_id = v_old;

      insert into public.meals (id, household_id, name, source_url, product_ids, created_at)
      select m.new_id, v_target.id, o.name, o.source_url,
             coalesce((select array_agg(x.new_id order by x.first_ord)
                         from (select pm.new_id, min(u.ord) as first_ord
                                 from unnest(o.product_ids) with ordinality as u(id, ord)
                                 join pg_temp.product_map pm on pm.old_id = u.id
                                group by pm.new_id) x), '{}'),
             o.created_at
        from public.meals o
        join pg_temp.meal_map m on m.old_id = o.id;

      insert into public.meal_plan (id, household_id, meal_id, day, position, created_at)
      select gen_random_uuid(), v_target.id, m.new_id, p.day, p.position, p.created_at
        from public.meal_plan p
        join pg_temp.meal_map m on m.old_id = p.meal_id;
      -- Ende NEU

      -- leeren alten Haushalt samt seinen (jetzt kopierten) Daten löschen
      delete from public.households where id = v_old;
    end if;
  end if;

  insert into public.household_members (household_id, user_id) values (v_target.id, p_user);
  return v_target;
end $$;

revoke all on function public.switch_household_for(uuid, uuid) from public, anon, authenticated;
