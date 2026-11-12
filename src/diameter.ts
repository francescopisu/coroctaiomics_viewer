export interface LumenReference {areaMm2:number;diameterMm:number|null;clipped:boolean}
/** Area-equivalent diameter of the unsmoothed component at the centreline. */
export function lumenReference(mask:Uint8Array,width:number,height:number,spacingMm:number):LumenReference|null{
  const cx=(width-1)/2,cy=(height-1)/2;let seed=-1,distance=Infinity;
  for(let i=0;i<mask.length;i++)if(mask[i]){const d=Math.hypot(i%width-cx,Math.floor(i/width)-cy)*spacingMm;if(d<distance){distance=d;seed=i;}}
  if(seed<0||distance>.5)return null;
  const seen=new Uint8Array(mask.length),queue=new Int32Array(mask.length);let head=0,tail=1,clipped=false;queue[0]=seed;seen[seed]=1;
  while(head<tail){const i=queue[head++],x=i%width,y=Math.floor(i/width);if(x===0||y===0||x===width-1||y===height-1)clipped=true;
    for(const j of [x>0?i-1:-1,x<width-1?i+1:-1,y>0?i-width:-1,y<height-1?i+width:-1])if(j>=0&&mask[j]&&!seen[j]){seen[j]=1;queue[tail++]=j;}
  }
  const areaMm2=tail*spacingMm**2;return {areaMm2,diameterMm:clipped?null:2*Math.sqrt(areaMm2/Math.PI),clipped};
}
