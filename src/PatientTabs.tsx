import {useEffect,useRef,type MouseEvent} from 'react';

export function PatientTabs({patients,activePatient,home,homeActive,onNavigate,onClose}:{patients:string[];activePatient?:string;home:string;homeActive:boolean;onNavigate:(to:string)=>void;onClose:(id:string)=>void}){
  const list=useRef<HTMLDivElement>(null);
  useEffect(()=>{list.current?.querySelector('[aria-current="page"]')?.scrollIntoView({block:'nearest',inline:'nearest'});},[activePatient,patients]);
  const follow=(event:MouseEvent<HTMLAnchorElement>,to:string)=>{
    if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();onNavigate(to);
  };
  return <nav className="patient-tabs" aria-label="Open patients">
    <a className={`patient-tab home-tab${homeActive?' is-selected':''}`} href={home} aria-current={homeActive?'page':undefined} onClick={event=>follow(event,home)}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9"/></svg>Home
    </a>
    <div className="patient-tab-list" ref={list}>{patients.map(id=><div key={id} className={`patient-tab-group${activePatient===id?' is-selected':''}`}>
      <a className="patient-tab" href={`/viewer/${encodeURIComponent(id)}`} aria-label={`Patient ${id}`} aria-current={activePatient===id?'page':undefined} onClick={event=>follow(event,`/viewer/${encodeURIComponent(id)}`)}>Patient {id}</a>
      <button className="patient-tab-close" aria-label={`Close patient ${id}`} title={`Close patient ${id}`} onClick={()=>onClose(id)}><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg></button>
    </div>)}</div>
  </nav>;
}
