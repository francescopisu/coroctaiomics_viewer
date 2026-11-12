import {type Vec3} from './types';

export interface ViewBasis {right:Vec3;up:Vec3;toward:Vec3}
const dot=(a:Vec3,b:Vec3)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a:Vec3,b:Vec3)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]] as Vec3;
const norm=(a:Vec3)=>{const length=Math.hypot(...a)||1;return a.map(x=>x/length) as Vec3;};
export function cameraBasis(position:Vec3,focal:Vec3,viewUp:Vec3):ViewBasis{
  const toward=norm(position.map((x,i)=>x-focal[i]) as Vec3),right=norm(cross(viewUp,toward));return {right,up:norm(cross(toward,right)),toward};
}
export function planeBasis(right:Vec3,down:Vec3):ViewBasis{
  const r=norm(right),up=norm(down.map(x=>-x) as Vec3);return {right:r,up,toward:norm(cross(r,up))};
}
export function directionLabel(direction:Vec3){
  return direction.map((v,i)=>({value:Math.abs(v),label:(v>=0?['L','P','S']:['R','A','I'])[i]})).filter(a=>a.value>.2).sort((a,b)=>b.value-a.value).map(a=>a.label).join('');
}
const faceDefinitions=[
  {label:'L',normal:[1,0,0],color:'#ef4a4a',vertices:[[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]},
  {label:'R',normal:[-1,0,0],color:'#ef4a4a',vertices:[[-1,1,-1],[-1,-1,-1],[-1,-1,1],[-1,1,1]]},
  {label:'P',normal:[0,1,0],color:'#45ce56',vertices:[[1,1,-1],[-1,1,-1],[-1,1,1],[1,1,1]]},
  {label:'A',normal:[0,-1,0],color:'#45ce56',vertices:[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]]},
  {label:'S',normal:[0,0,1],color:'#577cff',vertices:[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]},
  {label:'I',normal:[0,0,-1],color:'#577cff',vertices:[[-1,1,-1],[1,1,-1],[1,-1,-1],[-1,-1,-1]]}
];
export function cubeFaces(basis:ViewBasis,size:number){
  const project=(p:number[])=>[dot(p as Vec3,basis.right),-dot(p as Vec3,basis.up)];
  const faces=faceDefinitions.map(f=>({...f,depth:dot(f.normal as Vec3,basis.toward),points:f.vertices.map(project),center:project(f.normal)})).filter(f=>f.depth>1e-6).sort((a,b)=>a.depth-b.depth);
  const points=faces.flatMap(f=>f.points),extent=Math.max(...points.flatMap(p=>p.map(Math.abs)),1),scale=size*.43/extent;
  const fit=(p:number[])=>[size/2+p[0]*scale,size/2+p[1]*scale];
  return faces.map(f=>({...f,points:f.points.map(fit),center:fit(f.center)}));
}
export function cubeSvg(basis:ViewBasis,size=68){
  return cubeFaces(basis,size).map(f=>`<polygon points="${f.points.map(p=>p.map(x=>x.toFixed(3)).join(',')).join(' ')}" fill="#050b10" fill-opacity=".95" stroke="${f.color}" stroke-width="1.6" stroke-linejoin="round"/>${f.depth>.15?`<text x="${f.center[0].toFixed(3)}" y="${f.center[1].toFixed(3)}" fill="${f.color}" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-weight="bold" font-size="${size*.27}" data-face="${f.label}">${f.label}</text>`:''}`).join('');
}
export function drawCube(ctx:CanvasRenderingContext2D,basis:ViewBasis,x:number,y:number,size:number){
  ctx.save();ctx.translate(x,y);ctx.lineWidth=size*.024;ctx.lineJoin='round';
  for(const f of cubeFaces(basis,size)){
    ctx.beginPath();f.points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle='#050b10';ctx.globalAlpha=.95;ctx.fill();ctx.globalAlpha=1;ctx.strokeStyle=f.color;ctx.stroke();
    if(f.depth>.15){ctx.fillStyle=f.color;ctx.font=`bold ${size*.27}px Arial,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(f.label,f.center[0],f.center[1]);}
  }
  ctx.restore();
}
