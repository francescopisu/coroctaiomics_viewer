import {type Line,type Vec3} from './types';

/** One camera fit for every rotation, with room for the section indicator. */
export function cprLayout(line:Pick<Line,'points'|'distances'>,size:[number,number],fieldMm:number){
  const [viewWidth,viewHeight]=size,aspect=viewWidth/viewHeight,points=line.points;
  const center=points[0].map((_,i)=>points.reduce((sum,p)=>sum+p[i],0)/points.length) as Vec3;
  const chord=points.at(-1)!.map((x,i)=>x-points[0][i]),chordLength=Math.hypot(...chord),axis=chord.map(x=>x/chordLength);
  const radius=Math.max(...points.map(p=>{const r=p.map((x,i)=>x-center[i]),along=r.reduce((sum,x,i)=>sum+x*axis[i],0);return Math.sqrt(Math.max(0,r.reduce((sum,x)=>sum+x*x,0)-along*along));}));
  const width=fieldMm+2*radius,displayHeight=Math.max(line.distances.at(-1)!,width/aspect);
  const markerLength=Math.min(96,viewWidth*.36,viewHeight*.36),padding=markerLength/2+8;
  const parallelScale=Math.max(displayHeight/2*1.04,
    displayHeight/(2*Math.max(.1,1-2*padding/viewHeight)),
    radius/(aspect*Math.max(.1,1-2*padding/viewWidth)));
  return {width,displayHeight,parallelScale,markerLength,padding};
}
