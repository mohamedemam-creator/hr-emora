-- Company-owner leave-type configuration for the existing portal/shift UIs.
create function public.app_list_leave_types() returns table(id uuid,name text,code text,is_paid boolean,requires_attachment boolean,annual_entitlement numeric,is_active boolean)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('leaves.manage_types');
begin
 return query select lt.id,lt.name,lt.code,lt.is_paid,lt.requires_attachment,lt.annual_entitlement,lt.is_active from public.leave_types lt where lt.company_id=c order by lt.is_active desc,lt.name;
end; $$;
revoke all on function public.app_list_leave_types() from public,anon;
grant execute on function public.app_list_leave_types() to authenticated;

create function public.app_save_leave_type(p_id uuid,p_name text,p_code text,p_is_paid boolean,p_annual_entitlement numeric,p_is_active boolean) returns uuid
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('leaves.manage_types'); type_id uuid:=p_id; old_row public.leave_types;
begin
 if nullif(btrim(p_name),'') is null or nullif(btrim(p_code),'') is null or char_length(btrim(p_name))>80 or char_length(btrim(p_code))>32 then
  raise exception 'leave type name and code are required and must fit the allowed length' using errcode='22023'; end if;
 if p_annual_entitlement is not null and (p_annual_entitlement<0 or p_annual_entitlement>366) then raise exception 'annual entitlement must be between 0 and 366 days' using errcode='22023'; end if;
 if type_id is null then
  insert into public.leave_types(company_id,name,code,is_paid,requires_attachment,annual_entitlement,is_active)
  values(c,btrim(p_name),upper(btrim(p_code)),coalesce(p_is_paid,false),false,p_annual_entitlement,coalesce(p_is_active,true)) returning id into type_id;
 else
  select * into old_row from public.leave_types where id=type_id and company_id=c for update;
  if not found then raise exception 'leave type is outside company' using errcode='42501'; end if;
  if old_row.requires_attachment then raise exception 'attachment-required leave types cannot be edited until the portal supports uploads' using errcode='0A000'; end if;
  update public.leave_types set name=btrim(p_name),code=upper(btrim(p_code)),is_paid=coalesce(p_is_paid,false),annual_entitlement=p_annual_entitlement,is_active=coalesce(p_is_active,true) where id=type_id and company_id=c;
 end if;
 if not exists(select 1 from public.leave_types where company_id=c and is_active) then raise exception 'at least one active leave type is required' using errcode='23514'; end if;
 perform app_private.audit_company_action(c,'leave_type.saved','leave_type',type_id,case when p_id is null then null else to_jsonb(old_row) end,jsonb_build_object('name',btrim(p_name),'code',upper(btrim(p_code)),'is_paid',coalesce(p_is_paid,false),'annual_entitlement',p_annual_entitlement,'is_active',coalesce(p_is_active,true)));
 return type_id;
end; $$;
revoke all on function public.app_save_leave_type(uuid,text,text,boolean,numeric,boolean) from public,anon;
grant execute on function public.app_save_leave_type(uuid,text,text,boolean,numeric,boolean) to authenticated;
