-- Run once in a dedicated Supabase project's SQL editor (as database owner).
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS private.econrise_world (
  id integer PRIMARY KEY CHECK (id = 1),
  data jsonb NOT NULL
);
INSERT INTO private.econrise_world (id, data) VALUES (1, '{
  "game": {"schema":1,"revision":0,"players":{},"reserves":{
    "canada":{"ore":300,"grain":300},"brazil":{"ore":300,"grain":300},
    "uk":{"ore":300,"grain":300},"egypt":{"ore":300,"grain":300},
    "south-africa":{"ore":300,"grain":300},"india":{"ore":300,"grain":300},
    "japan":{"ore":300,"grain":300},"australia":{"ore":300,"grain":300}
  },"orders":[],"loans":[],"shipments":[],"alliances":[],"history":[],"prices":{}},
  "sessions":{},"joins":{}
}'::jsonb) ON CONFLICT DO NOTHING;
ALTER TABLE private.econrise_world ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.econrise_world FROM PUBLIC, anon, authenticated;
-- The server uses the database owner connection. For a dedicated restricted
-- server role, grant USAGE on private and SELECT/UPDATE on both tables instead.
CREATE TABLE IF NOT EXISTS public.econrise_revisions (
  id integer PRIMARY KEY CHECK (id = 1), revision bigint NOT NULL DEFAULT 0
);
INSERT INTO public.econrise_revisions VALUES (1, 0) ON CONFLICT DO NOTHING;
ALTER TABLE public.econrise_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.econrise_revisions FROM anon, authenticated;
GRANT SELECT ON public.econrise_revisions TO anon, authenticated;
DROP POLICY IF EXISTS "public revision only" ON public.econrise_revisions;
CREATE POLICY "public revision only" ON public.econrise_revisions FOR SELECT TO anon, authenticated USING (id = 1);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'econrise_revisions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.econrise_revisions;
  END IF;
END $$;
COMMIT;
