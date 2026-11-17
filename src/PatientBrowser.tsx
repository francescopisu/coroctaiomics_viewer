import {useEffect,useRef,useState,type MouseEvent} from 'react';

export interface PatientSummary{patientId:string;available:boolean;age:number|null;sex:string|null;cadRads:string|null;priRisk:number|null;adjustedRisk:number|null;stratum:'Low'|'Intermediate'|'High'|null}
type SortKey='patientId'|'age'|'cadRads'|'priRisk'|'adjustedRisk'|'stratum';
const columns:[SortKey,string][]=[['patientId','Patient'],['age','Age / sex'],['cadRads','CAD-RADS'],['priRisk','PRI-only'],['adjustedRisk','Adjusted'],['stratum','Risk category']];
const percent=(n:number|null)=>n==null?'—':`${(n*100).toFixed(1)}%`;
let rememberedScroll=0;
let rememberedRows:PatientSummary[]|undefined;
export function PatientBrowser({url,onNavigate,onQuery,readyPatients=[]}:{url:string;onNavigate:(url:string)=>void;onQuery:(url:string)=>void;readyPatients?:string[]}){
  const [rows,setRows]=useState<PatientSummary[]|undefined>(rememberedRows),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const scroll=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null);
  const query=new URL(url,location.origin).searchParams,q=query.get('q')??'',stratum=query.get('stratum')??'';
  const sort=(columns.some(([key])=>key===query.get('sort'))?query.get('sort'):'patientId') as SortKey,descending=query.get('order')==='desc';
  const setQuery=(key:string,value:string)=>{const params=new URLSearchParams(query);if(value)params.set(key,value);else params.delete(key);onQuery(`${location.pathname}${params.size?'?'+params:''}`);rememberedScroll=0;};
  useEffect(()=>{
    if(revision===0&&rememberedRows)return;
    const abort=new AbortController();setError('');
    fetch('/api/patients',{signal:abort.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error((await r.json()).detail??'Patients unavailable.');return r.json();})
      .then(data=>{rememberedRows=data.patients;setRows(data.patients);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return()=>abort.abort();
  },[revision]);
  useEffect(()=>{if(rows&&scroll.current)scroll.current.scrollTop=rememberedScroll;},[rows]);
  const visible=rows?.filter(p=>p.patientId.toLowerCase().includes(q.trim().toLowerCase())&&(!stratum||p.stratum===stratum)).sort((a,b)=>{
    const value=(p:PatientSummary)=>sort==='stratum'?(p.stratum==null?null:{Low:0,Intermediate:1,High:2}[p.stratum]):sort==='cadRads'?(p.cadRads?Number(p.cadRads.replace('Score ','')):null):p[sort];
    const x=value(a),y=value(b);if(x==null||y==null)return x==null?(y==null?0:1):-1;
    const result=typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),undefined,{numeric:true});return descending?-result:result;
  });
  const open=(e:MouseEvent<HTMLAnchorElement>,id:string)=>{if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();onNavigate(`/viewer/${encodeURIComponent(id)}`);};
  return <main className="patient-browser">
    <header className="patient-header"><h1>Patients</h1><span>Coronary CCTA</span></header>
    <div className="patient-toolbar"><label className="patient-search"><span aria-hidden="true">⌕</span><input ref={search} type="search" aria-label="Search patient ID" placeholder="Search patient ID" value={q} onChange={e=>setQuery('q',e.target.value)}/></label>
      <select aria-label="Filter risk category" value={stratum} onChange={e=>setQuery('stratum',e.target.value)}><option value="">All risk categories</option>{['Low','Intermediate','High'].map(s=><option key={s}>{s}</option>)}</select>
      <span className="patient-count" aria-live="polite">{rows?`${visible!.length} of ${rows.length} patients`:''}</span><button onClick={()=>setRevision(n=>n+1)} aria-label="Refresh patients">Refresh</button>
    </div>
    {error?<div className="patient-empty" role="alert">{error}<button onClick={()=>setRevision(n=>n+1)}>Retry</button></div>:!rows?<div className="patient-empty" role="status">Loading patients…</div>:<>
      <div className="patient-table-scroll" ref={scroll} onScroll={e=>{rememberedScroll=e.currentTarget.scrollTop;}}>
        <table className="patient-table" aria-label="Patients"><thead><tr>{columns.map(([key,label])=><th key={key} scope="col" aria-sort={sort===key?(descending?'descending':'ascending'):'none'}><button onClick={()=>{
          const params=new URLSearchParams(query);params.set('sort',key);params.set('order',sort===key&&!descending?'desc':'asc');onQuery(`${location.pathname}?${params}`);
        }}>{label}<span aria-hidden="true">{sort===key?(descending?'↓':'↑'):''}</span></button>{(key==='priRisk'||key==='adjustedRisk')&&<small>4-year MACE</small>}</th>)}<th scope="col" className="patient-open-heading"/></tr></thead>
          <tbody>{visible!.map(patient=><tr key={patient.patientId} className={patient.available?'':'patient-unavailable'} onClick={e=>{
            if(patient.available&&e.target instanceof HTMLElement&&!e.target.closest('a')&&!window.getSelection()?.toString())onNavigate(`/viewer/${encodeURIComponent(patient.patientId)}`);
          }}>
            <th scope="row">{patient.available?<a href={`/viewer/${patient.patientId}`} onClick={e=>open(e,patient.patientId)} aria-label={`Open patient ${patient.patientId}`}>{patient.patientId}</a>:patient.patientId}</th>
            <td>{patient.age==null&&patient.sex==null?'—':`${patient.age??'—'} · ${patient.sex??'—'}`}</td><td>{patient.cadRads?.replace('Score ','')??'—'}</td>
            <td>{percent(patient.priRisk)}</td><td>{percent(patient.adjustedRisk)}</td><td><span className={`patient-stratum ${patient.stratum?.toLowerCase()??''}`}>{patient.stratum??'—'}</span></td>
            <td className="patient-open">{readyPatients.includes(patient.patientId)&&<small className="patient-ready" title="Loaded in this browser tab; ready to reopen">Ready</small>}{patient.available?<a href={`/viewer/${patient.patientId}`} onClick={e=>open(e,patient.patientId)} aria-label={`View patient ${patient.patientId}`}>Open <span aria-hidden="true">→</span></a>:<span title="Images are not prepared or their configuration changed. See dataset setup in README.">Images unavailable</span>}</td>
          </tr>)}</tbody>
        </table>
        {!visible!.length&&<div className="patient-empty">No matching patients.<button onClick={()=>{onQuery(location.pathname);search.current?.focus();}}>Clear filters</button></div>}
      </div>
    </>}
  </main>;
}
