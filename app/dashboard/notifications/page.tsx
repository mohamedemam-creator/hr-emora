'use client'

import { useEffect,useState } from 'react'
import { Bell,CheckCheck,Loader2,RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Notification={
  id:string;notification_type:string;title:string;body:string;
  entity_type:string|null;entity_id:string|null;
  read_at:string|null;created_at:string;
}
export default function NotificationsPage(){
  const [rows,setRows]=useState<Notification[]>([])
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  async function load(){
    setLoading(true);setError('')
    const supabase=createClient()
    const {data,error:rpcError}=await supabase.rpc('app_list_notifications')
    if(rpcError)setError(rpcError.message)
    else setRows((data??[]) as Notification[])
    setLoading(false)
  }
  useEffect(()=>{void load()},[])
  async function markRead(id:string){
    const supabase=createClient()
    await supabase.rpc('app_mark_notification_read',{p_notification_id:id})
    await load()
  }
  return <main className="dashboard-content">
    <section className="page-heading management-heading">
      <div><span className="eyebrow">تنبيهات Emora</span>
        <h1>التنبيهات</h1>
        <p>تأخير الموظفين وخروجهم من النطاق وقرارات الإجازات.</p></div>
      <button className="button button-ghost" onClick={()=>void load()}>
        <RefreshCw size={18}/> تحديث</button>
    </section>
    {error&&<div className="form-error management-message">{error}</div>}
    <section className="panel notifications-list">
      {loading?<div className="empty-state"><Loader2 className="spin"/>
        <strong>جارٍ تحميل التنبيهات...</strong></div>:
      rows.length===0?<div className="empty-state"><Bell/>
        <strong>لا توجد تنبيهات</strong></div>:
      rows.map(n=><article key={n.id} className={n.read_at?'read':'unread'}>
        <div className="notification-icon"><Bell size={20}/></div>
        <div><strong>{n.title}</strong><p>{n.body}</p>
          <small>{new Date(n.created_at).toLocaleString('ar-EG')}</small></div>
        {!n.read_at&&<button className="button button-ghost"
          onClick={()=>void markRead(n.id)}><CheckCheck size={17}/> تم الاطلاع</button>}
      </article>)}
    </section>
  </main>
}
