import {useEffect,useRef,useState} from 'react';
import type {AiFeature,AiModel,AiResults,FeatureHazard} from './aiTypes';
import {vessels,type Case} from './types';

const tabs=['Patient','Features','Cohort'] as const;
const number=(value:number|null|undefined,digits=1)=>value==null?'—':value.toLocaleString('en-US',{maximumFractionDigits:digits});
const risk=(value:number|null)=>value==null?'—':`${(value*100).toFixed(1)}%`;
const featureNumber=(value:number|null|undefined,digits=4)=>value==null?'—':value.toLocaleString('en-US',{maximumSignificantDigits:digits});
const featurePercentile=(value:number|null)=>value==null?'—':value>0&&value<.1?'P<0.1':value>99.9&&value<100?'P>99.9':`P${number(value)}`;
const ordinal=(value:number)=>{const n=Math.round(value),last=n%100;return `${n}${last>=11&&last<=13?'th':({1:'st',2:'nd',3:'rd'} as Record<number,string>)[n%10]??'th'}`;};
const comparisonNumber=(name:string,value:number|null)=>name==='PRI-only'?risk(value):`${number(value)}${name==='Clinical Likelihood'&&value!=null?'%':''}`;
function featureName(name:string){return name.replace('wavelet-','').replace('original_','Original_').replace('_glcm_',' · GLCM ').replace('_gldm_',' · GLDM ').replace('_firstorder_',' · First-order ');}
function display(value:string|number|null|undefined){
  if(value==null||value==='')return 'Not recorded';
  if(value==='Typycal Chest Pain')return 'Typical chest pain';
  if(typeof value==='string'&&value.startsWith('Score '))return value.slice(6);
  if(value==='Very low')return 'Very low';
  return String(value);
}

function Hazard({hazard,model}:{hazard:FeatureHazard;model:AiModel}){
  const direction=hazard.coefficient>0?'Higher feature values have a higher-risk association':hazard.coefficient<0?'Higher feature values have a lower-risk association':'No fitted directional association';
  const uncertain=hazard.ci[0]<=1&&hazard.ci[1]>=1;
  const description=`${model==='pri'?'PRI-only':'Adjusted'} HR per training SD: ${hazard.hr.toFixed(3)}. 95% CI ${hazard.ci.map(v=>v.toFixed(3)).join('–')}. ${direction}.`;
  return <span className="ai-hr" tabIndex={0} aria-label={description}>
    {hazard.hr.toFixed(3)}{uncertain&&<sup className="ai-hr-uncertain" aria-label="95% confidence interval includes 1">†</sup>}<span role="tooltip" className="ai-tooltip">
    {description}<br/>Conditional on the other model predictors, after harmonization and scaling. Describes increasing feature values, not this patient's individual risk contribution or a voxel-level probability.
    {uncertain&&<><br/>The interval includes 1; direction reflects the fitted point estimate.</>}
  </span></span>;
}

