/** Display-only 0.5 isocontours. Retains separate components and lumen holes. */
export type Point2=[number,number];
export function contours(field:Float32Array,width:number,height:number,level=0.5):Point2[][]{
  const nodes=new Map<string,{point:Point2;next:string[]}>();
  const value=(x:number,y:number)=>x<0||y<0||x>=width||y>=height?0:field[x+y*width];
  const segments:Record<number,number[][]>={1:[[3,0]],2:[[0,1]],3:[[3,1]],4:[[1,2]],6:[[0,2]],7:[[3,2]],8:[[2,3]],9:[[2,0]],11:[[2,1]],12:[[1,3]],13:[[1,0]],14:[[0,3]]};
  // Pad with exterior samples so contours clipped by the FOV still have closed fills.
  for(let y=-1;y<height;y++)for(let x=-1;x<width;x++){
    const v=[value(x,y),value(x+1,y),value(x+1,y+1),value(x,y+1)];
    const code=v.reduce((bits,a,i)=>bits|(a>=level?1<<i:0),0);if(code===0||code===15)continue;
    let pairs=segments[code];
    if(code===5||code===10){
      // Asymptotic decider for alternating corners; do not arbitrarily join islands.
      const determinant=(v[0]-level)*(v[2]-level)-(v[1]-level)*(v[3]-level);
      pairs=determinant===0?(code===5?[[3,0],[1,2]]:[[0,1],[2,3]]):determinant>0?[[0,1],[2,3]]:[[3,0],[1,2]];
    }
    const corners:Point2[]=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]];
    const keys=[`h${x},${y}`,`v${x+1},${y}`,`h${x},${y+1}`,`v${x},${y}`];
    const edge=(i:number)=>{const key=keys[i];if(!nodes.has(key)){const j=(i+1)%4,t=(level-v[i])/(v[j]-v[i]);
      nodes.set(key,{point:[(corners[i][0]+t*(corners[j][0]-corners[i][0])+0.5)/width,(corners[i][1]+t*(corners[j][1]-corners[i][1])+0.5)/height],next:[]});}return key;};
    pairs.forEach(([a,b])=>{const ka=edge(a),kb=edge(b);nodes.get(ka)!.next.push(kb);nodes.get(kb)!.next.push(ka);});
  }
  const visited=new Set<string>(),loops:Point2[][]=[];
  for(const start of nodes.keys()){
    if(visited.has(start))continue;let current=start,previous='';const points:Point2[]=[];
    do{const node=nodes.get(current)!;if(visited.has(current))break;visited.add(current);points.push(node.point);
      const next=node.next.find(k=>k!==previous);previous=current;if(!next)break;current=next;
    }while(current!==start&&points.length<=nodes.size);
    if(current===start&&points.length>=3)loops.push(points);
  }
  return loops;
}
export function contourPath(loops:Point2[][],width:number,height:number):Path2D{
  const path=new Path2D();
  for(const loop of loops){
    const last=loop.at(-1)!,first=loop[0];path.moveTo((last[0]+first[0])/2*width,(last[1]+first[1])/2*height);
    // Local quadratic corner rounding is bounded by a single contour sample interval;
    // there is no circle fit, global spline, contour resampling, or mask mutation.
    loop.forEach((p,i)=>{const q=loop[(i+1)%loop.length];path.quadraticCurveTo(p[0]*width,p[1]*height,(p[0]+q[0])/2*width,(p[1]+q[1])/2*height);});path.closePath();
  }
  return path;
}
