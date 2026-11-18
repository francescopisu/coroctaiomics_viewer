import {lazy,Suspense,useCallback,useEffect,useState} from 'react';
import {PatientBrowser} from './PatientBrowser';
import {PatientTabs} from './PatientTabs';
const Viewer=lazy(()=>import('./App'));
const address=()=>location.pathname+location.search;
const patientAt=(url:string)=>/^\/viewer\/([A-Za-z0-9_-]+)\/?$/.exec(new URL(url,location.origin).pathname)?.[1];
// Keep complete rendering sessions, including GPU resources. A fourth patient
// evicts the least recently visited session rather than growing without limit.
const residentLimit=3;
type Resident={id:string;ready:boolean};
export default function Workspace(){
  const [url,setUrl]=useState(address);
  const [labels,setLabels]=useState<Record<string,string>>(),[labelsError,setLabelsError]=useState(''),[labelsRevision,setLabelsRevision]=useState(0);
  const refreshLabels=useCallback(()=>setLabelsRevision(value=>value+1),[]);
  useEffect(()=>{
    const abort=new AbortController();setLabelsError('');
    fetch('/api/patient-labels',{signal:abort.signal,cache:'no-store'}).then(async response=>{
      if(!response.ok)throw new Error('Patient names unavailable. Restart the backend after updating, then retry.');
      const value=await response.json();if(!value.labels||typeof value.labels!=='object'||Array.isArray(value.labels)||Object.values(value.labels).some(label=>typeof label!=='string'))throw new Error('Invalid patient names response.');
      return value.labels as Record<string,string>;
    }).then(setLabels).catch(error=>{if(error.name!=='AbortError')setLabelsError(error.message);});
    return()=>abort.abort();
  },[labelsRevision]);
  const patientId=patientAt(url);
  const [openedPatients,setOpenedPatients]=useState<string[]>(()=>patientId?[patientId]:[]);
  const [toolbarHost,setToolbarHost]=useState<HTMLDivElement|null>(null);
  useEffect(()=>{if(patientId)setOpenedPatients(previous=>previous.includes(patientId)?previous:[...previous,patientId]);},[patientId]);
  const [residents,setResidents]=useState<Resident[]>(()=>patientId?[{id:patientId,ready:false}]:[]);
  useEffect(()=>{setResidents(previous=>{
    // Leaving an unfinished/error case still cancels its downloads and releases
    // partial resources. Only fully loaded cases are retained offscreen.
    const retained=previous.filter(item=>item.ready||item.id===patientId);
    if(patientId){const item=retained.find(item=>item.id===patientId)??{id:patientId,ready:false};return [...retained.filter(item=>item.id!==patientId),item].slice(-residentLimit);}
    return retained.length===previous.length?previous:retained;
  });},[patientId]);
  const markReady=useCallback((id:string)=>setResidents(previous=>previous.map(item=>item.id===id&&!item.ready?{...item,ready:true}:item)),[]);
  useEffect(()=>{const pop=()=>setUrl(address());addEventListener('popstate',pop);return()=>removeEventListener('popstate',pop);},[]);
  const pathname=new URL(url,location.origin).pathname,match=/^\/viewer\/([A-Za-z0-9_-]+)\/?$/.exec(pathname),list=pathname==='/'||pathname==='/patients';
  const navigate=(to:string)=>{
    if(list)try{sessionStorage.setItem('coronary-patient-list',address());}catch{}
    history.pushState({fromPatients:list},'',to);setUrl(address());
  };
  const homeAddress=()=>{
    let destination='/';try{const saved=sessionStorage.getItem('coronary-patient-list');if(saved&&/^\/(?:patients)?(?:\?|$)/.test(saved))destination=saved;}catch{}
    return destination;
  };
  const closePatient=(id:string)=>{
    const index=openedPatients.indexOf(id),remaining=openedPatients.filter(value=>value!==id);
    if(patientId===id){const next=remaining[Math.max(0,index-1)];navigate(next?`/viewer/${encodeURIComponent(next)}`:homeAddress());}
    setOpenedPatients(remaining);
    setResidents(previous=>previous.filter(item=>item.id!==id));
  };
  if(!labels)return <main className="patient-browser"><div className="patient-empty" role={labelsError?'alert':'status'}>{labelsError||'Loading patients…'}{labelsError&&<button onClick={refreshLabels}>Retry</button>}</div></main>;
  return <>
    <header className="toolbar workspace-toolbar" aria-label="Workspace controls">
      <PatientTabs patients={openedPatients} labels={labels} activePatient={patientId} home={homeAddress()} homeActive={list} onNavigate={navigate} onClose={closePatient}/>
      <div className="workspace-toolbar-actions" ref={setToolbarHost}/>
    </header>
    {labelsError&&<div className="patient-label-error" role="alert">{labelsError}<button onClick={refreshLabels}>Retry</button></div>}
    {list&&<PatientBrowser labels={labels} onRefreshLabels={refreshLabels} onNavigate={navigate}/>}
    {!list&&!match&&<main className="patient-browser"><div className="patient-empty">Page unavailable.<button onClick={()=>navigate('/')}>Patients</button></div></main>}
    {residents.map(item=><div key={item.id} className={`resident-viewer${item.id===patientId?' is-active':''}`} data-patient-id={item.id} data-ready={item.ready} aria-hidden={item.id!==patientId} inert={item.id!==patientId}>
      <Suspense fallback={<main className="patient-browser"><div className="patient-empty" role="status">Opening viewer…</div></main>}>
        <Viewer patientId={item.id} patientLabel={labels[item.id]??item.id} toolbarHost={toolbarHost} active={item.id===patientId} onReady={markReady}/>
      </Suspense>
    </div>)}
  </>;
}
