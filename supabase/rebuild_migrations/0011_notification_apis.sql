-- Authenticated users can see and acknowledge only their own employee notices.
create function public.app_list_notifications() returns setof public.notifications
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id();
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 return query select n.* from public.notifications n where n.company_id=c and n.recipient_employee_id=e order by n.created_at desc limit 100;
end; $$;
revoke all on function public.app_list_notifications() from public,anon;
grant execute on function public.app_list_notifications() to authenticated;

create function public.app_notification_unread_count() returns bigint
language sql stable security definer set search_path=''
as $$
 select count(*) from public.notifications n where n.company_id=public.current_company_id()
  and n.recipient_employee_id=public.current_employee_id() and n.read_at is null;
$$;
revoke all on function public.app_notification_unread_count() from public,anon;
grant execute on function public.app_notification_unread_count() to authenticated;

create function public.app_mark_notification_read(p_notification_id uuid) returns void
language plpgsql security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id();
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 update public.notifications set read_at=coalesce(read_at,clock_timestamp())
 where id=p_notification_id and company_id=c and recipient_employee_id=e;
 if not found then raise exception 'notification not found' using errcode='P0002'; end if;
end; $$;
revoke all on function public.app_mark_notification_read(uuid) from public,anon;
grant execute on function public.app_mark_notification_read(uuid) to authenticated;
