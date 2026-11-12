import {test,expect,type Route} from '@playwright/test';

test('first 3D vessel selections and remembered maps do not fetch or flash Loading',async({page,request})=>{
  test.setTimeout(240000);const data=await (await request.get('/api/case')).json(),errors:string[]=[],requests:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(r.url().includes('/api/'))requests.push(r.url());});
  // Reproduce the documented default anterior camera from the rendered meshes.
  const bounds=[Infinity,-Infinity,Infinity,-Infinity,Infinity,-Infinity];
  for(const key of ['lumen_merged','cpe_LAD','cpe_LCx','cpe_RCA','ascending_aorta']){
    const surface=data.surfaces[key];if(!surface)continue;
    const buffer=await (await request.get(surface.smoothPoints??surface.points)).body(),values=new Float32Array(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
    for(let i=0;i<values.length;i++) {const axis=i%3;bounds[axis*2]=Math.min(bounds[axis*2],values[i]);bounds[axis*2+1]=Math.max(bounds[axis*2+1],values[i]);}
  }
  await page.goto('/');const exportButton=page.getByRole('button',{name:'Export',exact:true});await expect(exportButton).toBeEnabled({timeout:120000});
  // Isolate the visible, pickable centreline geometry for deterministic 3D picks.
  await page.getByText('Layers',{exact:true}).click();await page.getByRole('checkbox',{name:'Lumen',exact:true}).uncheck();
  if(data.surfaces.ascending_aorta)await page.getByRole('checkbox',{name:'Ascending aorta',exact:true}).uncheck();
  await page.getByText('Layers',{exact:true}).click();await page.getByRole('button',{name:'CPE masks',exact:true}).click();
  const scene=page.locator('.scene'),rect=(await scene.boundingBox())!,scale=Math.max((bounds[5]-bounds[4])/2,(bounds[1]-bounds[0])/(2*rect.width/rect.height))*1.12,ppm=rect.height/(2*scale),cx=(bounds[0]+bounds[1])/2,cz=(bounds[4]+bounds[5])/2;
  const projected=Object.fromEntries(Object.entries(data.vessels).map(([name,line]:[string,any])=>[name,line.points.map((p:number[])=>[rect.width/2+(p[0]-cx)*ppm,rect.height/2-(p[2]-cz)*ppm])])) as Record<string,number[][]>;
  const pick=async(vessel:string)=>{
    const others=Object.entries(projected).filter(([name])=>name!==vessel).flatMap(([,points])=>points);let best:number[]|undefined,score=-Infinity;
    for(const point of projected[vessel].slice(3,-3)){
      const [x,y]=point;if(x<15||x>rect.width-15||y<30||y>rect.height-90)continue;
      const distance=Math.min(...others.map(q=>Math.hypot(q[0]-x,q[1]-y)));if(distance>score){score=distance;best=point;}
    }
    expect(best).toBeDefined();await scene.click({position:{x:best![0],y:best![1]}});await expect(page.getByLabel('Vessel',{exact:true})).toHaveValue(vessel);await expect(exportButton).toBeEnabled();
  };
  await page.evaluate(()=>{
    (window as any).loadingFlashes=0;const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof Element&&(node.matches('.loading,.map-loading')||node.querySelector('.loading,.map-loading')))(window as any).loadingFlashes++;});
    observer.observe(document.querySelector('main')!,{childList:true,subtree:true});
  });
  const block=(route:Route)=>route.abort();await page.route('**/api/**',block);let before=requests.length;
  for(const vessel of ['RCA','LCx','LAD','RCA'])await pick(vessel);
  expect(requests.slice(before)).toEqual([]);expect(await page.evaluate(()=>(window as any).loadingFlashes)).toBe(0);
  // Load one map per vessel once, then restore those exact maps without a request.
  await page.unroute('**/api/**',block);
  for(const vessel of ['RCA','LCx','LAD']){
    await page.getByLabel('Vessel',{exact:true}).selectOption(vessel);const map=data.featureMaps[vessel][0];
    if(map){await page.getByLabel('Radiomic feature map',{exact:true}).selectOption(map.id);await expect(exportButton).toBeEnabled({timeout:60000});}
  }
  await page.evaluate(()=>{(window as any).loadingFlashes=0;});before=requests.length;await page.route('**/api/**',block);
  for(const vessel of ['RCA','LCx','LAD','RCA']){
    await pick(vessel);const map=data.featureMaps[vessel][0];if(map){await expect(page.getByLabel('Radiomic feature map',{exact:true})).toHaveValue(map.id);await expect(page.getByLabel('Feature color scale')).toBeVisible();}
  }
  expect(requests.slice(before)).toEqual([]);expect(await page.evaluate(()=>(window as any).loadingFlashes)).toBe(0);
  await expect(page.locator('.loading,.map-loading')).toHaveCount(0);await expect(page.getByRole('alert')).toHaveCount(0);expect(errors).toEqual([]);
  await page.screenshot({path:'test-results/resident-vessel-switching.png'});
});
