import {test,expect} from '@playwright/test';
import {packCpeVolume,setCpeMembership,volumeOpacityNodes} from '../src/cpeVolumeData';
import type {Case,Vec3} from '../src/types';
import {AxialVolume} from '../src/axialVolume';
import type {Page} from '@playwright/test';

async function installVolumePhantom(page:Page,emptyMask=false){
  const shape:Vec3=[64,32,64],spacing=.5,n=shape.reduce((a,b)=>a*b,1),ct=new Int16Array(n).fill(3000),labels=new Uint8Array(n),cpe=new Uint8Array(n),empty=new Uint8Array(n);
  const centers=[-9,-3,3,9],hu=[-100,0,100,900],bits=[2,2,4,8];
  for(let k=0;k<shape[2];k++)for(let j=0;j<shape[1];j++)for(let i=0;i<shape[0];i++){
    const x=i*spacing-16,y=j*spacing-8,z=k*spacing-16,p=i+shape[0]*(j+shape[1]*k);
    centers.forEach((center,index)=>{if(Math.abs(z)<=7&&(x-center)**2+y*y<=1.5**2){ct[p]=hu[index];labels[p]=bits[index];cpe[p]=1;}});
  }
  if(emptyMask){labels.fill(0);cpe.fill(0);}
  const affineLPS=[[spacing,0,0,-16],[0,spacing,0,-8],[0,0,spacing,-16],[0,0,0,1]],points=Array.from({length:33},(_,i)=>[-9,0,-8+i*.5]);
  const line={points,distances:points.map((_,i)=>i*.5),radii:points.map(()=>1),tangents:points.map(()=>[0,0,1]),u:points.map(()=>[1,0,0]),v:points.map(()=>[0,1,0])};
  const base='/api/volume-phantom/',volume={dimensions:shape,spacing:[spacing,spacing,spacing],origin:[-16,-8,-16],direction:[1,0,0,0,1,0,0,0,1],affineLPS,scalarType:'int16',ct:base+'ct',lumen:base+'empty',cpe:base+'cpe'};
  const vertices=new Float32Array([-12,-2,-8,12,-2,-8,12,2,-8,-12,2,-8,-12,-2,8,12,-2,8,12,2,8,-12,2,8]);
  const faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]],cells=new Uint32Array(faces.flatMap(f=>[3,...f]));
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/cases/volume-phantom')return route.fulfill({json:{patientId:'volume-phantom',geometry:{shape,affineLPS},sampling:{widthPixels:50,resolutionMm:.5,pointSpacingMm:.5},vessels:{LAD:line,LCx:line,RCA:line},volumes:{LAD:volume,LCx:volume,RCA:volume},featureMaps:{LAD:[],LCx:[],RCA:[]},surfaces:{lumen_merged:{points:base+'points',cells:base+'cells',vertices:8,triangles:12}},axialVolume:{ct:base+'ct',labels:base+'labels',scalarType:'int16'}}});
    const array=path.endsWith('/ct')?ct:path.endsWith('/labels')?labels:path.endsWith('/cpe')?cpe:path.endsWith('/points')?vertices:path.endsWith('/cells')?cells:empty;
    return route.fulfill({body:Buffer.from(array.buffer)});
  });
}

