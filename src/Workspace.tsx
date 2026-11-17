import {lazy,Suspense,useEffect,useState} from 'react';
import {PatientBrowser} from './PatientBrowser';
const Viewer=lazy(()=>import('./App'));
const address=()=>location.pathname+location.search;
export default function Workspace(){
  const [url,setUrl]=useState(address);
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
  if(list)return <PatientBrowser url={url} onNavigate={navigate} onQuery={to=>{history.replaceState(history.state,'',to);setUrl(address());}}/>;
  if(match)return <Suspense fallback={<main className="patient-browser"><header className="patient-header"><button onClick={back}>← Patients</button><h1>Patient {match[1]}</h1></header><div className="patient-empty" role="status">Opening viewer…</div></main>}><Viewer key={match[1]} patientId={match[1]} onBack={back}/></Suspense>;
  return <main className="patient-browser"><div className="patient-empty">Page unavailable.<button onClick={()=>navigate('/')}>Patients</button></div></main>;
}
