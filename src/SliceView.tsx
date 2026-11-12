import {useEffect,useMemo,useRef,useState} from 'react';
import {pixels,compositeFeature,axialFeaturePixels,worldIndex,axialIndex,type Plane} from './slices';
import {rgba,type Case,type Controls,type Vec3} from './types';
import {contours,contourPath} from './contours';
import {planeBasis,directionLabel,drawCube} from './orientation';
import {lumenReference} from './diameter';
import {clampSlice,nearestCentreline} from './sliceNavigation';
export function SliceView({kind,plane,data,c,onSelect,onNavigate,register}:{kind:'cross'|'axial';plane?:Plane;data:Case;c:Controls;onSelect:(i:number)=>void;onNavigate:(i:number)=>void;register:(canvas:HTMLCanvasElement|null)=>void}){
  const ref=useRef<HTMLCanvasElement>(null),host=useRef<HTMLDivElement>(null),latest=useRef({c,onNavigate}),drag=useRef<{y:number;index:number;moved:boolean;pointer:number}|undefined>(undefined);
  latest.current={c,onNavigate};const [size,setSize]=useState(0);
  const count=kind==='cross'?data.vessels[c.vessel].points.length:data.geometry.shape[2],current=kind==='cross'?c.index:axialIndex(data,c);
  useEffect(()=>{const element=host.current!;const observer=new ResizeObserver(()=>setSize(Math.min(element.clientWidth,element.clientHeight)));observer.observe(element);return()=>observer.disconnect();},[]);
  useEffect(()=>{const element=host.current!;let accumulated=0;const wheel=(event:WheelEvent)=>{
    if(event.ctrlKey||event.metaKey||!event.deltaY)return;event.preventDefault();const value=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?element.clientHeight:1);let step=0;
    if(Math.abs(value)>=40){step=Math.sign(value);accumulated=0;}else{if(Math.sign(accumulated)!==Math.sign(value))accumulated=0;accumulated+=value;if(Math.abs(accumulated)>=30){step=Math.sign(accumulated);accumulated-=step*30;}}
    if(step){const {c,onNavigate}=latest.current;onNavigate(clampSlice((kind==='cross'?c.index:axialIndex(data,c))+step,count));}
  };element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);},[data,kind,count,c.vessel]);
  const a=data.geometry.affineLPS,f=data.vessels[c.vessel],basis=kind==='cross'?planeBasis(f.u[c.index],f.v[c.index]):planeBasis(a.slice(0,3).map(row=>row[0]) as Vec3,a.slice(0,3).map(row=>row[1]) as Vec3);
  const reference=useMemo(()=>kind==='cross'&&plane?lumenReference(plane.lumen,plane.width,plane.height,plane.spacingMm!):null,[plane,kind]);
  const loops=useMemo(()=>{
    if(!plane)return;const lumen=plane.lumenField??(plane.feature?.displayMask?Float32Array.from(plane.lumen):undefined),cpe=plane.cpeField??(plane.feature?.displayMask?Float32Array.from(plane.feature.displayMask,v=>v/255):undefined);
    return lumen&&cpe?{lumen:contours(lumen,plane.width,plane.height),cpe:contours(cpe,plane.width,plane.height)}:undefined;
  },[plane]);
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;const ctx=canvas.getContext('2d')!;
    canvas.width=plane?.width??50;canvas.height=plane?.height??50;if(!plane)return;
    const temp=document.createElement('canvas');temp.width=plane.width;temp.height=plane.height;
    const display=loops?new Uint8ClampedArray(rgba(plane.ct,0,plane.ct.length,c)):pixels(plane,c);
    if(loops&&plane.feature)compositeFeature(display,plane.feature,c.featureOpacity,c.featureScale);
    temp.getContext('2d')!.putImageData(new ImageData(display,plane.width,plane.height),0,0);
    canvas.width=kind==='cross'?1024:600;canvas.height=canvas.width*plane.height/plane.width;
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(temp,0,0,canvas.width,canvas.height);
    if(kind==='axial'&&plane.feature){
      ctx.putImageData(new ImageData(axialFeaturePixels(plane,c,canvas.width),canvas.width,canvas.height),0,0);
    }
    const cssSide=Math.max(1,size),pixel=canvas.width/cssSide;
    if(loops){
      const draw=(shape:ReturnType<typeof contours>,color:string,opacity:number,fill:number)=>{
        const path=contourPath(shape,canvas.width,canvas.height);ctx.fillStyle=color;ctx.globalAlpha=fill;ctx.fill(path,'evenodd');
        ctx.globalAlpha=opacity;ctx.strokeStyle=color;ctx.lineWidth=1.5*pixel;ctx.lineJoin='round';ctx.stroke(path);ctx.globalAlpha=1;
      };
      if(c.cpeVisible&&c.cpe[c.vessel])draw(loops.cpe,c.colors[c.vessel],0.95,plane.feature?0:c.cpeOpacity);
      if(c.lumen)draw(loops.lumen,'#ffffff',c.lumenOpacity,0.08*c.lumenOpacity);
    }
    const ijk=worldIndex(data.geometry.affineLPS,data.vessels[c.vessel].points[c.index]);
    const x=kind==='cross'?canvas.width/2:(ijk[0]+0.5)/plane.width*canvas.width,y=kind==='cross'?canvas.height/2:(ijk[1]+0.5)/plane.height*canvas.height;
    canvas.dataset.centrelineIndex=String(c.index);canvas.dataset.distanceMm=String(f.distances[c.index]);canvas.dataset.sliceIndex=String(axialIndex(data,c));canvas.dataset.crosshairX=String(x);canvas.dataset.crosshairY=String(y);
    if(kind==='axial'){
      const axis=(color:string,horizontal:boolean)=>{ctx.strokeStyle=color;ctx.lineWidth=pixel;ctx.beginPath();const center=horizontal?x:y,limit=horizontal?canvas.width:canvas.height;
        for(const [start,end] of [[0,center-12*pixel],[center+12*pixel,limit]]){if(horizontal){ctx.moveTo(start,y);ctx.lineTo(end,y);}else{ctx.moveTo(x,start);ctx.lineTo(x,end);}}
        for(const tick of [center-limit/4,center+limit/4])if(tick>0&&tick<limit){if(horizontal){ctx.moveTo(tick,y-5*pixel);ctx.lineTo(tick,y+5*pixel);}else{ctx.moveTo(x-5*pixel,tick);ctx.lineTo(x+5*pixel,tick);}}ctx.stroke();};
      axis('#d14955',true);axis('#69b54c',false);
    }else{ctx.strokeStyle='#e7c84f';ctx.lineWidth=pixel;ctx.beginPath();ctx.moveTo(x-6*pixel,y);ctx.lineTo(x+6*pixel,y);ctx.moveTo(x,y-6*pixel);ctx.lineTo(x,y+6*pixel);ctx.stroke();}
    ctx.font=`${12*pixel}px system-ui`;ctx.textBaseline='top';ctx.fillStyle='#cbd5db';ctx.shadowColor='#000';ctx.shadowBlur=3*pixel;
    if(kind==='cross'){
      ctx.fillText(`Lumen Øeq: ${reference?.diameterMm!=null?reference.diameterMm.toFixed(2)+' mm':'—'}`,10*pixel,9*pixel);
      ctx.shadowBlur=0;ctx.strokeStyle='#bcc6ce';ctx.lineWidth=pixel;const end=canvas.width-12*pixel,start=end-5/(plane.width*plane.spacingMm!)*canvas.width;
      ctx.beginPath();ctx.moveTo(start,canvas.height-14*pixel);ctx.lineTo(end,canvas.height-14*pixel);ctx.stroke();ctx.fillStyle='#bcc6ce';ctx.font=`${10*pixel}px system-ui`;ctx.fillText('5 mm',start,canvas.height-29*pixel);
    }else ctx.fillText(`Slice: ${axialIndex(data,c)+1}/${data.geometry.shape[2]}`,10*pixel,9*pixel);
    ctx.shadowBlur=0;ctx.fillStyle='#7fa46c';ctx.font=`${11*pixel}px system-ui`;ctx.textAlign='center';
    ctx.fillText(directionLabel(basis.up),canvas.width/2,8*pixel);ctx.fillText(directionLabel(basis.up.map(v=>-v) as Vec3),canvas.width/2,canvas.height-21*pixel);
    ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillText(directionLabel(basis.right.map(v=>-v) as Vec3),8*pixel,canvas.height/2);ctx.textAlign='right';ctx.fillText(directionLabel(basis.right),canvas.width-8*pixel,canvas.height/2);
    drawCube(ctx,basis,8*pixel,canvas.height-64*pixel,56*pixel);
  },[plane,c,data,kind,loops,size]);
  return <div ref={host} className={`slice-image ${kind}`} tabIndex={0} role="group" aria-label={kind==='cross'?'Orthogonal slice navigation':'Axial slice navigation'}
    title={kind==='cross'?'Scroll or drag vertically to move along the vessel. Lumen Øeq = diameter of a circle with the same unsmoothed lumen area.':'Scroll or drag vertically through native CT slices. Click to select the nearest vessel point.'}
    onKeyDown={e=>{let next:number|undefined;if(e.key==='ArrowDown')next=current+1;else if(e.key==='ArrowUp')next=current-1;else if(e.key==='PageDown')next=current+10;else if(e.key==='PageUp')next=current-10;else if(e.key==='Home')next=0;else if(e.key==='End')next=count-1;if(next!==undefined){e.preventDefault();onNavigate(clampSlice(next,count));}}}
    onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);drag.current={y:e.clientY,index:current,moved:false,pointer:e.pointerId};}}
    onPointerMove={e=>{const d=drag.current;if(!d||e.pointerId!==d.pointer)return;const dy=e.clientY-d.y;if(Math.abs(dy)>=4)d.moved=true;if(d.moved)onNavigate(clampSlice(d.index+Math.trunc(dy/4),count));}}
    onPointerUp={e=>{const d=drag.current;drag.current=undefined;if(!d||d.moved||kind!=='axial'||!plane||!ref.current)return;
      const rect=ref.current.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)return;
      const x=(e.clientX-rect.left)/rect.width*plane.width-.5,y=(e.clientY-rect.top)/rect.height*plane.height-.5,z=axialIndex(data,c);
      const point=a.slice(0,3).map(row=>row[0]*x+row[1]*y+row[2]*z+row[3]) as Vec3;onSelect(nearestCentreline(data,c.vessel,point));}}
    onPointerCancel={()=>{drag.current=undefined;}} onLostPointerCapture={()=>{drag.current=undefined;}}>
    <canvas aria-label={kind==='cross'?'Orthogonal cross-section':'Axial CCTA'} data-lumen-diameter-mm={reference?.diameterMm??''} ref={el=>{ref.current=el;register(el);}}/>
    {!plane&&<span className="loading">Loading…</span>}
  </div>;
}