test('CPE packing preserves native HU and oblique geometry with separate, reversible support',async()=>{
  const shape:Vec3=[10,12,8],count=shape.reduce((a,b)=>a*b,1),ct=Float32Array.from({length:count},(_,i)=>i*.25-200),labels=new Uint8Array(count);
  const offset=(i:number,j:number,k:number)=>i+shape[0]*(j+shape[1]*k);
  labels[offset(1,3,4)]=2;labels[offset(8,10,6)]=4;labels[offset(5,6,3)]=10;
  labels[offset(2,3,4)]=3;labels[offset(3,3,4)]=8;ct[offset(3,3,4)]=NaN;
  const original=new Float32Array(ct),sourceLabels=new Uint8Array(labels),theta=.4;
  const affine=[[.4*Math.cos(theta),-.8*Math.sin(theta),0,15],[.4*Math.sin(theta),.8*Math.cos(theta),0,-180],[0,0,1.2,90],[0,0,0,1]];
  const packed=await packCpeVolume(new AxialVolume(shape,ct,labels),{shape,affineLPS:affine},new AbortController().signal);
  expect(packed.count).toBe(3);expect(packed.indices).toHaveLength(3);
  for(let n=0;n<packed.count;n++){
    const i=packed.indices[n]%packed.info.dimensions[0],j=Math.floor(packed.indices[n]/packed.info.dimensions[0])%packed.info.dimensions[1],k=Math.floor(packed.indices[n]/(packed.info.dimensions[0]*packed.info.dimensions[1]));
    const source=[i+packed.start[0],j+packed.start[1],k+packed.start[2]];
    expect(packed.values[packed.indices[n]*2]).toBe(ct[offset(...source as Vec3)]);
    const world=affine.slice(0,3).map(row=>row[3]+source.reduce((sum,v,c)=>sum+row[c]*v,0));
    const cropped=packed.info.affineLPS.slice(0,3).map(row=>row[3]+[i,j,k].reduce((sum,v,c)=>sum+row[c]*v,0));
    cropped.forEach((v,index)=>expect(v).toBeCloseTo(world[index],10));
  }
  const initial=new Float32Array(packed.values);expect(setCpeMembership(packed,4)).toBe(true);
  expect(packed.indices.filter(i=>packed.values[2*i+1]===1)).toHaveLength(1);
  expect(setCpeMembership(packed,0)).toBe(true);expect(packed.values.every(n=>n===0)).toBe(true);
  setCpeMembership(packed,14);expect(packed.values).toEqual(initial);expect(setCpeMembership(packed,14)).toBe(false);
  expect(ct).toEqual(original);expect(labels).toEqual(sourceLabels);
  const abort=new AbortController();abort.abort();await expect(packCpeVolume(new AxialVolume(shape,ct,labels),{shape,affineLPS:affine},abort.signal)).rejects.toMatchObject({name:'AbortError'});
  const midAbort=new AbortController(),largeShape:Vec3=[10,10,40],largeCt=new Int16Array(4000),largeLabels=new Uint8Array(4000).fill(2);
  const pending=packCpeVolume(new AxialVolume(largeShape,largeCt,largeLabels),{shape:largeShape,affineLPS:affine},midAbort.signal);midAbort.abort();
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
});

test('attenuation opacity controls suppress the requested HU bands without changing HU coordinates',()=>{
  const gains={fat:1,low:1,intermediate:1,high:1},base=volumeOpacityNodes('balanced',1,gains);
  expect(volumeOpacityNodes('balanced',0,gains).every(([,v])=>v===0)).toBe(true);
  const noFat=volumeOpacityNodes('balanced',1,{...gains,fat:0});
  expect(noFat.find(([x])=>x===-165)![1]).toBe(0);expect(noFat.find(([x])=>x===650)![1]).toBe(base.find(([x])=>x===650)![1]);
  expect(volumeOpacityNodes('fat',1,gains).find(([x])=>x===-165)![1]).toBeGreaterThan(base.find(([x])=>x===-165)![1]);
  expect(volumeOpacityNodes('dense',1,gains).find(([x])=>x===650)![1]).toBeGreaterThan(base.find(([x])=>x===650)![1]);
});

