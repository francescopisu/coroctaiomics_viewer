import {lazy,Suspense,useCallback,useEffect,useState} from 'react';
import {PatientBrowser} from './PatientBrowser';
const Viewer=lazy(()=>import('./App'));
const address=()=>location.pathname+location.search;
const patientAt=(url:string)=>/^\/viewer\/([A-Za-z0-9_-]+)\/?$/.exec(new URL(url,location.origin).pathname)?.[1];
// Keep complete rendering sessions, including GPU resources. A fourth patient
// evicts the least recently visited session rather than growing without limit.
const residentLimit=3;
type Resident={id:string;ready:boolean};
export default function Workspace(){
  const [url,setUrl]=useState(address);
  const patientId=patientAt(url);
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
  const back=()=>{
    if(history.state?.fromPatients){history.back();return;}
    let destination='/';try{const saved=sessionStorage.getItem('coronary-patient-list');if(saved&&/^\/(?:patients)?(?:\?|$)/.test(saved))destination=saved;}catch{}
    navigate(destination);
  };
  return <>
    {list&&<PatientBrowser url={url} readyPatients={residents.filter(item=>item.ready).map(item=>item.id)} onNavigate={navigate} onQuery={to=>{history.replaceState(history.state,'',to);setUrl(address());}}/>}
    {!list&&!match&&<main className="patient-browser"><div className="patient-empty">Page unavailable.<button onClick={()=>navigate('/')}>Patients</button></div></main>}
    {residents.map(item=><div key={item.id} className={`resident-viewer${item.id===patientId?' is-active':''}`} data-patient-id={item.id} data-ready={item.ready} aria-hidden={item.id!==patientId} inert={item.id!==patientId}>
      <Suspense fallback={<main className="patient-browser"><header className="patient-header"><button onClick={back}>← Patients</button><h1>Patient {item.id}</h1></header><div className="patient-empty" role="status">Opening viewer…</div></main>}>
        <Viewer patientId={item.id} onBack={back} active={item.id===patientId} onReady={markReady}/>
      </Suspense>
    </div>)}
  </>;
}
