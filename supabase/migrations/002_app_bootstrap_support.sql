-- emora migration 002: helper RPC used only by the secured create-branch Edge Function.
begin;

create or replace function public.insert_branch_with_location(
  p_company_id uuid,
  p_region_id uuid,
  p_name text,
  p_code text,
  p_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_radius integer,
  p_accuracy_limit integer default 100
)
returns public.branches
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_branch public.branches;
begin
  insert into public.branches (
    company_id, region_id, name, code, address, location,
    attendance_radius_m, minimum_gps_accuracy_m
  ) values (
    p_company_id, p_region_id, trim(p_name), upper(trim(p_code)), nullif(trim(p_address), ''),
    extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography,
    p_radius, p_accuracy_limit
  ) returning * into created_branch;

  return created_branch;
end;
$$;

revoke all on function public.insert_branch_with_location(uuid,uuid,text,text,text,double precision,double precision,integer,integer) from public, anon, authenticated;
grant execute on function public.insert_branch_with_location(uuid,uuid,text,text,text,double precision,double precision,integer,integer) to service_role;

commit;
