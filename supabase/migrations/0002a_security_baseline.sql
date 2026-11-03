-- Emergency fail-closed baseline for the partially applied greenfield schema.
-- This creates no policies: direct anon/authenticated table access remains
-- blocked by RLS until the approved RPC/policy migrations are installed.
-- Apply default-privilege restrictions to the role used to execute migrations.

do $$
declare
  target record;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'alter table %I.%I enable row level security',
      target.schema_name,
      target.table_name
    );
    execute format(
      'alter table %I.%I force row level security',
      target.schema_name,
      target.table_name
    );
    execute format(
      'revoke all privileges on table %I.%I from anon, public',
      target.schema_name,
      target.table_name
    );
    execute format(
      'revoke truncate, trigger, references on table %I.%I from authenticated',
      target.schema_name,
      target.table_name
    );
  end loop;
end;
$$;

revoke all privileges on all sequences in schema public from anon, public;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, public;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, public;
