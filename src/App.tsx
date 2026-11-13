import {useEffect,useMemo,useRef,useState} from 'react';
import {Scene} from './scene';
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

const initial:Controls={vessel:'LAD',index:30,curvedAngle:0,straightAngle:0,featureIds:{LAD:'',LCx:'',RCA:''},featureOpacity:.7,featureScale:'balanced',cpeVisible:true,cprAntialias:true,smoothEdges:true,smoothMeshes:true,aorta:true,aortaOpacity:.6,lumen:true,centerline:true,cpe:{LAD:true,LCx:true,RCA:true},cpeOpacity:0.2,lumenOpacity:1,raw:true,context:false,width:800,level:250,colors:{LAD:'#e7636b',LCx:'#56a8e8',RCA:'#efa343'},side:'merged'};
export default function App(){
  const [data,setData]=useState<Case>(),[c,setC]=useState(initial),[error,setError]=useState(''),[ready,setReady]=useState(false);
  const [bootPercent,setBootPercent]=useState(0),[bootDone,setBootDone]=useState(false),[downloads]=useState(()=>new InitialProgress(setBootPercent));
  const [loaded,setLoaded]=useState<{data:Case;volumes:Record<Vessel,Volume>}>(),[nativeAxial,setNativeAxial]=useState<AxialVolume>();
  const [featureCache,setFeatureCache]=useState<{data:Case;cache:ResourceCache<FeatureVolume>}>(),[,refreshFeatures]=useState(0);
  const [markers,setMarkers]=useState<CprMarker[]>([]),[exporting,setExporting]=useState(false);
  const [aiOpen,setAiOpen]=useState(false),aiButton=useRef<HTMLButtonElement>(null);
  const closeAi=()=>{setAiOpen(false);aiButton.current?.focus();};
  const sceneHost=useRef<HTMLDivElement>(null),cprHost=useRef<HTMLDivElement>(null),scene=useRef<Scene|undefined>(undefined),recon=useRef<CprScene|undefined>(undefined);
  const crossCanvas=useRef<HTMLCanvasElement|null>(null),axialCanvas=useRef<HTMLCanvasElement|null>(null);
  const drag=useRef<{x:number;y:number;angle:number;view:number;mode?:'rotate'|'navigate'}|undefined>(undefined);
  const update=<K extends keyof Controls>(key:K,value:Controls[K])=>setC(old=>({...old,[key]:value,...(key==='index'?{axialSlice:undefined}:{})}));
  const select=(vessel:Vessel,index=0)=>setC(old=>({...old,vessel,index,axialSlice:undefined,curvedAngle:vessel===old.vessel?old.curvedAngle:0,straightAngle:vessel===old.vessel?old.straightAngle:0}));
  const volume=loaded&&loaded.data===data?loaded.volumes[c.vessel]:undefined;
  const availableFeatures=data?.featureMaps?.[c.vessel]??[],featureId=c.featureIds[c.vessel],featureInfo=availableFeatures.find(f=>f.id===featureId);
  const feature=featureCache&&featureCache.data===data&&featureInfo?featureCache.cache.get(featureId):undefined;
  const scale=featureInfo?featureScale(featureInfo,c.featureScale):undefined;
  const basePlane=useMemo(()=>data&&volume?crossSection(data,c,volume):undefined,[data,volume,c.vessel,c.index,c.smoothEdges]);
  const plane=useMemo(()=>data&&basePlane&&feature?{...basePlane,feature:crossFeature(data,c,basePlane,feature)}:basePlane,[data,basePlane,feature,c.vessel,c.index,c.smoothEdges]);
  const slice=data?axialIndex(data,c):0;
  const baseAxial=useMemo(()=>nativeAxial?.slice(slice,c.vessel),[nativeAxial,slice,c.vessel]);
  const axialPlane=useMemo(()=>baseAxial&&feature&&data?{...baseAxial,feature:feature.axialPlane(slice,data.geometry.shape,c.smoothEdges)}:baseAxial,[baseAxial,feature,data,slice,c.smoothEdges]);
  useEffect(()=>{const abort=new AbortController();fetch('/api/case',{signal:abort.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error((await r.json()).detail);const d=await r.json();if(!d.volumes||!d.axialVolume)throw new Error('Run backend.prepare to prepare native viewer volumes');return d as Case;}).then(d=>{downloads.plan(d);setData(d);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>abort.abort();},[downloads]);
  useEffect(()=>{
    if(!data||!sceneHost.current||!cprHost.current)return;const abort=new AbortController();
    const s=new Scene(sceneHost.current,data,select),r=new CprScene(cprHost.current,data,setMarkers);scene.current=s;recon.current=r;
    s.load(abort.signal,downloads).then(()=>{if(!abort.signal.aborted)setReady(true);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return()=>{abort.abort();scene.current=undefined;recon.current=undefined;r.dispose();s.dispose();};
  },[data]);
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
  useEffect(()=>{recon.current?.setVolume(volume);recon.current?.setFeature(feature);if(volume)recon.current?.update(c);},[feature,volume,c]);
  useEffect(()=>{scene.current?.update(c,plane);},[c,plane,ready]);
  const startupComplete=ready&&!!volume&&!!axialPlane&&!error;
  useEffect(()=>{
    if(bootDone||!startupComplete)return;let second=0,timer=0;
    const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{
      downloads.complete();timer=window.setTimeout(()=>setBootDone(true),450);
    });});
    return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);clearTimeout(timer);};
  },[startupComplete,bootDone,downloads]);
  const exportView=async()=>{
    if(!scene.current||!recon.current||!data||!axialPlane||!plane)return;setExporting(true);
    try{const leftPromise=scene.current.capture();scene.current.update(c,plane);const [left,middle]=await Promise.all([leftPromise,recon.current.capture()]);
      const images=await Promise.all([left,middle].map(async url=>{const img=new Image();img.src=url;await img.decode();return img;}));
      const out=document.createElement('canvas');out.width=1600;out.height=960;const ctx=out.getContext('2d')!;ctx.fillStyle='#000';ctx.fillRect(0,0,1600,960);
      const fit=(image:CanvasImageSource,w:number,h:number,x:number,y:number,bw:number,bh:number)=>{const s=Math.min(bw/w,bh/h),r={x:x+(bw-w*s)/2,y:y+(bh-h*s)/2,w:w*s,h:h*s};ctx.drawImage(image,r.x,r.y,r.w,r.h);return r;};
      fit(images[0],images[0].width,images[0].height,0,35,630,925);const middleRect=fit(images[1],images[1].width,images[1].height,635,35,580,925);
      ctx.strokeStyle='#e7c84f';ctx.lineWidth=1;
      markers.forEach(({center:[x,y],line},view)=>{const left=middleRect.x+view*middleRect.w/2;ctx.beginPath();line.forEach(([px,py],i)=>{const q=[left+px/100*middleRect.w/2,middleRect.y+py/100*middleRect.h];if(i)ctx.lineTo(q[0],q[1]);else ctx.moveTo(q[0],q[1]);});ctx.stroke();ctx.beginPath();ctx.arc(left+x/100*middleRect.w/2,middleRect.y+y/100*middleRect.h,3,0,2*Math.PI);ctx.stroke();});
      if(crossCanvas.current)fit(crossCanvas.current,crossCanvas.current.width,crossCanvas.current.height,1220,35,380,450);
      if(axialCanvas.current)fit(axialCanvas.current,axialCanvas.current.width,axialCanvas.current.height,1220,505,380,450);
      ctx.fillStyle='#c5cbd0';ctx.font='15px system-ui';ctx.fillText(`${c.vessel}  ${data.vessels[c.vessel].distances[c.index].toFixed(1)} mm  Straight ${Math.round(c.straightAngle)}°${c.cprAntialias?' AA':''}  Curved ${Math.round(c.curvedAngle)}°   W ${c.width}  L ${c.level}${featureInfo&&scale?`   ${featureInfo.name}  ${c.featureScale} [${scale.map(featureNumber).join(', ')}]`:''}`,16,24);
      const a=document.createElement('a');a.download=`coronary-case-${data.patientId}-${c.vessel}.png`;a.href=out.toDataURL();a.click();
    }catch(e){setError(`Export: ${e instanceof Error?e.message:String(e)}`);}finally{setExporting(false);}
  };
  const line=data?.vessels[c.vessel];
  const selectAiFeature=(feature:AiFeature)=>{
    const map=data?.featureMaps[feature.vessel].find(f=>f.name.toLowerCase()===feature.mapName.toLowerCase());
    if(!map)return;
    setC(old=>({...old,vessel:feature.vessel,index:old.vessel===feature.vessel?old.index:0,axialSlice:undefined,
      straightAngle:old.vessel===feature.vessel?old.straightAngle:0,curvedAngle:old.vessel===feature.vessel?old.curvedAngle:0,
      featureIds:{...old.featureIds,[feature.vessel]:map.id}}));
  };
  return <><main inert={!bootDone&&!error} aria-busy={!bootDone&&!error}>
    <header className="toolbar" aria-label="Viewer controls">
      <select aria-label="Vessel" value={c.vessel} onChange={e=>select(e.target.value as Vessel)}>{vessels.map(v=><option key={v}>{v}</option>)}</select>
      <select className="feature-select" aria-label="Radiomic feature map" disabled={!availableFeatures.length} value={featureId} onChange={e=>update('featureIds',{...c.featureIds,[c.vessel]:e.target.value})}>
        <option value="">{availableFeatures.length?'No feature map':'No feature maps'}</option>{availableFeatures.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      {featureInfo&&<select className="scale-select" aria-label="Feature scale" value={c.featureScale} title="Balanced: 2nd percentile / median / 98th percentile. Raw zero: original sign and symmetric extrema." onChange={e=>update('featureScale',e.target.value as Controls['featureScale'])}><option value="balanced">Balanced</option><option value="raw">Raw zero</option></select>}
      {featureInfo&&scale&&<div className="feature-scale" aria-label="Feature color scale" title={`${featureInfo.name}: ${c.featureScale==='balanced'?'2nd percentile / median / 98th percentile':'raw, zero-centered'}`}><i style={{background:FEATURE_GRADIENT}}/><div>{scale.map((value,i)=><span key={i}>{featureNumber(value)}</span>)}</div></div>}
      {featureInfo&&!feature&&<span className="map-loading">Loading map…</span>}
      <button className="mask-toggle" aria-label="CPE masks" aria-pressed={c.cpeVisible} onClick={()=>update('cpeVisible',!c.cpeVisible)}>CPE masks</button>
      <details className="layers"><summary>Layers</summary><div className="layer-menu">
        <label><input type="checkbox" checked={c.smoothMeshes} onChange={e=>update('smoothMeshes',e.target.checked)}/>Smooth meshes</label>
        <label title="Straightened CT only. Filters undersampled pixels; the effect can be very subtle at high display resolution. Does not remove geometric background warping."><input type="checkbox" checked={c.cprAntialias} onChange={e=>update('cprAntialias',e.target.checked)}/>Pixel antialiasing</label>
        <label><input type="checkbox" checked={c.smoothEdges} onChange={e=>update('smoothEdges',e.target.checked)}/>Smooth edges</label>
        <label><input type="checkbox" disabled={!data?.surfaces.ascending_aorta} checked={c.aorta} onChange={e=>update('aorta',e.target.checked)}/>Ascending aorta</label>
        <label className="slider">Aorta opacity<input aria-label="Aorta opacity" type="range" min="0" max="1" step=".01" value={c.aortaOpacity} onChange={e=>update('aortaOpacity',+e.target.value)}/></label>
        <label><input type="checkbox" checked={c.lumen} onChange={e=>update('lumen',e.target.checked)}/>Lumen</label>
        <label className="slider">Opacity<input aria-label="Lumen opacity" type="range" min="0" max="1" step=".01" value={c.lumenOpacity} onChange={e=>update('lumenOpacity',+e.target.value)}/></label>
        <label><input type="checkbox" checked={c.centerline} onChange={e=>update('centerline',e.target.checked)}/>Centerlines</label>
        {vessels.map(v=><div className="layer-row" key={v}><label><input type="checkbox" checked={c.cpe[v]} onChange={e=>update('cpe',{...c.cpe,[v]:e.target.checked})}/>{v} CPE</label><input type="color" aria-label={`${v} CPE color`} value={c.colors[v]} onChange={e=>update('colors',{...c.colors,[v]:e.target.value})}/></div>)}
        <label className="slider">CPE opacity<input aria-label="CPE opacity" type="range" min="0" max=".85" step=".01" value={c.cpeOpacity} onChange={e=>update('cpeOpacity',+e.target.value)}/></label>
        <label className="slider">Map opacity<input aria-label="Feature map opacity" type="range" min="0" max="1" step=".01" value={c.featureOpacity} onChange={e=>update('featureOpacity',+e.target.value)}/></label>
        <label><input type="checkbox" checked={c.raw} onChange={e=>update('raw',e.target.checked)}/>CCTA</label>
        <label><input type="checkbox" checked={c.context} onChange={e=>update('context',e.target.checked)}/>3D plane</label>
      </div></details>
      <button ref={aiButton} className="ai-toggle" aria-expanded={aiOpen} aria-controls="ai-results" onClick={()=>setAiOpen(value=>!value)} disabled={!data}>AI</button>
      <label className="window">W<input aria-label="Window width" type="number" min="1" max="3000" value={c.width} onChange={e=>update('width',Math.max(1,+e.target.value))}/></label>
      <label className="window">L<input aria-label="Window level" type="number" value={c.level} onChange={e=>update('level',+e.target.value)}/></label>
      <button onClick={()=>{scene.current?.reset();setC(old=>({...old,curvedAngle:0,straightAngle:0}));}} disabled={!ready}>Reset</button>
      <button onClick={exportView} disabled={!bootDone||!volume||!ready||!axialPlane||!!featureInfo&&!feature||exporting}>{exporting?'…':'Export'}</button>
    </header>
    {error&&<div className="error" role="alert">{error}<button onClick={()=>location.reload()}>Reload</button></div>}
    <div className="workspace">
      <section className="panel overview" aria-label="3D coronary view"><h2>3D</h2><div className="scene" ref={sceneHost}/>{!ready&&<span className="loading">Loading…</span>}</section>
      <section className="recon" aria-label="Coronary reconstructions"><div className="cpr-render" ref={cprHost}/>{[0,1].map(view=><div key={view} className={`cpr-hit ${view===0?'straight':'curved'}`} aria-label={view===0?'Straightened reconstruction':'Curved CPR'}
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
        </div>)}</section>
      <div className="right-views">
        <section className="panel"><h2>Cross-section</h2>{data&&<SliceView kind="cross" onNavigate={i=>update('index',i)} plane={plane} data={data} c={c} onSelect={i=>update('index',i)} register={el=>{crossCanvas.current=el;}}/>}</section>
        <section className="panel"><h2>Axial</h2>{data&&<SliceView kind="axial" onNavigate={i=>setC(old=>navigateAxial(data,old,i))} plane={axialPlane} data={data} c={c} onSelect={i=>update('index',i)} register={el=>{axialCanvas.current=el;}}/>}</section>
      </div>
      {data&&<AiPanel key={data.patientId} patientId={data.patientId} open={aiOpen} onClose={closeAi} selectedFeature={featureInfo?.name} onSelectFeature={selectAiFeature}/>}
    </div>
  </main>
    {!bootDone&&!error&&<div className={`initial-loader${bootPercent===100?' complete':''}`}>
      <div className="initial-progress" role="progressbar" aria-label="Loading viewer" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bootPercent}>
        <div className="initial-progress-label"><span>Loading…</span><span>{bootPercent}%</span></div>
        <div className="initial-progress-track"><div style={{width:`${bootPercent}%`}}/></div>
      </div>
    </div>}
  </>;
}