test('rendered phantom separates HU bands, excludes bright background and survives mask-range changes',async({page})=>{
  test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await installVolumePhantom(page);await page.goto('/viewer/volume-phantom');
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:60000});
  await page.getByLabel('Layers',{exact:true}).click();await page.getByRole('checkbox',{name:'Lumen',exact:true}).uncheck();await page.getByRole('checkbox',{name:'Centerlines',exact:true}).uncheck();await page.getByLabel('Layers',{exact:true}).click();
  const scene=page.locator('.scene');await expect(scene).toHaveAttribute('data-volume-ready','true');
  await page.getByLabel('CPE volume settings',{exact:true}).click();await page.getByLabel('Intermediate opacity',{exact:true}).focus();await page.getByLabel('Intermediate opacity',{exact:true}).press('Home');for(let i=0;i<20;i++)await page.getByLabel('Intermediate opacity',{exact:true}).press('ArrowRight');
  await page.getByLabel('CPE volume density',{exact:true}).focus();await page.getByLabel('CPE volume density',{exact:true}).press('End');await page.getByLabel('CPE volume settings',{exact:true}).click();
  const samples=async()=>{
    const shot=await scene.screenshot();return page.evaluate(async base64=>{
      const im=new Image();im.src=`data:image/png;base64,${base64}`;await im.decode();const canvas=document.createElement('canvas');canvas.width=im.width;canvas.height=im.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(im,0,0);
      const scale=Math.max(8,12/(im.width/im.height))*1.12,pixelsPerMm=im.height/(2*scale);
      return [-9,-6,-3,0,3,6,9].map(x=>Array.from(ctx.getImageData(Math.round(im.width/2+x*pixelsPerMm),Math.round(im.height/2),1,1).data).slice(0,3));
    },shot.toString('base64'));
  };
  const colors=await samples();console.log('CPE phantom colors:',colors);
  for(const gap of [1,3,5])expect(Math.max(...colors[gap])).toBeLessThan(35);
  expect(colors[0][0]).toBeGreaterThan(colors[0][2]*1.3);expect(colors[0][1]).toBeGreaterThan(colors[0][2]*1.15);
  expect(colors[2][0]).toBeGreaterThan(colors[2][1]*1.5);expect(colors[2][0]).toBeGreaterThan(colors[2][2]*1.3);
  expect(Math.min(...colors[6])).toBeGreaterThan(90);expect(Math.max(...colors[6])-Math.min(...colors[6])).toBeLessThan(50);
  await page.screenshot({path:'test-results/cpe-volume-phantom.png'});
  await page.getByLabel('Layers',{exact:true}).click();await page.getByRole('checkbox',{name:'RCA CPE',exact:true}).uncheck();await page.getByLabel('Layers',{exact:true}).click();
  const hidden=await samples();expect(Math.max(...hidden[6])).toBeLessThan(35);
  colors[0].forEach((value,i)=>expect(Math.abs(value-hidden[0][i])).toBeLessThan(4));
  await page.getByLabel('Layers',{exact:true}).click();await page.getByRole('checkbox',{name:'LAD CPE',exact:true}).uncheck();await page.getByRole('checkbox',{name:'LCx CPE',exact:true}).uncheck();await page.getByLabel('Layers',{exact:true}).click();
  for(const color of await samples())expect(Math.max(...color)).toBeLessThan(35);
  await page.getByLabel('Layers',{exact:true}).click();await page.getByRole('checkbox',{name:'LAD CPE',exact:true}).check();await page.getByRole('checkbox',{name:'LCx CPE',exact:true}).check();await page.getByLabel('Layers',{exact:true}).click();
  await page.getByLabel('Layers',{exact:true}).click();await page.getByRole('checkbox',{name:'RCA CPE',exact:true}).check();await page.getByLabel('Layers',{exact:true}).click();
  expect(Math.min(...(await samples())[6])).toBeGreaterThan(90);
  expect(errors).toEqual([]);
});

