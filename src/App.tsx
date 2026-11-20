import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Scene,type CpeVolumeStatus} from './scene';
import {CprScene} from './cprScene';
import {SliceView} from './SliceView';
import {loadVolume,SharedCt,type Volume} from './volume';
import {axialIndex,crossSection,crossFeature} from './slices';
import {vessels,type Case,type Controls,type Vessel} from './types';
import {loadFeature,type FeatureVolume} from './featureVolume';
import {FEATURE_GRADIENT,featureNumber,featureScale} from './featureColors';
import {InitialProgress} from './initialProgress';
import {navigateAxial} from './sliceNavigation';
import {type CprMarker} from './curvedMarker';
import {loadAxialVolume,type AxialVolume} from './axialVolume';
import {ResourceCache} from './resourceCache';
import {AiPanel} from './AiPanel';
import type {AiFeature} from './aiTypes';
import {restoreView,saveView} from './viewState';
import {attenuationBands,attenuationLegend,attenuationRange,calibratedHu} from './cpeVolumeData';
import {useWindowLevel,type WindowLevel} from './useWindowLevel';

const initial:Controls={render3d:'anatomy',volumePreset:'balanced',volumeDensity:.9,volumeBands:{fat:1.05,low:2,intermediate:0,high:2},volumeLighting:'unlit',volumeContext:.5,volumeReferenceFade:.8,vessel:'LAD',index:30,curvedAngle:0,straightAngle:0,featureIds:{LAD:'',LCx:'',RCA:''},featureOpacity:.7,featureScale:'cohort',cpeVisible:false,cprAntialias:true,smoothEdges:true,smoothMeshes:true,aorta:true,lumen:true,centerline:false,cpe:{LAD:true,LCx:true,RCA:true},cpeOpacity:0.2,lumenOpacity:1,raw:true,context:false,width:800,level:250,colors:{LAD:'#e7636b',LCx:'#56a8e8',RCA:'#efa343'},side:'merged'};
export default function App({patientId,toolbarHost,active=true,onReady}:{patientId:string;toolbarHost:HTMLElement|null;active?:boolean;onReady?:(id:string)=>void}){
  const [data,setData]=useState<Case>(),[c,setC]=useState(()=>restoreView(patientId,initial)),[error,setError]=useState(''),[ready,setReady]=useState(false);
  const latestControls=useRef(c);latestControls.current=c;
  useEffect(()=>()=>saveView(patientId,latestControls.current),[patientId]);
  useEffect(()=>{const timer=window.setTimeout(()=>saveView(patientId,c),250);return()=>clearTimeout(timer);},[patientId,c]);
  const [bootPercent,setBootPercent]=useState(0),[bootDone,setBootDone]=useState(false),[downloads]=useState(()=>new InitialProgress(setBootPercent));
  const [loaded,setLoaded]=useState<{data:Case;volumes:Record<Vessel,Volume>}>(),[nativeAxial,setNativeAxial]=useState<AxialVolume>();
  const [featureCache,setFeatureCache]=useState<{data:Case;cache:ResourceCache<FeatureVolume>}>(),[,refreshFeatures]=useState(0);
  const [markers,setMarkers]=useState<CprMarker[]>([]);
  const [aiOpen,setAiOpen]=useState(false),aiButton=useRef<HTMLButtonElement>(null);
  const [mapsVisible,setMapsVisible]=useState(false);
  const changeWindowLevel=useCallback((value:WindowLevel)=>setC(old=>({...old,...value})),[]);
  const windowLevel=useWindowLevel(c,changeWindowLevel,active);
  const [volumeStatus,setVolumeStatus]=useState<CpeVolumeStatus>({phase:'idle'});
  // Keep optical 3D controls from repainting the four independent image views.
  const imagingControls=useMemo(()=>c,[c.vessel,c.index,c.axialSlice,c.curvedAngle,c.straightAngle,c.featureIds,c.featureOpacity,c.featureScale,c.cpeVisible,c.cprAntialias,c.smoothEdges,c.lumen,c.lumenOpacity,c.cpe,c.cpeOpacity,c.colors,c.width,c.level,c.raw]);
  const closeAi=()=>{setAiOpen(false);aiButton.current?.focus();};
  const sceneHost=useRef<HTMLDivElement>(null),cprHost=useRef<HTMLDivElement>(null),scene=useRef<Scene|undefined>(undefined),recon=useRef<CprScene|undefined>(undefined);
  const drag=useRef<{x:number;y:number;angle:number;view:number;mode?:'rotate'|'navigate'}|undefined>(undefined);
  const update=<K extends keyof Controls>(key:K,value:Controls[K])=>setC(old=>({...old,[key]:value,...(key==='index'?{axialSlice:undefined}:{})}));
  const select=(vessel:Vessel,index=0)=>setC(old=>({...old,vessel,index,axialSlice:undefined,curvedAngle:vessel===old.vessel?old.curvedAngle:0,straightAngle:vessel===old.vessel?old.straightAngle:0}));
  const volume=loaded&&loaded.data===data?loaded.volumes[c.vessel]:undefined;
  const availableFeatures=data?.featureMaps?.[c.vessel]??[];
  const featureId=mapsVisible?(availableFeatures.find(f=>f.id===c.featureIds[c.vessel])?.id??availableFeatures[0]?.id??''):'';
  const featureInfo=availableFeatures.find(f=>f.id===featureId);
  const feature=featureCache&&featureCache.data===data&&featureInfo?featureCache.cache.get(featureId):undefined;
  const scale=featureInfo?featureScale(featureInfo,c.featureScale):undefined;
  const cohort=scale&&!Array.isArray(scale)?scale:undefined;
  const scaleMode=c.featureScale==='cohort'&&!cohort?'balanced':c.featureScale;
  const basePlane=useMemo(()=>data&&volume?crossSection(data,c,volume):undefined,[data,volume,c.vessel,c.index,c.smoothEdges]);
  const plane=useMemo(()=>data&&basePlane&&feature?{...basePlane,feature:crossFeature(data,c,basePlane,feature)}:basePlane,[data,basePlane,feature,c.vessel,c.index,c.smoothEdges]);
  const tissueReference=data?.tissueReference?.available?data.tissueReference:undefined;
  const slice=data?axialIndex(data,c):0;
  const baseAxial=useMemo(()=>nativeAxial?.slice(slice,c.vessel),[nativeAxial,slice,c.vessel]);
  const axialPlane=useMemo(()=>baseAxial&&feature&&data?{...baseAxial,feature:feature.axialPlane(slice,data.geometry.shape,c.smoothEdges)}:baseAxial,[baseAxial,feature,data,slice,c.smoothEdges]);
  useEffect(()=>{const abort=new AbortController();fetch(`/api/cases/${encodeURIComponent(patientId)}`,{signal:abort.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error((await r.json()).detail);const d=await r.json();if(d.patientId!==patientId)throw new Error('Case response does not match the selected patient');if(!d.volumes||!d.axialVolume)throw new Error('Run backend.prepare to prepare native viewer volumes');return d as Case;}).then(d=>{if(abort.signal.aborted)return;downloads.plan(d);setC(old=>({...old,index:Math.min(old.index,d.vessels[old.vessel].points.length-1),axialSlice:old.axialSlice===undefined?undefined:Math.min(old.axialSlice,d.geometry.shape[2]-1)}));setData(d);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>abort.abort();},[downloads,patientId]);
  useEffect(()=>{
    if(!data||!sceneHost.current||!cprHost.current)return;const abort=new AbortController();
    const s=new Scene(sceneHost.current,data,select,setVolumeStatus),r=new CprScene(cprHost.current,data,setMarkers);scene.current=s;recon.current=r;
    s.setActive(active);r.setActive(active);
    s.load(abort.signal,downloads).then(()=>{if(!abort.signal.aborted)setReady(true);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return()=>{abort.abort();scene.current=undefined;recon.current=undefined;r.dispose();s.dispose();};
  },[data]);
  useEffect(()=>{scene.current?.setActive(active&&!aiOpen);recon.current?.setActive(active);},[active,data,aiOpen]);
  useEffect(()=>{
    if(!data)return;const abort=new AbortController(),owned:Volume[]=[];let shared:SharedCt|undefined;setLoaded(undefined);setNativeAxial(undefined);
    const native=loadAxialVolume(data.axialVolume,data.geometry.shape,abort.signal,downloads).then(stack=>{
      if(abort.signal.aborted)throw new DOMException('Case closed','AbortError');
      shared=new SharedCt(data.geometry,stack.ct);setNativeAxial(stack);return shared;
    });
    Promise.all(vessels.map(async vessel=>{
      const volume=await loadVolume(data.volumes[vessel],abort.signal,downloads,native);
      if(abort.signal.aborted){volume.dispose();throw new DOMException('Case closed','AbortError');}
      owned.push(volume);return [vessel,volume] as const;
    })).then(entries=>{if(!abort.signal.aborted)setLoaded({data,volumes:Object.fromEntries(entries) as Record<Vessel,Volume>});}).catch(e=>{if(e.name!=='AbortError'){abort.abort();setError(e.message);}});
    return()=>{abort.abort();recon.current?.setVolume(undefined);owned.forEach(volume=>volume.dispose());shared?.dispose();};
  },[data,downloads]);
  useEffect(()=>{
    if(!data)return;const cache=new ResourceCache<FeatureVolume>();setFeatureCache({data,cache});return()=>cache.dispose();
  },[data]);
  useEffect(()=>{
    if(!featureInfo||!featureCache||featureCache.data!==data)return;let active=true;
    featureCache.cache.load(featureInfo.id,signal=>loadFeature(featureInfo,signal)).then(()=>{if(active)refreshFeatures(n=>n+1);}).catch(e=>{if(active&&e.name!=='AbortError')setError(e.message);});
    return()=>{active=false;};
  },[data,featureInfo,featureCache]);
  useEffect(()=>{recon.current?.setVolume(volume);recon.current?.setFeature(feature);if(volume)recon.current?.update(imagingControls);},[feature,volume,imagingControls]);
  useEffect(()=>{scene.current?.update(c,plane);},[c,plane,ready]);
  useEffect(()=>{scene.current?.setNativeStack(nativeAxial);},[nativeAxial,ready]);
  const startupComplete=ready&&!!volume&&!!axialPlane&&(c.render3d==='anatomy'||volumeStatus.phase==='ready'||volumeStatus.phase==='error')&&!error;
  useEffect(()=>{
    if(bootDone||!startupComplete)return;let second=0,timer=0;
    const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{
      downloads.complete();timer=window.setTimeout(()=>setBootDone(true),450);
    });});
    return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);clearTimeout(timer);};
  },[startupComplete,bootDone,downloads]);
  useEffect(()=>{if(bootDone)onReady?.(patientId);},[bootDone,onReady,patientId]);
  const line=data?.vessels[c.vessel];
  const selectAiFeature=(feature:AiFeature)=>{
    const map=data?.featureMaps[feature.vessel].find(f=>f.name.toLowerCase()===feature.mapName.toLowerCase());
    if(!map)return;
    setMapsVisible(true);
    setC(old=>({...old,vessel:feature.vessel,index:old.vessel===feature.vessel?old.index:0,axialSlice:undefined,
      straightAngle:old.vessel===feature.vessel?old.straightAngle:0,curvedAngle:old.vessel===feature.vessel?old.curvedAngle:0,
      featureIds:{...old.featureIds,[feature.vessel]:map.id}}));
  };
  return <>
    {active&&toolbarHost&&createPortal(<>
      <button ref={aiButton} className="ai-toggle" aria-expanded={aiOpen} aria-controls="ai-results" onClick={()=>setAiOpen(value=>!value)} disabled={!bootDone}>Show AI report</button>
      <details className="layers" inert={!bootDone&&!error}><summary aria-label="Layers" title="Viewer settings"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M9.5 2h5l.5 3 1.7 1 2.9-1 2.5 4.3-2.3 2v2l2.3 2-2.5 4.3-2.9-1-1.7 1-.5 3h-5l-.5-3-1.7-1-2.9 1-2.5-4.3 2.3-2v-2l-2.3-2L4.4 5l2.9 1L9 5Z"/><circle cx="12" cy="12.3" r="3.2"/></svg></summary><div className="layer-menu">
        <button className="mask-toggle" aria-label="CPE masks" aria-pressed={c.cpeVisible} onClick={()=>update('cpeVisible',!c.cpeVisible)}>CPE masks<span aria-hidden="true">{c.cpeVisible?'On':'Off'}</span></button>
        <div className="layer-window">
      <label className="window">W<input aria-label="Window width" type="number" min="1" max="3000" value={c.width} onChange={e=>update('width',Math.max(1,+e.target.value))}/></label>
      <label className="window">L<input aria-label="Window level" type="number" value={c.level} onChange={e=>update('level',+e.target.value)}/></label>
        </div>
        <label><input type="checkbox" checked={c.smoothMeshes} onChange={e=>update('smoothMeshes',e.target.checked)}/>Smooth meshes</label>
        <label title="Straightened CT only. Filters undersampled pixels; the effect can be very subtle at high display resolution. Does not remove geometric background warping."><input type="checkbox" checked={c.cprAntialias} onChange={e=>update('cprAntialias',e.target.checked)}/>Pixel antialiasing</label>
        <label><input type="checkbox" checked={c.smoothEdges} onChange={e=>update('smoothEdges',e.target.checked)}/>Smooth edges</label>
        <label><input type="checkbox" disabled={!data?.surfaces.ascending_aorta} checked={c.aorta} onChange={e=>update('aorta',e.target.checked)}/>Ascending aorta</label>
        <label className="slider">Aorta opacity<input aria-label="Aorta opacity" type="range" min="0" max="1" step=".01" value={c.volumeContext} onChange={e=>update('volumeContext',+e.target.value)}/></label>
        <label><input type="checkbox" checked={c.lumen} onChange={e=>update('lumen',e.target.checked)}/>Lumen</label>
        <label className="slider">Lumen opacity<input aria-label="Lumen opacity" type="range" min="0" max="1" step=".01" value={c.volumeContext} onChange={e=>update('volumeContext',+e.target.value)}/></label>
        <label><input type="checkbox" checked={c.centerline} onChange={e=>update('centerline',e.target.checked)}/>Centerlines</label>
        {vessels.map(v=><div className="layer-row" key={v}><label><input type="checkbox" checked={c.cpe[v]} onChange={e=>update('cpe',{...c.cpe,[v]:e.target.checked})}/>{v} CPE</label><input type="color" aria-label={`${v} CPE color`} value={c.colors[v]} onChange={e=>update('colors',{...c.colors,[v]:e.target.value})}/></div>)}
        <label className="slider">CPE opacity<input aria-label="CPE opacity" type="range" min="0" max=".85" step=".01" value={c.cpeOpacity} onChange={e=>update('cpeOpacity',+e.target.value)}/></label>
        <label className="slider">Map opacity<input aria-label="Feature map opacity" type="range" min="0" max="1" step=".01" value={c.featureOpacity} onChange={e=>update('featureOpacity',+e.target.value)}/></label>
        <label><input type="checkbox" checked={c.raw} onChange={e=>update('raw',e.target.checked)}/>CCTA</label>
        <label><input type="checkbox" checked={c.context} onChange={e=>update('context',e.target.checked)}/>3D plane</label>
        <div className="layer-menu-footer"><button title="Reset camera and CPR rotations" onClick={e=>{scene.current?.reset();setC(old=>({...old,curvedAngle:0,straightAngle:0}));const menu=e.currentTarget.closest('details');if(menu)menu.open=false;}} disabled={!ready}>Reset</button></div>
      </div></details>
    </>,toolbarHost)}
    <main inert={!bootDone&&!error} aria-busy={(!bootDone&&!error)||!!featureInfo&&!feature}>
    <div className="vessel-toolbar" role="toolbar" aria-label="Vessel and radiomic map controls">
      <label className="vessel-control"><span>Vessel</span><select aria-label="Vessel" value={c.vessel} onChange={e=>select(e.target.value as Vessel)}>{vessels.map(v=><option key={v}>{v}</option>)}</select></label>
      <button className="cpe-toggle" aria-pressed={c.render3d==='cpe'} disabled={!data} onClick={()=>setC(old=>{const show=old.render3d!=='cpe';return {...old,render3d:show?'cpe':'anatomy',cpeVisible:show,...(show?{cpe:{LAD:true,LCx:true,RCA:true}}:{})};})}>Show periluminal envelopes</button>
      <button className="maps-toggle" aria-pressed={mapsVisible} disabled={!availableFeatures.length&&!mapsVisible} title={availableFeatures.length?'Toggle vessel-specific radiomic maps':'No radiomic maps prepared for this vessel'} onClick={()=>setMapsVisible(value=>!value)}>Show radiomic maps</button>
      {mapsVisible&&availableFeatures.length>0&&<select className="feature-select" aria-label="Radiomic feature map" value={featureId} onChange={e=>update('featureIds',{...c.featureIds,[c.vessel]:e.target.value})}>
        {availableFeatures.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
      </select>}
      {featureInfo&&scale&&<div className="feature-scale" aria-label="Feature color scale" title={`${featureInfo.name}: ${cohort?`local feature percentile in ${cohort.nPatients} derivation patients; equal patient weights; reference ${cohort.id}`:scaleMode==='balanced'?'patient 2nd percentile / median / 98th percentile':'patient raw, zero-centered'}`}><i style={{background:FEATURE_GRADIENT}}/><div>{(cohort?['P0','P50','P100']:(scale as [number,number,number]).map(featureNumber)).map((label,i)=><span key={i}>{label}</span>)}</div></div>}
      {featureInfo&&!feature&&<span className="map-loading">Loading map…</span>}
    </div>
    {error&&<div className="error" role="alert">{error}<button onClick={()=>location.reload()}>Reload</button></div>}
    <div className="workspace">
      <section className="panel overview" aria-label={aiOpen?'AI report':'3D coronary view'}>
        <div className="overview-scene-layer" inert={aiOpen} aria-hidden={aiOpen}><h2>3D</h2>
        {c.render3d==='cpe'&&<div className="render3d-controls">
          <details className="volume-settings"><summary aria-label="CPE volume settings">Settings</summary><div className="volume-menu">
            <output className="tissue-reference-info" aria-label="Tissue rendering reference">Multi-reference</output>
            {tissueReference&&<>
              <output className="tissue-reference-info" aria-label="High HU threshold" title="Experimental display boundary: max(350 HU, aortic blood P99).">{Math.round(calibratedHu(350,tissueReference))} HU · aortic P99</output>
              <output className="tissue-reference-info" aria-label="Tissue reference medians" title="Native HU medians: CPE fat-range voxels and eroded myocardium. Experimental display references, not plaque labels.">Fat {Math.round(tissueReference.fat!.p50HU)} · Muscle {Math.round(tissueReference.myocardium!.p50HU)} HU</output>
              <label title="Fade opacity where attenuation resembles the sampled blood or myocardium. Overlapping plaque intensities can also fade; set to zero to inspect without this fade.">Blood/muscle fade<input aria-label="Blood and muscle fade" type="range" min="0" max="1" step=".05" value={c.volumeReferenceFade} onChange={e=>update('volumeReferenceFade',+e.target.value)}/></label>
            </>}
            <label>Density<input aria-label="CPE volume density" type="range" min="0" max="2" step=".05" value={c.volumeDensity} onChange={e=>update('volumeDensity',+e.target.value)}/></label>
            {attenuationBands.map(band=><label key={band.id} title={tissueReference?attenuationRange(band.id,tissueReference):undefined}>{band.label}<input aria-label={`${band.label} opacity`} type="range" min="0" max="2" step=".05" value={c.volumeBands[band.id]} onChange={e=>update('volumeBands',{...c.volumeBands,[band.id]:+e.target.value})}/></label>)}
            <label>Context<input aria-label="CPE anatomical context opacity" type="range" min="0" max="1" step=".01" value={c.volumeContext} onChange={e=>update('volumeContext',+e.target.value)}/></label>
          </div></details>
        </div>}
        <div className="scene" ref={sceneHost}/>{!ready&&<span className="loading">Loading…</span>}
        {c.render3d==='cpe'&&volumeStatus.phase==='preparing'&&<span className="volume-status" role="status">Preparing CPE volume…</span>}
        {c.render3d==='cpe'&&volumeStatus.phase==='error'&&<div className="volume-status" role="alert">{volumeStatus.message}<button onClick={()=>scene.current?.retryVolume()}>Retry</button></div>}
        {c.render3d==='cpe'&&volumeStatus.phase==='ready'&&<div className="volume-legend" aria-label="CPE CT attenuation bands" title="Display bands in native HU, not validated plaque or histological classifications. Colors apply only to saved CPE voxels; they are independent of the radiomic-map palette.">{attenuationLegend.map(band=><span key={band.id} title={`${band.description}${tissueReference?` · ${attenuationRange(band.id,tissueReference)}`:''}`}><i style={{background:band.color}}/>{band.label}</span>)}</div>}
        </div>
      {data&&<AiPanel key={data.patientId} patientId={data.patientId} open={active&&aiOpen} onClose={closeAi} selectedFeature={featureInfo?.name} onSelectFeature={selectAiFeature} maps={data.featureMaps}/>}
      </section>
      <section className={`recon${windowLevel.windowing?' is-windowing':''}`} aria-label="Coronary reconstructions" {...windowLevel.handlers}><div className="cpr-render" ref={cprHost}/>{[0,1].map(view=><div key={view} className={`cpr-hit ${view===0?'straight':'curved'}`} aria-label={view===0?'Straightened reconstruction':'Curved CPR'} title="Right-drag: left/right adjusts window width; up/down adjusts level."
        onPointerDown={e=>{if(!volume||e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,angle:view===0?c.straightAngle:c.curvedAngle,view};}}
        onPointerMove={e=>{const d=drag.current;if(!d||!e.buttons)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;
          if(!d.mode&&Math.hypot(dx,dy)>4)d.mode=d.view===1||Math.abs(dx)>=Math.abs(dy)?'rotate':'navigate';
          if(d.mode==='rotate')update(d.view===0?'straightAngle':'curvedAngle',((d.angle+dx*.6)%360+360)%360);
          else if(d.mode==='navigate')update('index',recon.current!.indexAt(e.clientY,0));}}
        onPointerUp={e=>{const d=drag.current;if(d&&!d.mode)update('index',recon.current!.indexAt(e.clientY,view));drag.current=undefined;}}
        onPointerCancel={()=>{drag.current=undefined;}} onWheel={e=>{if(line)update('index',Math.max(0,Math.min(line.points.length-1,c.index+Math.sign(e.deltaY))));}}>
          <h2>{view===0?'Straightened':'Curved CPR'}</h2><output className="angle" aria-label={view===0?'Straightened rotation':'CPR rotation'}>{Math.round(view===0?c.straightAngle:c.curvedAngle)}°</output>
          {volume&&markers[view]&&<div className="position-marker" aria-hidden="true"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={markers[view].line.map(p=>p.join(',')).join(' ')}/></svg><i style={{left:`${markers[view].center[0]}%`,top:`${markers[view].center[1]}%`}}/></div>}
          {!volume&&<span className="loading">Loading…</span>}
        </div>)}{windowLevel.windowing&&<output className="window-level-readout">W {c.width} · L {c.level}</output>}</section>
      <div className="right-views">
        <section className="panel"><h2>Cross-section</h2>{data&&<SliceView active={active} kind="cross" onNavigate={i=>update('index',i)} onWindowLevel={changeWindowLevel} plane={plane} data={data} c={imagingControls} onSelect={i=>update('index',i)}/>}</section>
        <section className="panel"><h2>Axial</h2>{data&&<SliceView active={active} kind="axial" onNavigate={i=>setC(old=>navigateAxial(data,old,i))} onWindowLevel={changeWindowLevel} plane={axialPlane} data={data} c={imagingControls} onSelect={i=>update('index',i)}/>}</section>
      </div>
    </div>
  </main>
    {!bootDone&&!error&&<div className={`initial-loader${bootPercent===100?' complete':''}`}>
      <div className="initial-progress" role="progressbar" aria-label="Loading viewer" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bootPercent}>
        <div className="initial-progress-patient">Patient {patientId}</div><div className="initial-progress-label"><span>Loading…</span><span>{bootPercent}%</span></div>
        <div className="initial-progress-track"><div style={{width:`${bootPercent}%`}}/></div>
      </div>
    </div>}
  </>;
}