export function AiPanel({patientId,open,onClose,onSelectFeature,selectedFeature,maps}:{patientId:string;open:boolean;onClose:()=>void;onSelectFeature:(feature:AiFeature)=>void;selectedFeature?:string;maps:Case['featureMaps']}){
  const [result,setResult]=useState<AiResults>(),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [tab,setTab]=useState<typeof tabs[number]>('Patient'),[model,setModel]=useState<AiModel>('pri');
  const close=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null);
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
  const chooseTab=(index:number)=>{setTab(tabs[index]);requestAnimationFrame(()=>panel.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[index]?.focus());};
  return <aside id="ai-results" className={`ai-panel${tab==='Features'?' ai-panel-features':''}`} ref={panel} role="dialog" aria-modal="false" aria-labelledby="ai-title" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose();}}}>
    <div className="ai-heading"><h2 id="ai-title">AI report</h2><span title={result?`Patient record: ${result.sourceCohort} dataset. Model revision ${result.modelRevision}`:undefined}>Patient {patientId}</span><button ref={close} aria-label="Close AI results" onClick={onClose}>×</button></div>
    {!result?<div className="ai-status" role={error?'alert':'status'}>{error||'Loading AI results…'}{error&&<button onClick={()=>setRetry(n=>n+1)}>Retry</button>}</div>:<>
      <div className="ai-horizon">{number(result.horizonMonths/12)}-year MACE</div>
      <div className="ai-metrics">
        <div><span>PRI-only</span><output aria-label="PRI-only risk" title={result.predictions.pri.error??'Radiomics-only model, unadjusted for clinical covariates.'}>{risk(result.predictions.pri.risk)}</output></div>
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
      <div className="ai-tabs" role="tablist" aria-label="AI details">{tabs.map((name,index)=><button key={name} id={`ai-tab-${name}`} role="tab" aria-selected={tab===name} aria-controls={`ai-view-${name}`} tabIndex={tab===name?0:-1} onClick={()=>setTab(name)} onKeyDown={e=>{
        const next=e.key==='ArrowRight'?(index+1)%tabs.length:e.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:e.key==='Home'?0:e.key==='End'?tabs.length-1:undefined;
        if(next!==undefined){e.preventDefault();chooseTab(next);}
      }}>{name}</button>)}</div>
      <div className={`ai-content ai-content-${tab.toLowerCase()}`} role="tabpanel" id={`ai-view-${tab}`} aria-labelledby={`ai-tab-${tab}`} tabIndex={0}>
        {tab==='Patient'&&patient&&<dl className="ai-patient-fields">
          <div><dt>Age</dt><dd>{typeof patient['Age at CCTA']==='number'?`${number(patient['Age at CCTA'],0)} years`:'Not recorded'}</dd></div>
          <div><dt>Sex</dt><dd>{display(patient.Sex)}</dd></div>
          <div title="Stored ESC RF-CL value and class; not recalculated in the viewer."><dt>ESC RF-CL</dt><dd>{typeof patient['Clinical Likelihood']==='number'?`${number(patient['Clinical Likelihood'])}%`:'Not recorded'}{patient['Clinical Likelihood Class']!=null&&` · ${display(patient['Clinical Likelihood Class'])}`}</dd></div>
          <div><dt>CAD-RADS</dt><dd>{display(patient.CADRADS)}</dd></div>
          <div><dt>Agatston</dt><dd>{typeof patient['Coronary artery calcium score']==='number'?number(patient['Coronary artery calcium score'] as number):display(patient['Coronary artery calcium score'])}</dd></div>
          {[
            ['Smoking','Smoker'],['Hypertension','Hypertension'],['Diabetes','Diabetes'],['Dyslipidemia','Dyslipidemia'],
            ['Family history of CAD','Familiarity for CAD'],['BMI','Body mass index (BMI)'],
            ['Dyspnea','Dyspnea'],['Chest pain','Type of chest pain '],
          ].map(([label,key])=><div key={key} className={key==='Smoker'||key==='Dyspnea'?'ai-group-start':''}><dt>{label}</dt><dd>{typeof patient[key]==='number'?number(patient[key] as number):display(patient[key])}</dd></div>)}
        </dl>}
        {tab==='Features'&&<>
          <div className="ai-feature-tools"><label>Model <select aria-label="Model" value={model} onChange={e=>setModel(e.target.value as AiModel)}><option value="pri">PRI-only</option><option value="adjusted">Adjusted</option></select></label></div>
          <table className="ai-features"><thead><tr><th>Feature</th><th title="Native patient-level feature value, before harmonization and scaling. P indicates the empirical percentile in the derivation cohort; ties use midrank.">Patient<small>value · percentile</small></th><th title="Native-value distribution in the derivation cohort only. IQR is the 25th–75th percentile; missing/non-finite observations are excluded.">Derivation<small>median (IQR)</small></th><th title="Association with increasing feature values: hazard ratio per training standard deviation after preprocessing, conditional on the other predictors. Focus or hover for the 95% confidence interval.">HR / SD</th></tr></thead>
            {vessels.map(vessel=><tbody key={vessel}><tr className="ai-vessel"><th colSpan={4}>{vessel}</th></tr>{result.features.filter(f=>f.vessel===vessel).map(feature=><tr key={feature.name} className={selectedFeature?.toLowerCase()===feature.mapName.toLowerCase()?'ai-selected-feature':''}>
              <td><button className="ai-feature-name" aria-label={`Show ${feature.vessel} ${feature.mapName} map`} disabled={!maps[feature.vessel]?.some(map=>map.name.toLowerCase()===feature.mapName.toLowerCase())} title={maps[feature.vessel]?.some(map=>map.name.toLowerCase()===feature.mapName.toLowerCase())?feature.mapName:'Voxel map unavailable for this patient'} onClick={()=>onSelectFeature(feature)}>{featureName(feature.mapName)}</button></td>
              <td className="ai-feature-patient"><span title={feature.value==null?'Not recorded':String(feature.value)}>{featureNumber(feature.value)}</span><small title={`Percentile ${feature.reference.percentile??'unavailable'} in ${feature.reference.n} derivation patients, using native values; missing values excluded.`}>{featurePercentile(feature.reference.percentile)}</small></td>
              <td className="ai-feature-reference" title={`Native derivation values (n = ${feature.reference.n}). Median ${feature.reference.median??'unavailable'}; 25th–75th percentile ${feature.reference.iqr?.join(' to ')??'unavailable'}.`}><span>{featureNumber(feature.reference.median)}</span><small>{feature.reference.iqr?`(${feature.reference.iqr.map(v=>featureNumber(v,3)).join(' – ')})`:'—'}</small></td>
              <td><Hazard hazard={feature.models[model]} model={model}/></td>
            </tr>)}</tbody>)}
          </table>
          {result.features.some(f=>f.models[model].ci[0]<=1&&f.models[model].ci[1]>=1)&&<p className="ai-feature-note">† 95% CI includes 1.</p>}
        </>}
        {tab==='Cohort'&&<>
          <div className="ai-cohort-heading"><span>Derivation</span><span>n = {number(result.cohort.n,0)}</span></div>
          <div className="ai-cohort-stats"><span>Median age {number(result.cohort.medianAge)} y</span><span title={`Sex recorded in ${result.cohort.sexKnown} patients`}>Women {number(result.cohort.womenPercent)}%</span><span>MACE {number(result.cohort.events,0)}</span></div>
          <table className="ai-comparisons"><thead><tr><th/><th>Patient</th><th>Median</th><th title="Empirical percentile within the derivation cohort; ties use midrank and missing values are excluded. PRI uses the original out-of-fold risk distribution.">Percentile</th></tr></thead><tbody>{result.cohort.comparisons.map(item=><tr key={item.name}><th>{item.label}</th><td>{comparisonNumber(item.name,item.value)}</td><td>{comparisonNumber(item.name,item.median)}</td><td><span className="ai-percentile" title={item.percentile==null?undefined:`Percentile ${item.percentile.toFixed(2)}${item.name==='PRI-only'?'; derivation-cohort out-of-fold PRI-only risks':''}`}>{item.percentile==null?'—':ordinal(item.percentile)}<i aria-hidden="true">{item.percentile!=null&&<b style={{left:`${item.percentile}%`}}/>}</i></span></td></tr>)}</tbody></table>
          <p className="ai-availability">Agatston n = {number(result.cohort.comparisons.find(item=>item.name==='Coronary artery calcium score')?.n,0)}</p>
        </>}
      </div>
    </>}
  </aside>;
}
