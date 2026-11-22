-- Reihenfolge auf dem Zettel, Favoriten und Kaufhistorie.
-- Rein additiv: bestehende Daten und ältere App-Versionen funktionieren weiter.

-- Favorit (gilt für den ganzen Haushalt) und Kaufzähler für Vorschläge
alter table public.products
  add column if not exists favorite boolean not null default false,
  add column if not exists purchase_count integer not null default 0 check (purchase_count >= 0),
  add column if not exists last_purchased_at timestamptz;

-- Manuelle Reihenfolge auf dem Zettel. Kommazahl, damit beim Verschieben nur
-- die verschobene Zeile einen Wert zwischen ihren Nachbarn bekommt.
alter table public.list_items
  add column if not exists position double precision;

-- Vorhandene Einträge in Anlagereihenfolge durchnummerieren
update public.list_items li
   set position = sub.rn
  from (select id, row_number() over (partition by household_id order by created_at, id) as rn
          from public.list_items) sub
 where li.id = sub.id and li.position is null;

-- Einkauf abschließen: entfernt nur Einträge, die noch abgehakt sind, und
-- zählt genau diese als gekauft. Eine Wiederholung (z. B. nach verlorener
-- Antwort im Funkloch) findet nichts mehr zum Löschen und zählt nicht doppelt.
-- security invoker: Die RLS-Regeln des Aufrufers gelten.
create or replace function public.finish_shopping(p_product_ids uuid[]) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  n integer;
begin
  with done as (
    delete from public.list_items
     where product_id = any(p_product_ids)
       and checked
       and household_id = public.my_household_id()
    returning product_id
  )
  update public.products p
     set purchase_count = p.purchase_count + 1,
         last_purchased_at = now()
    from done
   where p.id = done.product_id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.finish_shopping(uuid[]) from public, anon;
grant execute on function public.finish_shopping(uuid[]) to authenticated;
