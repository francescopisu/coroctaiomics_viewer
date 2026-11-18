import {useEffect,useRef,useState} from 'react';
import type {AiResults} from './aiTypes';

const number=(value:number|null|undefined,digits=1)=>value==null?'—':value.toLocaleString('en-US',{maximumFractionDigits:digits});
const risk=(value:number|null)=>value==null?'—':`${(value*100).toFixed(1)}%`;
function display(value:string|number|null|undefined){
  if(value==null||value==='')return 'Not recorded';
  if(value==='Typycal Chest Pain')return 'Typical chest pain';
  if(typeof value==='string'&&value.startsWith('Score '))return value.slice(6);
  if(value==='Very low')return 'Very low';
  return String(value);
}

export function AiPanel({patientId,patientLabel,open,onClose}:{patientId:string;patientLabel?:string;open:boolean;onClose:()=>void}){
  const [result,setResult]=useState<AiResults>(),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const close=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open||result)return;
    const abort=new AbortController();setError('');
    fetch(`/api/cases/${encodeURIComponent(patientId)}/ai`,{signal:abort.signal,cache:'no-store'}).then(async response=>{
      if(!response.ok)throw new Error((await response.json()).detail??'AI results unavailable.');
      const value=await response.json() as AiResults;
      if(value.patientId!==patientId)throw new Error('AI results do not match the loaded patient.');
      return value;
    }).then(value=>{if(!abort.signal.aborted)setResult(value);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return()=>abort.abort();
  },[patientId,open,retry]);
  useEffect(()=>{if(open)close.current?.focus();},[open]);
  if(!open)return null;
  const patient=result?.patient;
  const priPercentile=result?.priReference?.percentile;
  const marker=priPercentile??(result?.stratum==='Low'?12.5:result?.stratum==='Intermediate'?50:87.5);
  return <aside id="ai-results" className="ai-panel" role="dialog" aria-modal="false" aria-labelledby="ai-title" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose();}}}>
    <div className="ai-heading"><h2 id="ai-title">AI report</h2><span title={result?`Patient record: ${result.sourceCohort} dataset. Model revision ${result.modelRevision}`:undefined}>Patient {patientLabel??patientId}</span><button ref={close} aria-label="Close AI results" onClick={onClose}>×</button></div>
    {!result?<div className="ai-status" role={error?'alert':'status'}>{error||'Loading AI results…'}{error&&<button onClick={()=>setRetry(n=>n+1)}>Retry</button>}</div>:<>
      <div className="ai-horizon">{number(result.horizonMonths/12)}-year MACE</div>
      <div className="ai-metrics">
        <div><span>Adjusted</span><output aria-label="Adjusted risk" title={result.predictions.adjusted.error??'Radiomics + continuous ESC RF-CL + SS45 (binary).'}>{risk(result.predictions.adjusted.risk)}</output></div>
        <div><span title="Percentile of the PRI-only risk in the derivation-cohort reference distribution.">Percentile</span><output aria-label="PRI percentile" title={priPercentile==null?'PRI percentile unavailable.':`Percentile ${priPercentile.toFixed(2)} in the derivation-cohort out-of-fold PRI-only risk distribution. Ties use midrank. Reference: ${result.priReference.n} patients.`}>{number(priPercentile)}</output></div>
        <div><span>Risk category</span><output aria-label="Risk category" title="Category based on the PRI-only risk and the saved derivation thresholds." className={`ai-stratum ${result.stratum?.toLowerCase()??''}`}>{result.stratum??'—'}</output></div>
      </div>
      {(result.predictions.pri.error||result.predictions.adjusted.error)&&<p className="ai-prediction-error" role="status">{result.predictions.pri.error||result.predictions.adjusted.error}</p>}
      <div className="ai-risk-scale" aria-label="Derivation PRI risk strata">
        <div className="ai-risk-labels"><span>Low</span><span>Intermediate</span><span>High</span></div>
        <div className="ai-risk-track">
          <span className="low" title={`Low: risk ≤ ${risk(result.thresholds.q25)} (derivation Q25)`}/><span className="intermediate" title={`Intermediate: ${risk(result.thresholds.q25)} < risk ≤ ${risk(result.thresholds.q75)}`}/><span className="high" title={`High: risk > ${risk(result.thresholds.q75)} (derivation Q75)`}/>
          {result.stratum&&<i style={{left:`${marker}%`}} title={priPercentile!=null?`${result.stratum} category. PRI percentile ${priPercentile.toFixed(2)}. Reference: ${result.priReference.source}.`:`${result.stratum} category. Category marker; exact PRI percentile is unavailable. Thresholds: ${result.thresholds.source}.`}/>}
        </div>
        <div className="ai-risk-ticks"><span title={`Derivation Q25: ${(result.thresholds.q25*100).toFixed(2)}% risk`}>P25</span><span title={`Derivation Q75: ${(result.thresholds.q75*100).toFixed(2)}% risk`}>P75</span></div>
      </div>
      <div className="ai-content ai-content-patient" role="region" aria-label="Patient details" tabIndex={0}>
        {patient&&<dl className="ai-patient-fields">
          <div><dt>Age</dt><dd>{typeof patient['Age at CCTA']==='number'?`${number(patient['Age at CCTA'],0)} years`:'Not recorded'}</dd></div>
          <div><dt>Sex</dt><dd>{display(patient.Sex)}</dd></div>
          <div title="Stored ESC RF-CL value and class; not recalculated in the viewer."><dt>ESC RF-CL</dt><dd>{typeof patient['Clinical Likelihood']==='number'?`${number(patient['Clinical Likelihood'])}%`:'Not recorded'}{patient['Clinical Likelihood Class']!=null&&` · ${display(patient['Clinical Likelihood Class'])}`}</dd></div>
          <div><dt>CAD-RADS</dt><dd>{display(patient.CADRADS)}</dd></div>
          {[
            ['Smoking','Smoker'],['Hypertension','Hypertension'],['Diabetes','Diabetes'],['Dyslipidemia','Dyslipidemia'],
            ['Family history of CAD','Familiarity for CAD'],['BMI','Body mass index (BMI)'],
            ['Dyspnea','Dyspnea'],['Chest pain','Type of chest pain '],
          ].map(([label,key])=><div key={key} className={key==='Smoker'||key==='Dyspnea'?'ai-group-start':''}><dt>{label}</dt><dd>{typeof patient[key]==='number'?number(patient[key] as number):display(patient[key])}</dd></div>)}
        </dl>}
      </div>
    </>}
  </aside>;
}
