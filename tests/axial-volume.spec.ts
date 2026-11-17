import {test,expect} from '@playwright/test';
import {AxialVolume} from '../src/axialVolume';

test('resident slices share CT memory and decode each vessel mask independently',()=>{
  const ct=new Int16Array([-1024,0,42,100,300,400,500,600,700,800,900,1000]),labels=new Uint8Array([1,2,4,8,3,5,9,14,0,6,10,12]),volume=new AxialVolume([2,2,3],ct,labels);
  const lad=volume.slice(1,'LAD'),lcx=volume.slice(1,'LCx'),rca=volume.slice(1,'RCA');
  expect(lad.ct.buffer).toBe(ct.buffer);expect(Array.from(lad.ct)).toEqual([300,400,500,600]);
  expect(Array.from(lad.lumen)).toEqual([1,1,1,0]);expect(Array.from(lad.cpe)).toEqual([1,0,0,1]);
  expect(Array.from(lcx.cpe)).toEqual([0,1,0,1]);expect(Array.from(rca.cpe)).toEqual([0,0,1,1]);
  expect(()=>volume.slice(-1,'LAD')).toThrow();expect(()=>volume.slice(3,'LAD')).toThrow();
  const floats=new Float32Array([.125,-.75,1.25,3.5]);expect(Array.from(new AxialVolume([2,1,2],floats,new Uint8Array(4)).slice(0,'LAD').ct)).toEqual([.125,-.75]);
});

test('axial navigation remains resident with no network requests or loading frames',async({page,request})=>{
  test.setTimeout(180000);const data=await (await request.get('/api/case')).json(),errors:string[]=[],requests:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(r.url());});
  await page.goto('/viewer/1718');await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:120000});
  const info=data.featureMaps.LAD[0];if(info){await page.getByLabel('Radiomic feature map',{exact:true}).selectOption(info.id);await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:60000});}
  const before=requests.length,canvas=page.locator('.axial canvas'),navigation=page.getByRole('group',{name:'Axial slice navigation'}),start=Number(await canvas.getAttribute('data-slice-index'));
  // Once initial data and the selected map are loaded, disallow every API call.
  await page.route('**/api/**',route=>route.abort());
  await page.evaluate(()=>{
    (window as any).axialLoadingFrames=0;
    const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof Element&&(node.matches('.loading')||node.querySelector('.loading')))(window as any).axialLoadingFrames++;});
    observer.observe(document.querySelector('.axial')!,{childList:true,subtree:true});
  });
  for(let i=1;i<=24;i++){await navigation.press('ArrowUp');await expect(canvas).toHaveAttribute('data-slice-index',String(start-i));}
  // Beyond the old 16-slice cache and far outside the CPR crop, including repeats.
  await navigation.press('Home');await expect(canvas).toHaveAttribute('data-slice-index','0');
  await navigation.press('End');await expect(canvas).toHaveAttribute('data-slice-index',String(data.geometry.shape[2]-1));
  await navigation.press('Home');await expect(canvas).toHaveAttribute('data-slice-index','0');
  await expect(page.locator('.axial .loading')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).axialLoadingFrames)).toBe(0);expect(requests.slice(before)).toEqual([]);
  expect(errors).toEqual([]);await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({path:'test-results/resident-axial-navigation.png'});
});
