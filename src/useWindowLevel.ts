import {useEffect,useRef,useState,type PointerEvent} from 'react';

export type WindowLevel={width:number;level:number};
type Drag=WindowLevel&{x:number;y:number;pointer:number;host:HTMLElement;gain:number};

/** Capture right-button drags before the panels' existing left-button gestures. */
export function useWindowLevel(value:WindowLevel,onChange:(value:WindowLevel)=>void,active=true){
  const drag=useRef<Drag|undefined>(undefined),[windowing,setWindowing]=useState(false);
  const end=()=>{
    const d=drag.current;drag.current=undefined;setWindowing(false);
    if(d?.host.hasPointerCapture(d.pointer))d.host.releasePointerCapture(d.pointer);
  };
  useEffect(()=>{if(!active)end();},[active]);
  useEffect(()=>{const blur=()=>end();window.addEventListener('blur',blur);return()=>{
    window.removeEventListener('blur',blur);const d=drag.current;drag.current=undefined;
    if(d?.host.hasPointerCapture(d.pointer))d.host.releasePointerCapture(d.pointer);
  };},[]);
  const finish=(event:PointerEvent<HTMLElement>)=>{
    if(drag.current?.pointer!==event.pointerId)return;
    event.preventDefault();event.stopPropagation();end();
  };
  return {windowing,handlers:{
    onContextMenu:(event:{preventDefault:()=>void})=>event.preventDefault(),
    onPointerDownCapture:(event:PointerEvent<HTMLElement>)=>{
      if(!active||event.button!==2||drag.current)return;
      event.preventDefault();event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current={...value,x:event.clientX,y:event.clientY,pointer:event.pointerId,host:event.currentTarget,gain:Math.max(.25,value.width/400)};
      setWindowing(true);
    },
    onPointerMoveCapture:(event:PointerEvent<HTMLElement>)=>{
      const d=drag.current;if(!d||d.pointer!==event.pointerId)return;
      event.preventDefault();event.stopPropagation();
      if(!(event.buttons&2)){end();return;}
      onChange({width:Math.max(1,Math.min(3000,Math.round(d.width+(event.clientX-d.x)*d.gain))),level:Math.round(d.level-(event.clientY-d.y)*d.gain)});
    },
    onPointerUpCapture:finish,
    onPointerCancelCapture:finish,
    onLostPointerCaptureCapture:finish,
  }};
}
