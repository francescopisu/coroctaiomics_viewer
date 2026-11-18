import {useEffect,useRef,useState,type MouseEvent} from 'react';

export interface PatientSummary{patientId:string;available:boolean}
let rememberedScroll=0;
let rememberedRows:PatientSummary[]|undefined;
export function PatientBrowser({onNavigate,labels,onRefreshLabels}:{onNavigate:(url:string)=>void;labels:Record<string,string>;onRefreshLabels:()=>void}){
  const [rows,setRows]=useState<PatientSummary[]|undefined>(rememberedRows),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const scroll=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(revision===0&&rememberedRows)return;
    const abort=new AbortController();setError('');
    fetch('/api/patients',{signal:abort.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error((await r.json()).detail??'Patients unavailable.');return r.json();})
      .then(data=>{rememberedRows=data.patients.map(({patientId,available}:PatientSummary)=>({patientId,available}));setRows(rememberedRows);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return()=>abort.abort();
  },[revision]);
  useEffect(()=>{if(rows&&scroll.current)scroll.current.scrollTop=rememberedScroll;},[rows]);
  const label=(id:string)=>labels[id]??id;
  const patients=rows?.slice().sort((a,b)=>label(a.patientId).localeCompare(label(b.patientId),undefined,{numeric:true}));
  const open=(e:MouseEvent<HTMLAnchorElement>,id:string)=>{if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();onNavigate(`/viewer/${encodeURIComponent(id)}`);};
  return <main className="patient-browser patient-list-compact">
    <header className="patient-header"><h1>Patients</h1><button onClick={()=>{setRevision(n=>n+1);onRefreshLabels();}} aria-label="Refresh patients">Refresh</button></header>
    {error?<div className="patient-empty" role="alert">{error}<button onClick={()=>setRevision(n=>n+1)}>Retry</button></div>:!rows?<div className="patient-empty" role="status">Loading patients…</div>:<>
      <div className="patient-table-scroll" ref={scroll} onScroll={e=>{rememberedScroll=e.currentTarget.scrollTop;}}>
        <table className="patient-table" aria-label="Patients"><thead><tr><th scope="col">Patient</th><th scope="col" className="patient-open-heading"><span className="visually-hidden">Open patient</span></th></tr></thead>
          <tbody>{patients!.map(patient=><tr key={patient.patientId} className={patient.available?'':'patient-unavailable'} onClick={e=>{
            if(patient.available&&e.target instanceof HTMLElement&&!e.target.closest('a')&&!window.getSelection()?.toString())onNavigate(`/viewer/${encodeURIComponent(patient.patientId)}`);
          }}>
            <th scope="row">{patient.available?<a href={`/viewer/${encodeURIComponent(patient.patientId)}`} onClick={e=>open(e,patient.patientId)} aria-label={`Open patient ${label(patient.patientId)}`}>{label(patient.patientId)}</a>:label(patient.patientId)}</th>
            <td className="patient-open">{patient.available?<a href={`/viewer/${encodeURIComponent(patient.patientId)}`} onClick={e=>open(e,patient.patientId)} aria-label={`View patient ${label(patient.patientId)}`}>Open <span aria-hidden="true">→</span></a>:<span title="Images are not prepared or their configuration changed. See dataset setup in README.">Images unavailable</span>}</td>
          </tr>)}</tbody>
        </table>
        {!patients!.length&&<div className="patient-empty">No patients available.</div>}
      </div>
    </>}
  </main>;
}