test('default Unlit CPE volume and compact menus preserve the linked reconstructions',async({page})=>{
  test.setTimeout(300000);const errors:string[]=[],requests:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/viewer/1718');await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:90000});
  const scene=page.locator('.scene'),shot=()=>scene.screenshot({style:'.render3d-controls,.volume-legend,.volume-status{visibility:hidden}'});
  await expect(scene).toHaveAttribute('data-volume-ready','true');await expect(scene).toHaveAttribute('data-render-mode','cpe');
  await expect(scene).toHaveAttribute('data-volume-lighting','unlit');await expect(scene).toHaveAttribute('data-volume-preset','balanced');
  expect(Number(await scene.getAttribute('data-volume-voxels'))).toBeGreaterThan(200000);
  await expect(page.getByRole('button',{name:'Export',exact:true})).toHaveCount(0);
  for(const name of ['3D rendering mode','CPE volume preset','CPE volume lighting','CPE volume cutaway'])await expect(page.getByLabel(name,{exact:true})).toHaveCount(0);
  await expect(page.getByText('Cut at section',{exact:true})).toHaveCount(0);
  const linked=await page.locator('.cross canvas,.axial canvas').evaluateAll(items=>items.map(el=>(el as HTMLCanvasElement).toDataURL()));
  const geometry=await page.locator('.recon').boundingBox();
  await page.evaluate(()=>{
    (window as any).volumeSliceDraws=0;
    document.querySelectorAll<HTMLCanvasElement>('.cross canvas,.axial canvas').forEach(canvas=>{
      const ctx=canvas.getContext('2d')!,draw=ctx.drawImage;
      (ctx as any).drawImage=function(...args:any[]){(window as any).volumeSliceDraws++;return (draw as any).apply(this,args);};
    });
  });
  page.on('request',r=>{if(r.url().includes('/api/'))requests.push(r.url());});
  await page.screenshot({path:'test-results/cpe-volume-default.png'});
  await page.getByLabel('CPE volume settings',{exact:true}).click();
  const settings=[['CPE volume density','.9'],['Fat range opacity','1.05'],['Low HU opacity','2'],['Intermediate opacity','0'],['High HU opacity','2'],['CPE anatomical context opacity','.15']];
  for(const [name,value] of settings)expect(Number(await page.getByLabel(name,{exact:true}).inputValue())).toBe(Number(value));
  await expect(page.locator('.volume-menu input')).toHaveCount(6);
  await page.screenshot({path:'test-results/cpe-volume-settings.png'});
  const initial=await shot();await page.getByLabel('CPE volume density',{exact:true}).focus();await page.getByLabel('CPE volume density',{exact:true}).press('Home');const empty=await shot();expect(empty.equals(initial)).toBe(false);
  await page.getByLabel('CPE volume density',{exact:true}).press('End');expect((await shot()).equals(empty)).toBe(false);
  const whole=await shot();await page.getByLabel('High HU opacity',{exact:true}).focus();await page.getByLabel('High HU opacity',{exact:true}).press('Home');expect((await shot()).equals(whole)).toBe(false);
  await page.getByLabel('CPE volume settings',{exact:true}).click();
  expect(await page.locator('.cross canvas,.axial canvas').evaluateAll(items=>items.map(el=>(el as HTMLCanvasElement).toDataURL()))).toEqual(linked);
  expect(await page.locator('.recon').boundingBox()).toEqual(geometry);expect(await page.evaluate(()=>(window as any).volumeSliceDraws)).toBe(0);
  await expect(page.locator('.initial-loader')).toHaveCount(0);expect(requests).toEqual([]);
  // The gear is anchored to the far right, and W/L live inside its menu.
  const gear=page.getByLabel('Layers',{exact:true}),header=await page.getByLabel('Viewer controls').boundingBox(),box=(await gear.boundingBox())!;
  expect(header!.x+header!.width-(box.x+box.width)).toBeLessThan(20);await expect(gear.locator('svg')).toBeVisible();
  await expect(page.getByLabel('Window width',{exact:true})).not.toBeVisible();await gear.click();
  await expect(page.locator('.layer-menu').getByLabel('Window width',{exact:true})).toHaveValue('800');
  await page.getByLabel('Window width',{exact:true}).fill('900');await page.getByLabel('Window level',{exact:true}).fill('300');
  expect(await page.locator('.cross canvas').evaluate((el:HTMLCanvasElement)=>el.toDataURL())).not.toBe(linked[0]);
  const menu=(await page.locator('.layer-menu').boundingBox())!;expect(menu.x+menu.width).toBeLessThanOrEqual(1500);
  await page.screenshot({path:'test-results/viewer-gear-menu.png'});await gear.click();
  await page.getByRole('button',{name:'← Patients',exact:true}).click();await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByRole('link',{name:'Open patient 8',exact:true}).click();await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:90000});
  await expect(page.locator('.scene')).toHaveAttribute('data-render-mode','cpe');await expect(page.locator('.scene')).toHaveAttribute('data-volume-lighting','unlit');
  await expect(page.locator('.scene')).toHaveAttribute('data-volume-voxels','140231');
  await page.screenshot({path:'test-results/cpe-volume-patient-8.png'});
  await page.getByRole('button',{name:'← Patients',exact:true}).click();await expect(page.locator('canvas')).toHaveCount(0);expect(errors).toEqual([]);
});

test('an empty CPE reports a recoverable inline error without blocking the viewer',async({page})=>{
  await installVolumePhantom(page,true);await page.goto('/viewer/volume-phantom');
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false');await expect(page.getByRole('alert')).toContainText('No finite CCTA voxels');
  await expect(page.locator('.scene')).toHaveAttribute('data-render-mode','anatomy');
  const original=await page.locator('.scene').screenshot({style:'.render3d-controls,.volume-status{visibility:hidden}'});
  await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('alert')).toContainText('No finite CCTA voxels');
  expect((await page.locator('.scene').screenshot({style:'.render3d-controls,.volume-status{visibility:hidden}'})).equals(original)).toBe(true);
  await expect(page.locator('.initial-loader')).toHaveCount(0);await expect(page.getByLabel('Layers',{exact:true})).toBeVisible();
});
