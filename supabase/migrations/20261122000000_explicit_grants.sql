-- Rechte ausdrücklich vergeben.
--
-- Neue Supabase-Projekte (ab 30.05.2026) vergeben für Tabellen in „public“
-- keine Rechte mehr automatisch an anon/authenticated. Ohne diese Datei
-- antwortet die API dann mit 42501 „permission denied“.
-- Quelle: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
--
-- Erst alles entziehen, dann nur das Nötige vergeben: So sind alte und neue
-- Projekte gleich eingestellt. Was eine Zeile tatsächlich darf, regeln
-- weiterhin die RLS-Policies aus der ersten Migration.
-- Mehrfaches Ausführen schadet nicht.

revoke all on public.households, public.household_members,
              public.products, public.list_items
  from anon, authenticated;

grant usage on schema public to authenticated;

-- Produkte und Einkaufszettel: lesen und ändern (RLS beschränkt auf den eigenen Haushalt)
grant select, insert, update, delete on public.products, public.list_items to authenticated;

-- Haushalt: lesen, nur der Name ist änderbar. Anlegen/Beitreten nur per RPC.
grant select on public.households to authenticated;
grant update (name) on public.households to authenticated;

-- Mitglieder: nur lesen. Änderungen nur per RPC.
grant select on public.household_members to authenticated;
