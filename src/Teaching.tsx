import {lazy,Suspense,useCallback,useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import type {TeachingProfile,TeachingViewerState} from './teachingTypes';
const Viewer=lazy(()=>import('./App'));

async function api<T>(path:string,body?:unknown):Promise<T>{
  const response=await fetch(`/api/teaching${path}`,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const value=await response.json().catch(()=>({detail:'Configurazione didattica non disponibile. Controlla teaching.local.json.'}));
  if(!response.ok)throw new Error(value.detail??'Impossibile aprire il caso.');
  return value as T;
}

function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
  const node=useRef<HTMLElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;(node.current?.querySelector<HTMLElement>('input')??node.current?.querySelector<HTMLElement>('button'))?.focus();return()=>previous?.focus();},[]);
  return <div className="teaching-shade" onClick={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={node} className="teaching-modal" role="dialog" aria-modal="true" aria-label={title} onKeyDown={e=>{
    if(e.key==='Escape'){e.stopPropagation();onClose();}
    if(e.key==='Tab'){
      const elements=Array.from(node.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')??[]),first=elements[0],last=elements.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
  }}><header><h2>{title}</h2><button aria-label="Chiudi" onClick={onClose}>×</button></header>{children}</section></div>;
}

function Password({ai,onClose,onSubmit}:{ai:boolean;onClose:()=>void;onSubmit:(password:string)=>Promise<void>}){
  const [password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{await onSubmit(password);}catch(e){setError(e instanceof Error?e.message:'Accesso non riuscito.');}finally{setBusy(false);}};
  return <Modal title={ai?'Approfondisci con AI':'Prendi in carico'} onClose={onClose}><form onSubmit={submit}>
    <label className="teaching-password">{ai?'Inserisci la password per accedere all’approfondimento AI.':'Inserisci la password per prendere in carico il paziente.'}
      <input autoFocus type="password" autoComplete="off" aria-label="Password" required value={password} onChange={e=>setPassword(e.target.value)}/>
    </label>{error&&<p className="teaching-error" role="alert">{error}</p>}
    <footer><button type="button" onClick={onClose}>Annulla</button><button className="teaching-primary" type="submit" disabled={busy}>{busy?'Accesso…':'Accedi'}</button></footer>
  </form></Modal>;
}

export default function Teaching(){
  const [cases,setCases]=useState<{code:string;available:boolean}[]>(),[error,setError]=useState(''),[profile,setProfile]=useState<TeachingProfile>();
  const [patientId,setPatientId]=useState<string>(),[aiUnlocked,setAiUnlocked]=useState(false),[aiConsulted,setAiConsulted]=useState(false);
  const [passwordStage,setPasswordStage]=useState<'open'|'ai'>(),[managementOpen,setManagementOpen]=useState(false),[choice,setChoice]=useState(''),[draftChoice,setDraftChoice]=useState('');
  const [outcome,setOutcome]=useState<{correct:boolean|null;feedback:string;followUpText:string}>(),[loading,setLoading]=useState(false);
  const session=useRef(0);
  const consultAi=useCallback(()=>setAiConsulted(true),[]);
  const reset=()=>{session.current++;setLoading(false);setPatientId(undefined);setProfile(undefined);setAiUnlocked(false);setAiConsulted(false);setPasswordStage(undefined);setManagementOpen(false);setChoice('');setDraftChoice('');setOutcome(undefined);setError('');};
  const refresh=()=>{setError('');api<{cases:{code:string;available:boolean}[]}>('').then(data=>setCases(data.cases)).catch(e=>setError(e.message));};
  useEffect(()=>{history.replaceState(null,'','/');refresh();},[]);
  const select=async(code:string)=>{setLoading(true);setError('');try{setProfile(await api<TeachingProfile>(`/${encodeURIComponent(code)}`));}catch(e){setError(e instanceof Error?e.message:'Caso non disponibile.');}finally{setLoading(false);}};
  const unlock=async(password:string)=>{
    if(!profile)return;
    const current=session.current;
    if(passwordStage==='open'){
      const value=await api<{patientId:string}>(`/${profile.code}/open`,{password});
      if(current!==session.current)return;
      setAiUnlocked(false);setAiConsulted(false);setChoice('');setPatientId(value.patientId);
    }else{await api(`/${profile.code}/ai`,{password});if(current!==session.current)return;setAiUnlocked(true);}
    setPasswordStage(undefined);
  };
  const showPrognosis=async()=>{
    if(!profile||!aiConsulted||!choice)return;
    const current=session.current;
    setError('');setLoading(true);
    try{const result=await api<{correct:boolean|null;feedback:string;followUpText:string}>(`/${profile.code}/prognosis`,{choice});if(current===session.current)setOutcome(result);}
    catch(e){if(current===session.current)setError(e instanceof Error?e.message:'Prognosi non disponibile.');}
    finally{if(current===session.current)setLoading(false);}
  };
  const teaching:TeachingViewerState|undefined=profile?{code:profile.code,name:profile.displayName,aiUnlocked,aiConsulted,hasDecision:!!choice,
    onUnlockAi:()=>setPasswordStage('ai'),onAiConsulted:consultAi,onManage:()=>{setDraftChoice(choice);setManagementOpen(true);},onPrognosis:()=>void showPrognosis()}:undefined;
  return <div className={`teaching-root${patientId?' teaching-viewer':''}`}>
    {patientId&&teaching?<Suspense fallback={<main className="teaching-page"><p role="status">Apertura del caso…</p></main>}>
      <Viewer key={patientId} patientId={patientId} onBack={reset} teaching={teaching}/>
    </Suspense>:<main className="teaching-page">
      <header className="teaching-header">{profile&&<button onClick={reset}>← Casi clinici</button>}<h1>{profile?`Caso ${profile.code}`:'Casi clinici'}</h1>{!profile&&<button onClick={refresh}>Aggiorna</button>}</header>
      {error&&<p className="teaching-error" role="alert">{error}</p>}
      {!profile?<div className="teaching-case-list" aria-label="Casi clinici">
        {!cases?<p role="status">Caricamento…</p>:cases.map(item=><button key={item.code} disabled={!item.available||loading} onClick={()=>void select(item.code)} aria-label={`Apri caso ${item.code}`}><span>{item.code}</span><span aria-hidden="true">→</span></button>)}
        {cases?.length===0&&<p>Nessun caso didattico configurato.</p>}
      </div>:<>
        <div className="teaching-profile"><section><h2>Anagrafica</h2><dl>
          <div><dt>Nome paziente</dt><dd>{profile.displayName}</dd></div><div><dt>Età</dt><dd>{profile.age==null?'Non documentata':`${profile.age} anni`}</dd></div><div><dt>Sesso</dt><dd>{profile.sex}</dd></div>
        </dl></section><section><h2>Anamnesi</h2><dl>
          <div><dt>Motivo dell’esame</dt><dd>{profile.indication}</dd></div><div><dt>Fattori di rischio</dt><dd>{profile.riskFactors}</dd></div><div><dt>Profilo clinico</dt><dd>{profile.clinicalProfile}</dd></div>
        </dl></section></div>
        <div className="teaching-profile-action"><button className="teaching-primary" onClick={()=>setPasswordStage('open')}>Prendi in carico</button></div>
      </>}
    </main>}
    {patientId&&error&&<p className="teaching-floating-error teaching-error" role="alert">{error}</p>}
    {passwordStage&&<Password key={passwordStage} ai={passwordStage==='ai'} onClose={()=>setPasswordStage(undefined)} onSubmit={unlock}/>}
    {managementOpen&&profile&&aiConsulted&&<Modal title="Gestione del paziente" onClose={()=>setManagementOpen(false)}>
      <fieldset className="teaching-choices"><legend>Quale gestione proponi per questo paziente?</legend>{profile.choices.map(item=><label key={item.id} className={draftChoice===item.id?'selected':''}><span>{item.label}</span><input type="radio" name="management" value={item.id} checked={draftChoice===item.id} onChange={()=>setDraftChoice(item.id)}/></label>)}</fieldset>
      <footer><button onClick={()=>setManagementOpen(false)}>Torna alle immagini</button><button className="teaching-primary" disabled={!draftChoice} onClick={()=>{setChoice(draftChoice);setOutcome(undefined);setManagementOpen(false);}}>Conferma scelta</button></footer>
    </Modal>}
    {outcome&&<Modal title="Prognosi a quattro anni" onClose={()=>setOutcome(undefined)}><p className={`teaching-feedback ${outcome.correct===true?'correct':outcome.correct===false?'incorrect':'unconfigured'}`}>{outcome.feedback}</p><p className="teaching-followup">{outcome.followUpText}</p><footer><button className="teaching-primary" onClick={reset}>Ricomincia</button></footer></Modal>}
    {patientId&&loading&&<div className="teaching-loading" role="status">Caricamento…</div>}
  </div>;
}
