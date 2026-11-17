import {test,expect} from '@playwright/test';

test('3D loading stays dark before camera fitting, including viewport resizes',async({page})=>{
  test.setTimeout(120000);let release!:()=>void,releaseCase!:()=>void;const held=new Promise<void>(r=>{release=r;}),caseHeld=new Promise<void>(r=>{releaseCase=r;});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/api/cases/*/assets/*points.bin',async route=>{await held;await route.continue();});
  await page.route('**/api/cases/1718',async route=>{await caseHeld;await route.continue();});
  const scene=page.locator('.scene'),loading=page.locator('.overview .loading'),progress=page.getByRole('progressbar',{name:'Loading viewer',exact:true}),values=[0];
  await page.exposeFunction('recordInitialProgress',(n:number)=>values.push(n));
  const paint=()=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const checkDark=async()=>{
    await paint();const shot=await scene.screenshot({style:'.initial-loader{visibility:hidden}'});
    const bright=await page.evaluate(async base64=>{
      const im=new Image();im.src=`data:image/png;base64,${base64}`;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d')!;ctx.drawImage(im,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data;
      let bright=0;for(let i=0;i<pixels.length;i+=4)if((pixels[i]+pixels[i+1]+pixels[i+2])/3>80)bright++;
      return bright/(c.width*c.height);
    },shot.toString('base64'));
    expect(bright).toBeLessThan(.01);return shot;
  };
  let before:Buffer;
  try{
    await page.goto('/viewer/1718');await expect(progress).toHaveAttribute('aria-valuenow','0');await page.screenshot({path:'test-results/initial-progress-zero.png'});
    await page.evaluate(()=>{const bar=document.querySelector('[role=progressbar]')!;new MutationObserver(()=>{(window as any).recordInitialProgress(Number(bar.getAttribute('aria-valuenow')));}).observe(bar,{attributes:true,attributeFilter:['aria-valuenow']});});
    releaseCase();await expect(scene.locator('canvas')).toHaveCount(1);await expect(loading).toBeVisible();await checkDark();
    await expect.poll(async()=>Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThan(2);
    expect(Number(await progress.getAttribute('aria-valuenow'))).toBeLessThan(100);
    await page.setViewportSize({width:1350,height:900});before=await checkDark();await expect(loading).toBeVisible();
    await page.screenshot({path:'test-results/loading-dark.png'});
  }finally{releaseCase();release();}
  await expect(progress).toHaveCount(0,{timeout:90000});expect(values.at(-1)).toBe(100);expect(values.every((n,i)=>n>=0&&n<=100&&(!i||n>=values[i-1]))).toBe(true);
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:90000});await expect(loading).toHaveCount(0);
  expect((await scene.screenshot()).equals(before!)).toBe(false);await page.screenshot({path:'test-results/loading-complete.png'});
  await page.getByLabel('Vessel',{exact:true}).selectOption('RCA');await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:90000});await expect(progress).toHaveCount(0);expect(errors).toEqual([]);
});

test('a failed startup download exposes Reload without falsely completing the loader',async({page,request})=>{
  test.setTimeout(120000);const data=await (await request.get('/api/case')).json();let fail=true;
  await page.route(`**${data.axialVolume.ct}`,async route=>{if(fail){fail=false;await route.fulfill({status:503,body:'Unavailable'});}else await route.continue();});
  await page.goto('/viewer/1718');await expect(page.getByRole('alert')).toContainText('Case asset failed (503)');await expect(page.getByRole('progressbar',{name:'Loading viewer'})).toHaveCount(0);
  expect(await page.locator('main').evaluate(el=>el.inert)).toBe(false);
  await page.getByRole('button',{name:'Reload',exact:true}).click();await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:90000});await expect(page.getByRole('alert')).toHaveCount(0);
});
