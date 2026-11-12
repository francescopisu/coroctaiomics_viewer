import {test,expect} from '@playwright/test';
import {cprLayout} from '../src/cprLayout';
import {screenSectionMarker} from '../src/curvedMarker';
import {type Vec3} from '../src/types';

test('full rotation envelope and marker have fixed padding and CSS length',()=>{
  const points=Array.from({length:81},(_,i)=>[20*Math.sin(i*.08),12*Math.cos(i*.15),i] as Vec3),distances=[0];
  for(let i=1;i<points.length;i++)distances.push(distances[i-1]+Math.hypot(...points[i].map((x,j)=>x-points[i-1][j])));
  for(const size of [[180,450],[267,947],[465,597]] as [number,number][]){
    const layout=cprLayout({points,distances},size,25),ppm=size[1]/(2*layout.parallelScale);
    expect(size[1]/2-layout.displayHeight/2*ppm).toBeGreaterThanOrEqual(layout.padding-1e-8);
    for(let angle=0;angle<360;angle+=5){
      const a=angle*Math.PI/180,marker=screenSectionMarker([50,50],[[50,50],[50+Math.cos(a),50+Math.sin(a)]],size,layout.markerLength);
      expect(Math.hypot((marker[1][0]-marker[0][0])*size[0]/100,(marker[1][1]-marker[0][1])*size[1]/100)).toBeCloseTo(layout.markerLength,8);
    }
  }
});

for(const dpr of [1,2])test.describe(`RCA framing at device scale ${dpr}`,()=>{
  test.use({deviceScaleFactor:dpr,...(dpr===2?{viewport:{width:2200,height:750}}:{})});
test('RCA framing and marker lengths across rotation',async({page,request})=>{
  const data=await (await request.get('/api/case')).json(),f=data.vessels.RCA,points=f.points as Vec3[];
  const dot=(a:number[],b:number[])=>a.reduce((s,x,i)=>s+x*b[i],0),sub=(a:number[],b:number[])=>a.map((x,i)=>x-b[i]),norm=(a:number[])=>a.map(x=>x/Math.hypot(...a)),cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const axis=norm(sub(points.at(-1)!,points[0])),u=norm(sub(f.u[0],axis.map(x=>x*dot(f.u[0],axis)))),v=cross(axis,u),center=points[0].map((_,i)=>points.reduce((s,p)=>s+p[i],0)/points.length),width=25+2*Math.max(...points.map(p=>Math.hypot(...cross(sub(p,center),axis))));
  test.setTimeout(180000);await page.goto('/');await expect(page.getByRole('button',{name:'Export',exact:true})).toBeEnabled({timeout:90000});
  await page.getByLabel('Vessel',{exact:true}).selectOption('RCA');
  const navigation=page.getByRole('group',{name:'Orthogonal slice navigation'});await navigation.press('Home');for(let i=0;i<20;i++)await navigation.press('ArrowDown');
  const curved=page.getByLabel('Curved CPR',{exact:true});let previous=0,scale:string|undefined;
  for(const angle of [0,90,180,244.2,283.2]){
    if(angle!==previous){const box=(await curved.boundingBox())!;await page.mouse.move(box.x+25,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+25+(angle-previous)/.6,box.y+box.height*.4,{steps:6});await page.mouse.up();}
    previous=angle;await expect(page.getByLabel('CPR rotation')).toHaveText(`${Math.round(angle)}°`);
    const marker=await curved.locator('.position-marker polyline').evaluate(el=>{const points=el.getAttribute('points')!.split(' ').map(s=>s.split(',').map(Number)),box=el.closest('.cpr-hit')!.getBoundingClientRect();return {length:Math.hypot((points[1][0]-points[0][0])*box.width/100,(points[1][1]-points[0][1])*box.height/100),points};});
    const box=(await curved.boundingBox())!,expected=Math.min(96,box.width*.36,box.height*.36);expect(marker.length).toBeCloseTo(expected,2);expect(marker.points).toHaveLength(2);
    for(const p of marker.points){expect(p[0]).toBeGreaterThan(0);expect(p[0]).toBeLessThan(100);expect(p[1]).toBeGreaterThan(0);expect(p[1]).toBeLessThan(100);}
    const ds=await page.locator('.cpr-render').evaluate(el=>({...((el as HTMLElement).dataset)}));scale??=ds.curvedPixelsPerMm;expect(ds.curvedPixelsPerMm).toBe(scale);expect(ds.straightPixelsPerMm).toBe(scale);expect(ds.straightWidth).toBe(ds.curvedWidth);expect(ds.straightHeight).toBe(ds.curvedHeight);
    const a=angle*Math.PI/180,d=u.map((x,i)=>x*Math.cos(a)+v[i]*Math.sin(a)),distances=[0];
    for(let i=1;i<points.length;i++)distances.push(distances[i-1]+Math.hypot(...cross(sub(points[i],points[i-1]),d)));
    for(let i=0;i<points.length;i++){
      const x=(50+dot(sub(points[i],center),d)/width*Number(ds.curvedWidth))*box.width/100,y=(50+(distances[i]/distances.at(-1)!-.5)*Number(ds.curvedHeight))*box.height/100;
      expect(x).toBeGreaterThan(expected/2+7);expect(x).toBeLessThan(box.width-expected/2-7);expect(y).toBeGreaterThan(expected/2+7);expect(y).toBeLessThan(box.height-expected/2-7);
    }
    if(Math.round(angle)===283)await page.screenshot({path:`test-results/RCA-283-padded-dpr${dpr}.png`});
  }
});
});
