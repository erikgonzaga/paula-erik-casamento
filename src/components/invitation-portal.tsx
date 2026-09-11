'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { WeddingLogo } from './wedding-logo';
import { ArrowUpRightIcon } from './icons';
import type { Invitation } from '@/lib/invitations/types';

class PortalError extends Error { constructor(message:string,public status:number){super(message);} }
async function request<T>(url:string,body?:unknown,method?:string):Promise<T>{
  const response=await fetch(url,{method:method||(body===undefined?'GET':'POST'),cache:'no-store',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok) throw new PortalError(data.message||'Tente novamente em alguns instantes.',response.status);
  return data as T;
}
export function InvitationPortal({slug}:{slug?:string}){
  const [invitation,setInvitation]=useState<Invitation|null>(null);
  const [code,setCode]=useState('');
  const [busy,setBusy]=useState(true);
  const [message,setMessage]=useState('');
  const [success,setSuccess]=useState('');
  const [answers,setAnswers]=useState<Record<string,string>>({});
  const [phone,setPhone]=useState('');
  const [dietary,setDietary]=useState('');
  const [notes,setNotes]=useState('');
  const started=useRef(false);
  const apply=useCallback((data:Invitation)=>{
    setInvitation(data);setAnswers(Object.fromEntries(data.guests.map(g=>[g.id,g.attendance_status])));
    setPhone(data.rsvp?.phone||'');setDietary(data.rsvp?.dietary_restrictions||'');setNotes(data.rsvp?.notes||'');
  },[]);
  const load=useCallback(async()=>apply(await request<Invitation>('/api/rsvp')), [apply]);
  const access=useCallback(async(payload:{slug:string}|{code:string})=>{
    setBusy(true);setMessage('');setSuccess('');setInvitation(null);
    try{await request('/api/invitations/access',payload);await load();}
    catch(error){setMessage(error instanceof Error?error.message:'Não foi possível abrir seu convite. Tente novamente.');}
    finally{setBusy(false);}
  },[load]);
  useEffect(()=>{
    if(started.current)return;started.current=true;
    const opening=slug?request('/api/invitations/access',{slug}).then(()=>request<Invitation>('/api/rsvp')):request<Invitation>('/api/rsvp');
    void opening.then(apply).catch(error=>{if(slug||!(error instanceof PortalError && error.status===401))setMessage(error instanceof Error?error.message:'Tente novamente em alguns instantes.');}).finally(()=>setBusy(false));
  },[slug,apply]);
  async function save(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!invitation)return;
    setBusy(true);setMessage('');setSuccess('');
    try{
      const result=await request<{updated:boolean;submitted_at:string;updated_at:string}>('/api/rsvp',{
        guests:invitation.guests.map(g=>({id:g.id,status:answers[g.id]})),phone,dietary_restrictions:dietary,notes,
      });
      apply({...invitation,guests:invitation.guests.map(g=>({...g,attendance_status:answers[g.id] as 'confirmed'|'declined'})),rsvp:{phone,dietary_restrictions:dietary,notes,submitted_at:result.submitted_at,updated_at:result.updated_at}});
      setSuccess(result.updated?'Sua resposta foi atualizada. Obrigado por nos avisar!':'Sua resposta foi salva com carinho. Obrigado!');
    }catch(error){setMessage(error instanceof Error?error.message:'Não foi possível salvar. Tente novamente.');}finally{setBusy(false);}
  }
  async function leave(){
    setBusy(true);setMessage('');
    try{await request('/api/invitations/access',undefined,'DELETE');setInvitation(null);setCode('');setSuccess('');window.history.replaceState(null,'','/rsvp');}
    catch{setMessage('Não foi possível sair. Tente novamente.');}finally{setBusy(false);}
  }
  return <main className="invitation-page">
    <Link href="/" className="invitation-brand" aria-label="Paula e Erik — início"><WeddingLogo size="medium" /></Link>
    <div className="invitation-heading"><p className="eyebrow">CONFIRME SUA PRESENÇA</p><h1>{invitation?invitation.name:'Um convite para você.'}</h1>
      <p>{invitation?'Ficaremos muito felizes em celebrar esse momento com vocês.':'Informe o código que acompanha seu convite para continuar.'}</p></div>
    {message&&<p className="invitation-message invitation-error" role="alert">{message}</p>}
    {success&&<p className="invitation-message" role="status">{success}</p>}
    {busy&&!invitation&&<p className="invitation-loading" role="status">Abrindo seu convite…</p>}
    {!invitation&&!busy&&<form className="invitation-card code-form" onSubmit={e=>{e.preventDefault();void access({code});}}>
      <label htmlFor="invitation-code">Código do convite</label>
      <input id="invitation-code" value={code} onChange={e=>setCode(e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={64} required autoComplete="off" />
      <button className="button primary" type="submit">Abrir meu convite <ArrowUpRightIcon /></button>
      {slug&&<button className="text-link" type="button" onClick={()=>void access({slug})}>Tentar abrir este link novamente</button>}
      <p className="invitation-help">O acesso é exclusivo para as pessoas que receberam um convite. Se precisar de ajuda, fale com Paula e Erik.</p>
    </form>}
    {invitation&&<>
      {invitation.is_demo&&<p className="invitation-message">Convite DEMO — somente para testes.</p>}
      {invitation.rsvp&&<p className="invitation-help">Você já respondeu este convite. Caso seus planos tenham mudado, você pode atualizar sua confirmação.</p>}
      <form className="invitation-card" onSubmit={save}>
        <fieldset disabled={busy} className="invitation-fields"><legend className="sr-only">Presença dos convidados</legend>
          {invitation.guests.map(g=><fieldset className="guest-response" key={g.id}>
            <legend>{g.name}{g.type==='child'&&<span className="guest-type">Criança</span>}</legend>
            <label><input type="radio" name={g.id} value="confirmed" checked={answers[g.id]==='confirmed'} onChange={()=>setAnswers({...answers,[g.id]:'confirmed'})} required /><span>Sim, estarei presente</span></label>
            <label><input type="radio" name={g.id} value="declined" checked={answers[g.id]==='declined'} onChange={()=>setAnswers({...answers,[g.id]:'declined'})} required /><span>Infelizmente não poderei</span></label>
          </fieldset>)}
          <label className="field-label" htmlFor="phone">Telefone</label><input id="phone" type="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={32} required />
          <label className="field-label" htmlFor="dietary">Restrição alimentar <span>(opcional)</span></label><textarea id="dietary" value={dietary} onChange={e=>setDietary(e.target.value)} rows={3} maxLength={2000} aria-describedby="dietary-help" /><p className="invitation-help" id="dietary-help">Se necessário, indique a pessoa e a restrição.</p>
          <label className="field-label" htmlFor="notes">Observações <span>(opcional)</span></label><textarea id="notes" value={notes} onChange={e=>setNotes(e.target.value)} rows={3} maxLength={2000} />
          <button className="button primary invitation-submit" type="submit" disabled={!invitation.guests.length}>{busy?'Salvando…':invitation.rsvp?'Atualizar resposta':'Confirmar presença'} <ArrowUpRightIcon /></button>
        </fieldset>
      </form>
      <section className="private-event"><p className="eyebrow">NOSSO ENCONTRO</p><h2>{invitation.event?.venue||'Buffet Napoleão — Espaço Praça'}</h2><p>21 de novembro de 2026 · Recepção às 13h</p><p>Pedimos que chegue com 15 minutos de antecedência.</p>
        {invitation.event?<><p className="private-address">{invitation.event.address}</p><p>{invitation.event.parking}</p><p>{invitation.event.valet}</p></>:<p>O endereço completo e as orientações de chegada serão disponibilizados aqui em breve.</p>}
      </section>
      <button className="text-link invitation-exit" type="button" onClick={()=>void leave()} disabled={busy}>Sair deste convite</button>
    </>}
    <Link href="/" className="invitation-home">Voltar ao início</Link>
  </main>;
}
