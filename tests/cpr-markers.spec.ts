import {test,expect} from '@playwright/test';
import {curvedSectionMarker} from '../src/curvedMarker';
import {type Vec3} from '../src/types';

const dot=(a:number[],b:number[])=>a.reduce((s,x,i)=>s+x*b[i],0);
const sub=(a:number[],b:number[])=>a.map((x,i)=>x-b[i]) as Vec3;
const norm=(a:number[])=>a.map(x=>x/Math.hypot(...a)) as Vec3;
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]] as Vec3;

test('a tilted tube has the analytic transverse angle, including non-isotropic display scaling',()=>{
  const angle=Math.PI/6,s=Math.sin(angle),c=Math.cos(angle),points=Array.from({length:61},(_,i)=>[(i-30)*s,0,(i-30)*c] as Vec3);
  const line={points,u:points.map(()=>[c,0,-s] as Vec3),v:points.map(()=>[0,1,0] as Vec3)},distances=points.map((_,i)=>i*c),height=distances.at(-1)!;
  const trace=curvedSectionMarker(line,30,[1,0,0],[0,0,0],80,distances,height*2,25);
  const first=trace[0],last=trace.at(-1)!;
  expect(first[0]).toBeCloseTo(40-12.5*c,8);expect(last[0]).toBeCloseTo(40+12.5*c,8);
  expect(first[1]).toBeCloseTo(height-12.5*s*2,8);expect(last[1]).toBeCloseTo(height+12.5*s*2,8);
  // A screen-space perpendicular would divide by two instead, which is wrong.
  expect((last[1]-first[1])/(last[0]-first[0])).toBeCloseTo(Math.tan(angle)*2,8);
  const horizontal=curvedSectionMarker(line,30,[0,1,0],[0,0,0],80,points.map((_,i)=>i),120,25);
  expect(horizontal).toEqual([[27.5,60,0],[52.5,60,0]]);
});

test('parallel directions and endpoint planes give finite, clipped straight markers',()=>{
  for(const angle of [89*Math.PI/180,Math.PI/2]){
    const s=Math.sin(angle),c=Math.cos(angle),points=Array.from({length:61},(_,i)=>[(i-30)*s,0,(i-30)*c] as Vec3);
    const line={points,u:points.map(()=>[c,0,-s] as Vec3),v:points.map(()=>[0,1,0] as Vec3)},distances=points.map((_,i)=>i*Math.max(c,1e-6));
    for(const index of [0,30,60]){
      const marker=curvedSectionMarker(line,index,[1,0,0],[0,0,0],100,distances,120,25);
      expect(marker).toHaveLength(2);expect(marker.flat().every(Number.isFinite)).toBe(true);
      expect(marker.every(p=>p[0]>=0&&p[0]<=100&&p[1]>=-1e-9&&p[1]<=120+1e-9)).toBe(true);
    }
  }
});

test('nearby vessel bends cannot turn the local section marker into a curved trace',()=>{
  const points=Array.from({length:61},(_,i)=>{const z=i-30;return [10*(1-Math.cos(z*.15)),6*(1-Math.cos(z*.3)),z] as Vec3;}),direction=norm([1,.2,.8]),distances=[0];
  for(let i=1;i<points.length;i++)distances.push(distances[i-1]+Math.hypot(...cross(sub(points[i],points[i-1]),direction)));
  const line={points,u:points.map(()=>[1,0,0] as Vec3),v:points.map(()=>[0,1,0] as Vec3)},height=distances.at(-1)!,marker=curvedSectionMarker(line,30,direction,[0,0,0],100,distances,height*2,25);
  expect(marker).toHaveLength(2);
  const anchor=[50,(height-distances[30])*2],area=(marker[1][0]-marker[0][0])*(anchor[1]-marker[0][1])-(marker[1][1]-marker[0][1])*(anchor[0]-marker[0][0]);
  expect(Math.abs(area)).toBeLessThan(1e-9);
});

