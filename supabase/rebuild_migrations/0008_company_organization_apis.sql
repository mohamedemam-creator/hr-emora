-- Company-scoped organization and role APIs used by the active dashboard pages.

create function app_private.require_company_permission(p_permission text)
returns uuid language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=public.current_company_id();
begin
 if auth.uid() is null or c is null or not public.has_permission(p_permission) then
  raise exception 'company permission required: %',p_permission using errcode='42501';
 end if;
 return c;
end; $$;
revoke all on function app_private.require_company_permission(text) from public,anon,authenticated;

create function app_private.audit_company_action(
 p_company_id uuid,p_action text,p_entity_type text,p_entity_id uuid,
 p_old jsonb default null,p_new jsonb default null,p_context jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path=''
as $$
declare m public.company_memberships; role_codes text;
begin
 if auth.uid() is null then raise exception 'authenticated actor required' using errcode='28000'; end if;
 select cm.* into m from public.company_memberships cm where cm.user_id=auth.uid()
  and cm.company_id=p_company_id and cm.status='active';
 if not found then raise exception 'active company membership required' using errcode='42501'; end if;
 select string_agg(distinct r.code,',' order by r.code) into role_codes
  from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=p_company_id
  where er.employee_id=m.employee_id and r.is_active;
 insert into public.audit_logs(actor_user_id,actor_membership_id,actor_employee_id,actor_company_role,
   company_id,action,category,entity_type,entity_id,status,old_data,new_data,context)
 values(auth.uid(),m.id,m.employee_id,role_codes,p_company_id,p_action,
   split_part(p_action,'.',1),p_entity_type,p_entity_id,'success',p_old,p_new,
   coalesce(p_context,'{}'::jsonb));
end; $$;
revoke all on function app_private.audit_company_action(uuid,text,text,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;

create function public.app_list_regions()
returns table(id uuid,name text,code text,is_active boolean,manager_employee_id uuid,manager_name text,branch_count bigint,employee_count bigint,created_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('regions.view_all');
begin
 return query select r.id,r.name,r.code,r.is_active,r.manager_employee_id,e.full_name,
  (select count(*) from public.branches b where b.company_id=c and b.region_id=r.id),
  (select count(*) from public.employees x join public.branches b on b.id=x.branch_id and b.company_id=x.company_id where x.company_id=c and b.region_id=r.id and x.deleted_at is null),r.created_at
 from public.regions r left join public.employees e on e.id=r.manager_employee_id and e.company_id=r.company_id
 where r.company_id=c order by r.name;
end; $$;
revoke all on function public.app_list_regions() from public,anon;
grant execute on function public.app_list_regions() to authenticated;

create function public.app_list_region_manager_candidates()
returns table(id uuid,employee_code text,full_name text,job_title_name text,is_assigned boolean)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('regions.view_all');
begin
 return query select e.id,e.employee_code,e.full_name,j.name,
  exists(select 1 from public.regions r where r.company_id=c and r.manager_employee_id=e.id)
 from public.employees e left join public.job_titles j on j.id=e.job_title_id and j.company_id=e.company_id
 where e.company_id=c and e.deleted_at is null and e.employment_status='active'
 order by e.full_name;
end; $$;
revoke all on function public.app_list_region_manager_candidates() from public,anon;
grant execute on function public.app_list_region_manager_candidates() to authenticated;

create function public.app_save_region(p_region_id uuid,p_name text,p_code text,p_is_active boolean,p_manager_employee_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('regions.manage'); rid uuid:=p_region_id; old_row public.regions;
begin
 if nullif(btrim(p_name),'') is null or upper(btrim(coalesce(p_code,''))) !~ '^[A-Z0-9_-]{1,32}$' then raise exception 'invalid region name or code' using errcode='22023'; end if;
 if p_manager_employee_id is not null and not exists(select 1 from public.employees e where e.id=p_manager_employee_id and e.company_id=c and e.deleted_at is null and e.employment_status='active') then raise exception 'region manager must be an active employee of this company' using errcode='23503'; end if;
 if rid is null then
  insert into public.regions(company_id,name,code,is_active,manager_employee_id) values(c,btrim(p_name),upper(btrim(p_code)),coalesce(p_is_active,true),p_manager_employee_id) returning id into rid;
 else
  select r.* into old_row from public.regions r where r.id=rid and r.company_id=c for update;
  if not found then raise exception 'region is outside current company' using errcode='42501'; end if;
  update public.regions r set name=btrim(p_name),code=upper(btrim(p_code)),is_active=coalesce(p_is_active,r.is_active),manager_employee_id=p_manager_employee_id,updated_at=clock_timestamp() where r.id=rid and r.company_id=c;
 end if;
 perform app_private.audit_company_action(c,case when p_region_id is null then 'region.created' else 'region.updated' end,'region',rid,
  case when p_region_id is null then null else jsonb_build_object('name',old_row.name,'code',old_row.code,'is_active',old_row.is_active,'manager_employee_id',old_row.manager_employee_id) end,
  jsonb_build_object('name',btrim(p_name),'code',upper(btrim(p_code)),'is_active',coalesce(p_is_active,true),'manager_employee_id',p_manager_employee_id));
 return rid;
end; $$;
revoke all on function public.app_save_region(uuid,text,text,boolean,uuid) from public,anon;
grant execute on function public.app_save_region(uuid,text,text,boolean,uuid) to authenticated;

create function public.app_delete_region(p_region_id uuid) returns boolean
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('regions.manage'); r public.regions;
begin
 select x.* into r from public.regions x where x.id=p_region_id and x.company_id=c for update;
 if not found then raise exception 'region is outside current company' using errcode='42501'; end if;
 if exists(select 1 from public.branches b where b.region_id=r.id and b.company_id=c) then raise exception 'region has branches and cannot be deleted' using errcode='23503'; end if;
 delete from public.regions where id=r.id and company_id=c;
 perform app_private.audit_company_action(c,'region.deleted','region',r.id,to_jsonb(r),null);
 return true;
end; $$;
revoke all on function public.app_delete_region(uuid) from public,anon;
grant execute on function public.app_delete_region(uuid) to authenticated;

create function public.app_list_branches()
returns table(id uuid,region_id uuid,region_name text,region_code text,name text,code text,address text,latitude double precision,longitude double precision,attendance_radius_m integer,minimum_gps_accuracy_m integer,is_active boolean,employee_count bigint,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('branches.view_all');
begin
 return query select b.id,b.region_id,r.name,r.code,b.name,b.code,b.address,
  case when b.location is null then null else extensions.st_y(b.location::extensions.geometry) end,
  case when b.location is null then null else extensions.st_x(b.location::extensions.geometry) end,
  b.attendance_radius_m,b.minimum_gps_accuracy_m,b.is_active,
  (select count(*) from public.employees e where e.company_id=c and e.branch_id=b.id and e.deleted_at is null),b.created_at,b.updated_at
 from public.branches b left join public.regions r on r.id=b.region_id and r.company_id=b.company_id
 where b.company_id=c order by r.name,b.name;
end; $$;
revoke all on function public.app_list_branches() from public,anon;
grant execute on function public.app_list_branches() to authenticated;

create function public.app_save_branch_with_region_manager(
 p_branch_id uuid,p_region_id uuid,p_manager_employee_id uuid,p_region_name text,p_region_code text,
 p_branch_name text,p_branch_code text,p_address text,p_latitude double precision,p_longitude double precision,
 p_radius integer,p_accuracy_limit integer,p_is_active boolean
) returns uuid language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('branches.manage'); rid uuid:=p_region_id; bid uuid:=p_branch_id; old_row public.branches;
begin
 if nullif(btrim(p_branch_name),'') is null or upper(btrim(coalesce(p_branch_code,''))) !~ '^[A-Z0-9_-]{1,32}$'
   or p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180
   or p_radius not between 25 and 1000 or p_accuracy_limit not between 1 and 1000 then raise exception 'invalid branch details or location' using errcode='22023'; end if;
 if p_manager_employee_id is not null then
  if not public.has_permission('regions.manage') then raise exception 'region manager assignment permission required' using errcode='42501'; end if;
  if not exists(select 1 from public.employees e where e.id=p_manager_employee_id and e.company_id=c and e.employment_status='active' and e.deleted_at is null) then raise exception 'region manager must be an active employee of this company' using errcode='23503'; end if;
 end if;
 if rid is null then
  if nullif(btrim(p_region_name),'') is null or upper(btrim(coalesce(p_region_code,''))) !~ '^[A-Z0-9_-]{1,32}$' then raise exception 'region selection is required' using errcode='22023'; end if;
  insert into public.regions(company_id,name,code,manager_employee_id) values(c,btrim(p_region_name),upper(btrim(p_region_code)),p_manager_employee_id)
   on conflict(company_id,code) do update set name=excluded.name,manager_employee_id=coalesce(excluded.manager_employee_id,public.regions.manager_employee_id)
   returning id into rid;
 else
  if not exists(select 1 from public.regions r where r.id=rid and r.company_id=c and r.is_active) then raise exception 'region is outside current company' using errcode='42501'; end if;
  if p_manager_employee_id is not null then update public.regions set manager_employee_id=p_manager_employee_id,updated_at=clock_timestamp() where id=rid and company_id=c; end if;
 end if;
 if bid is null then
  insert into public.branches(company_id,region_id,name,code,address,location,attendance_radius_m,minimum_gps_accuracy_m,is_active)
  values(c,rid,btrim(p_branch_name),upper(btrim(p_branch_code)),nullif(btrim(p_address),''),
   extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography,p_radius,p_accuracy_limit,coalesce(p_is_active,true)) returning id into bid;
 else
  select b.* into old_row from public.branches b where b.id=bid and b.company_id=c for update;
  if not found then raise exception 'branch is outside current company' using errcode='42501'; end if;
  update public.branches b set region_id=rid,name=btrim(p_branch_name),code=upper(btrim(p_branch_code)),address=nullif(btrim(p_address),''),
   location=extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography,
   attendance_radius_m=p_radius,minimum_gps_accuracy_m=p_accuracy_limit,is_active=coalesce(p_is_active,b.is_active),updated_at=clock_timestamp()
   where b.id=bid and b.company_id=c;
 end if;
 perform app_private.audit_company_action(c,case when p_branch_id is null then 'branch.created' else 'branch.updated' end,'branch',bid,
  case when p_branch_id is null then null else jsonb_build_object('region_id',old_row.region_id,'name',old_row.name,'code',old_row.code,'attendance_radius_m',old_row.attendance_radius_m,'minimum_gps_accuracy_m',old_row.minimum_gps_accuracy_m) end,
  jsonb_build_object('region_id',rid,'name',btrim(p_branch_name),'code',upper(btrim(p_branch_code)),'attendance_radius_m',p_radius,'minimum_gps_accuracy_m',p_accuracy_limit));
 return bid;
end; $$;
revoke all on function public.app_save_branch_with_region_manager(uuid,uuid,uuid,text,text,text,text,text,double precision,double precision,integer,integer,boolean) from public,anon;
grant execute on function public.app_save_branch_with_region_manager(uuid,uuid,uuid,text,text,text,text,text,double precision,double precision,integer,integer,boolean) to authenticated;

create function public.app_set_branch_active(p_branch_id uuid,p_is_active boolean) returns boolean
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('branches.manage'); old_active boolean;
begin
 select b.is_active into old_active from public.branches b where b.id=p_branch_id and b.company_id=c for update;
 if not found then raise exception 'branch is outside current company' using errcode='42501'; end if;
 update public.branches set is_active=p_is_active,updated_at=clock_timestamp() where id=p_branch_id and company_id=c;
 perform app_private.audit_company_action(c,'branch.status.changed','branch',p_branch_id,jsonb_build_object('is_active',old_active),jsonb_build_object('is_active',p_is_active));
 return true;
end; $$;
revoke all on function public.app_set_branch_active(uuid,boolean) from public,anon;
grant execute on function public.app_set_branch_active(uuid,boolean) to authenticated;

create function public.app_delete_branch(p_branch_id uuid) returns boolean
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('branches.manage'); b public.branches;
begin
 select x.* into b from public.branches x where x.id=p_branch_id and x.company_id=c for update;
 if not found then raise exception 'branch is outside current company' using errcode='42501'; end if;
 if exists(select 1 from public.employees e where e.branch_id=b.id and e.company_id=c and e.deleted_at is null)
   or exists(select 1 from public.attendance_sessions a where a.branch_id=b.id and a.company_id=c)
   or exists(select 1 from public.shift_assignments s where s.branch_id=b.id and s.company_id=c) then
  raise exception 'branch has employee, schedule, or attendance history; deactivate it instead' using errcode='23503';
 end if;
 delete from public.branches where id=b.id and company_id=c;
 perform app_private.audit_company_action(c,'branch.deleted','branch',b.id,to_jsonb(b),null);
 return true;
end; $$;
revoke all on function public.app_delete_branch(uuid) from public,anon;
grant execute on function public.app_delete_branch(uuid) to authenticated;

create function public.app_import_branches(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 c uuid:=app_private.require_company_permission('branches.manage'); row_value jsonb; row_no integer:=0;
 inserted_count integer:=0; updated_count integer:=0; failed_count integer:=0; errors jsonb:='[]'::jsonb;
 region_id_value uuid; branch_id_value uuid; region_code_value text; branch_code_value text;
 region_name_value text; branch_name_value text; latitude_value double precision; longitude_value double precision;
 radius_value integer; accuracy_value integer; active_value boolean; was_existing boolean;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception 'rows must be an array with at most 500 entries' using errcode='22023'; end if;
 for row_value in select value from jsonb_array_elements(p_rows) loop
  row_no:=row_no+1;
  begin
   region_name_value:=btrim(coalesce(row_value->>'region_name',''));
   region_code_value:=upper(btrim(coalesce(row_value->>'region_code','')));
   branch_name_value:=btrim(coalesce(row_value->>'branch_name',''));
   branch_code_value:=upper(btrim(coalesce(row_value->>'branch_code','')));
   if region_name_value='' or region_code_value='' or branch_name_value='' or branch_code_value='' then raise exception 'region and branch names and codes are required'; end if;
   latitude_value:=nullif(btrim(coalesce(row_value->>'latitude','')),'')::double precision;
   longitude_value:=nullif(btrim(coalesce(row_value->>'longitude','')),'')::double precision;
   radius_value:=coalesce(nullif(row_value->>'attendance_radius_m','')::integer,150);
   accuracy_value:=coalesce(nullif(row_value->>'minimum_gps_accuracy_m','')::integer,100);
   active_value:=case lower(coalesce(row_value->>'is_active','')) when '' then true when '1' then true when 'true' then true when 'yes' then true when 'نعم' then true when 'نشط' then true else false end;
   if latitude_value is null or longitude_value is null or latitude_value not between -90 and 90 or longitude_value not between -180 and 180 then raise exception 'valid branch latitude and longitude are required'; end if;
   if radius_value not between 25 and 1000 or accuracy_value not between 1 and 1000 then raise exception 'attendance radius or GPS accuracy is outside supported range'; end if;
   region_id_value:=null; branch_id_value:=null;
   select r.id into region_id_value from public.regions r where r.company_id=c and r.code=region_code_value;
   if region_id_value is null then
    insert into public.regions(company_id,name,code) values(c,region_name_value,region_code_value) returning id into region_id_value;
    perform app_private.audit_company_action(c,'region.created','region',region_id_value,null,jsonb_build_object('name',region_name_value,'code',region_code_value),jsonb_build_object('source','app_import_branches'));
   end if;
   select b.id into branch_id_value from public.branches b where b.company_id=c and b.code=branch_code_value;
   was_existing:=branch_id_value is not null;
   perform public.app_save_branch_with_region_manager(branch_id_value,region_id_value,null,region_name_value,region_code_value,
     branch_name_value,branch_code_value,nullif(btrim(coalesce(row_value->>'address','')),''),latitude_value,longitude_value,
     radius_value,accuracy_value,active_value);
   if was_existing then updated_count:=updated_count+1; else inserted_count:=inserted_count+1; end if;
  exception when others then
   failed_count:=failed_count+1;
   errors:=errors||jsonb_build_array(jsonb_build_object('row',row_no,'error',sqlerrm));
  end;
 end loop;
 return jsonb_build_object('inserted',inserted_count,'updated',updated_count,'failed',failed_count,'errors',errors);
end; $$;
revoke all on function public.app_import_branches(jsonb) from public,anon;
grant execute on function public.app_import_branches(jsonb) to authenticated;

create function public.app_list_departments()
returns table(id uuid,name text,code text,is_active boolean,job_count bigint,created_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('organization.view');
begin
 return query select d.id,d.name,d.code,d.is_active,(select count(*) from public.job_titles j where j.department_id=d.id and j.company_id=c),d.created_at
 from public.departments d where d.company_id=c order by d.name;
end; $$;
revoke all on function public.app_list_departments() from public,anon;
grant execute on function public.app_list_departments() to authenticated;

create function public.app_list_job_titles()
returns table(id uuid,name text,code text,department_id uuid,department_name text,default_role_id uuid,default_role_name text,is_active boolean,employee_count bigint,created_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('organization.view');
begin
 return query select j.id,j.name,j.code,j.department_id,d.name,j.default_role_id,r.name,j.is_active,
  (select count(*) from public.employees e where e.job_title_id=j.id and e.company_id=c and e.deleted_at is null),j.created_at
 from public.job_titles j left join public.departments d on d.id=j.department_id and d.company_id=c
 left join public.roles r on r.id=j.default_role_id and r.company_id=c
 where j.company_id=c order by j.name;
end; $$;
revoke all on function public.app_list_job_titles() from public,anon;
grant execute on function public.app_list_job_titles() to authenticated;

create function public.app_save_department(p_id uuid,p_name text,p_code text,p_is_active boolean) returns uuid
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('organization.manage'); did uuid:=p_id; old_row public.departments;
begin
 if nullif(btrim(p_name),'') is null or upper(btrim(coalesce(p_code,''))) !~ '^[A-Z0-9_-]{1,32}$' then raise exception 'invalid department name or code' using errcode='22023'; end if;
 if did is null then insert into public.departments(company_id,name,code,is_active) values(c,btrim(p_name),upper(btrim(p_code)),coalesce(p_is_active,true)) returning id into did;
 else
  select d.* into old_row from public.departments d where d.id=did and d.company_id=c for update;
  if not found then raise exception 'department is outside current company' using errcode='42501'; end if;
  update public.departments set name=btrim(p_name),code=upper(btrim(p_code)),is_active=coalesce(p_is_active,is_active),updated_at=clock_timestamp() where id=did and company_id=c;
 end if;
 perform app_private.audit_company_action(c,case when p_id is null then 'department.created' else 'department.updated' end,'department',did,
  case when p_id is null then null else to_jsonb(old_row) end,jsonb_build_object('name',btrim(p_name),'code',upper(btrim(p_code)),'is_active',coalesce(p_is_active,true)));
 return did;
end; $$;
revoke all on function public.app_save_department(uuid,text,text,boolean) from public,anon;
grant execute on function public.app_save_department(uuid,text,text,boolean) to authenticated;

create function public.app_delete_department(p_id uuid) returns boolean
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('organization.manage'); d public.departments;
begin
 select x.* into d from public.departments x where x.id=p_id and x.company_id=c for update;
 if not found then raise exception 'department is outside current company' using errcode='42501'; end if;
 if exists(select 1 from public.job_titles j where j.department_id=d.id and j.company_id=c)
   or exists(select 1 from public.employees e where e.department_id=d.id and e.company_id=c and e.deleted_at is null) then raise exception 'department is in use' using errcode='23503'; end if;
 delete from public.departments where id=d.id and company_id=c;
 perform app_private.audit_company_action(c,'department.deleted','department',d.id,to_jsonb(d),null);
 return true;
end; $$;
revoke all on function public.app_delete_department(uuid) from public,anon;
grant execute on function public.app_delete_department(uuid) to authenticated;

create function public.app_save_job_title(p_id uuid,p_department_id uuid,p_name text,p_code text,p_is_active boolean,p_default_role_id uuid) returns uuid
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('organization.manage'); jid uuid:=p_id; old_row public.job_titles;
begin
 if nullif(btrim(p_name),'') is null or upper(btrim(coalesce(p_code,''))) !~ '^[A-Z0-9_-]{1,32}$' then raise exception 'invalid job title name or code' using errcode='22023'; end if;
 if p_department_id is not null and not exists(select 1 from public.departments d where d.id=p_department_id and d.company_id=c) then raise exception 'department is outside current company' using errcode='23503'; end if;
 if p_default_role_id is not null and not exists(select 1 from public.roles r where r.id=p_default_role_id and r.company_id=c and r.is_active) then raise exception 'default role is outside current company' using errcode='23503'; end if;
 if jid is null then insert into public.job_titles(company_id,department_id,name,code,default_role_id,is_active) values(c,p_department_id,btrim(p_name),upper(btrim(p_code)),p_default_role_id,coalesce(p_is_active,true)) returning id into jid;
 else
  select j.* into old_row from public.job_titles j where j.id=jid and j.company_id=c for update;
  if not found then raise exception 'job title is outside current company' using errcode='42501'; end if;
  update public.job_titles set department_id=p_department_id,name=btrim(p_name),code=upper(btrim(p_code)),default_role_id=p_default_role_id,is_active=coalesce(p_is_active,is_active),updated_at=clock_timestamp() where id=jid and company_id=c;
 end if;
 perform app_private.audit_company_action(c,case when p_id is null then 'job_title.created' else 'job_title.updated' end,'job_title',jid,
  case when p_id is null then null else to_jsonb(old_row) end,jsonb_build_object('department_id',p_department_id,'name',btrim(p_name),'code',upper(btrim(p_code)),'default_role_id',p_default_role_id,'is_active',coalesce(p_is_active,true)));
 return jid;
end; $$;
revoke all on function public.app_save_job_title(uuid,uuid,text,text,boolean,uuid) from public,anon;
grant execute on function public.app_save_job_title(uuid,uuid,text,text,boolean,uuid) to authenticated;

create function public.app_delete_job_title(p_id uuid) returns boolean
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('organization.manage'); j public.job_titles;
begin
 select x.* into j from public.job_titles x where x.id=p_id and x.company_id=c for update;
 if not found then raise exception 'job title is outside current company' using errcode='42501'; end if;
 if exists(select 1 from public.employees e where e.job_title_id=j.id and e.company_id=c and e.deleted_at is null) then raise exception 'job title is in use' using errcode='23503'; end if;
 delete from public.job_titles where id=j.id and company_id=c;
 perform app_private.audit_company_action(c,'job_title.deleted','job_title',j.id,to_jsonb(j),null);
 return true;
end; $$;
revoke all on function public.app_delete_job_title(uuid) from public,anon;
grant execute on function public.app_delete_job_title(uuid) to authenticated;

create function public.app_list_permissions()
returns table(id uuid,code text,module text,name text,description text)
language plpgsql stable security definer set search_path=''
as $$
begin
 perform app_private.require_company_permission('roles.view');
 return query select p.id,p.code,p.module,p.name,p.description from public.permissions p order by p.module,p.code;
end; $$;
revoke all on function public.app_list_permissions() from public,anon;
grant execute on function public.app_list_permissions() to authenticated;

create function public.app_list_roles()
returns table(id uuid,name text,code text,description text,is_system boolean,is_active boolean,employee_count bigint,permission_codes text[])
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('roles.view');
begin
 return query select r.id,r.name,r.code,r.description,r.is_system,r.is_active,
  (select count(distinct er.employee_id) from public.employee_roles er where er.role_id=r.id),
  coalesce((select array_agg(p.code order by p.code) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=r.id),'{}'::text[])
 from public.roles r where r.company_id=c order by r.is_system desc,r.name;
end; $$;
revoke all on function public.app_list_roles() from public,anon;
grant execute on function public.app_list_roles() to authenticated;

create function public.app_save_role(p_id uuid,p_name text,p_code text,p_description text,p_is_active boolean,p_permission_codes text[]) returns uuid
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('roles.manage'); rid uuid:=p_id; old_row public.roles;
begin
 if nullif(btrim(p_name),'') is null or upper(btrim(coalesce(p_code,''))) !~ '^[A-Z][A-Z0-9_-]{1,31}$' then raise exception 'invalid role name or code' using errcode='22023'; end if;
 if upper(btrim(p_code)) in ('PLATFORM_SUPER_ADMIN','SUPER_ADMIN') then raise exception 'platform authority cannot be represented by a company role' using errcode='42501'; end if;
 if exists(select 1 from unnest(coalesce(p_permission_codes,'{}'::text[])) x(code) where not exists(select 1 from public.permissions p where p.code=x.code)) then raise exception 'unknown permission code' using errcode='22023'; end if;
 if rid is null then
  insert into public.roles(company_id,name,code,description,is_active) values(c,btrim(p_name),upper(btrim(p_code)),nullif(btrim(p_description),''),coalesce(p_is_active,true)) returning id into rid;
 else
  select r.* into old_row from public.roles r where r.id=rid and r.company_id=c for update;
  if not found then raise exception 'role is outside current company' using errcode='42501'; end if;
  if old_row.is_system and (old_row.code<>upper(btrim(p_code)) or old_row.code='COMPANY_OWNER') then raise exception 'system role identity and owner permissions are protected' using errcode='42501'; end if;
  if old_row.is_system and old_row.code in ('AREA_MANAGER','BRANCH_MANAGER') then raise exception 'scoped manager role permissions are managed by the platform catalog' using errcode='42501'; end if;
  update public.roles set name=btrim(p_name),description=nullif(btrim(p_description),''),is_active=coalesce(p_is_active,is_active),updated_at=clock_timestamp() where id=rid and company_id=c;
 end if;
 if (select r.code from public.roles r where r.id=rid)='COMPANY_OWNER' then
  raise exception 'COMPANY_OWNER permissions are managed by the platform catalog and cannot be reduced' using errcode='42501';
 end if;
 delete from public.role_permissions rp where rp.role_id=rid;
 insert into public.role_permissions(role_id,permission_id,scope_level)
 select rid,p.id,'company' from public.permissions p where p.code=any(coalesce(p_permission_codes,'{}'::text[]));
 perform app_private.audit_company_action(c,case when p_id is null then 'role.created' else 'role.updated' end,'role',rid,
  case when p_id is null then null else to_jsonb(old_row) end,jsonb_build_object('name',btrim(p_name),'code',upper(btrim(p_code)),'permission_codes',coalesce(p_permission_codes,'{}'::text[])));
 return rid;
end; $$;
revoke all on function public.app_save_role(uuid,text,text,text,boolean,text[]) from public,anon;
grant execute on function public.app_save_role(uuid,text,text,text,boolean,text[]) to authenticated;

create function public.app_delete_role(p_id uuid) returns boolean
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('roles.manage'); r public.roles;
begin
 select x.* into r from public.roles x where x.id=p_id and x.company_id=c for update;
 if not found then raise exception 'role is outside current company' using errcode='42501'; end if;
 if r.is_system then raise exception 'system roles cannot be deleted' using errcode='42501'; end if;
 if exists(select 1 from public.employee_roles er where er.role_id=r.id) then raise exception 'role is assigned to employees' using errcode='23503'; end if;
 delete from public.roles where id=r.id and company_id=c;
 perform app_private.audit_company_action(c,'role.deleted','role',r.id,to_jsonb(r),null);
 return true;
end; $$;
revoke all on function public.app_delete_role(uuid) from public,anon;
grant execute on function public.app_delete_role(uuid) to authenticated;