test('rendered curved marker stays straight and follows the local orthogonal frame through rotation',async({page,request})=>{
  test.setTimeout(180000);const data=await (await request.get('/api/case')).json(),f=data.vessels.LAD,index=30,points=f.points as Vec3[];
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByRole('button',{name:'Export',exact:true})).toBeEnabled({timeout:90000});
  const curved=page.getByLabel('Curved CPR',{exact:true}),crossImage=await page.locator('.cross canvas').evaluate((el:HTMLCanvasElement)=>el.toDataURL());
  const axis=norm(sub(points.at(-1)!,points[0])),u=norm(sub(f.u[0],axis.map(x=>x*dot(f.u[0],axis)))),v=cross(axis,u),center=points[0].map((_,j)=>points.reduce((sum,p)=>sum+p[j],0)/points.length) as Vec3;
  const width=25+2*Math.max(...points.map(p=>Math.hypot(...cross(sub(p,center),axis))));let initialLine='';
  // Integer mouse pixels give 0.6° steps; 244.2° is displayed as 244°.
  const angles=[0,90,180,244.2,270];
  for(let step=0;step<angles.length;step++){
    if(step){const box=(await curved.boundingBox())!;await page.mouse.move(box.x+30,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+30+(angles[step]-angles[step-1])/.6,box.y+box.height*.4,{steps:5});await page.mouse.up();}
    await expect(page.getByLabel('CPR rotation')).toHaveText(`${Math.round(angles[step])}°`);
    const a=angles[step]*Math.PI/180,d=u.map((x,j)=>x*Math.cos(a)+v[j]*Math.sin(a)) as Vec3,distances=[0];
    for(let i=1;i<points.length;i++)distances.push(distances[i-1]+Math.max(1e-6,Math.hypot(...cross(sub(points[i],points[i-1]),d))));
    const height=distances.at(-1)!,dataset=await page.locator('.cpr-render').evaluate(el=>({...((el as HTMLElement).dataset)})),line=curved.locator('.position-marker polyline'),raw=(await line.getAttribute('points'))!;
    if(step===0)initialLine=raw;else expect(raw).not.toBe(initialLine);
    const vertices=raw.split(' ').map(p=>p.split(',').map(Number)),normal=cross(f.u[index],f.v[index]);
    expect(vertices).toHaveLength(2);
    const model=vertices.map(([x,y])=>[width*(.5+(x-50)/Number(dataset.curvedWidth)),height*(.5+(50-y)/Number(dataset.curvedHeight))]);
    const dx=model[1][0]-model[0][0],dy=model[1][1]-model[0][1],normalDot=dot(normal,d),b=Math.hypot(...cross(normal,d));
    // Undo the display scale and reconstruct a displacement in the local ribbon.
    // Its direction must lie in the independent orthogonal plane through origin.
    const longitudinal=norm(normal.map((n,j)=>n-normalDot*d[j])),physical=d.map((q,j)=>dx*q-dy*longitudinal[j]);
    expect(Math.abs(dot(physical,normal))/Math.hypot(...physical)).toBeLessThan(.001);
    const marker=await curved.locator('.position-marker i').evaluate(el=>({x:parseFloat((el as HTMLElement).style.left),y:parseFloat((el as HTMLElement).style.top)}));
    // Fractional CSS grid sizes and integral WebGL backing sizes differ slightly.
    const box=(await curved.boundingBox())!;
    expect(Math.abs(marker.x-(50+dot(sub(points[index],center),d)/width*Number(dataset.curvedWidth)))*box.width/100).toBeLessThan(.25);
    expect(Math.abs(marker.y-(50+(distances[index]/height-.5)*Number(dataset.curvedHeight)))*box.height/100).toBeLessThan(.25);
    const screenDx=(vertices[1][0]-vertices[0][0])*box.width/100,screenDy=(vertices[1][1]-vertices[0][1])*box.height/100;
    const area=screenDx*(marker.y-vertices[0][1])*box.height/100-screenDy*(marker.x-vertices[0][0])*box.width/100;
    expect(Math.abs(area)/Math.hypot(screenDx,screenDy)).toBeLessThan(.01);expect(b).toBeGreaterThan(0);
    expect(await page.locator('.cross canvas').evaluate((el:HTMLCanvasElement)=>el.toDataURL())).toBe(crossImage);
    if(step===0||Math.round(angles[step])===244)await page.screenshot({path:`test-results/orthogonal-cpr-marker-${Math.round(angles[step])}.png`});
  }
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export',exact:true}).click();await (await download).saveAs('test-results/orthogonal-cpr-marker-export.png');
  expect(errors).toEqual([]);await expect(page.getByRole('alert')).toHaveCount(0);
});
