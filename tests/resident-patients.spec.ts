import {test,expect} from '@playwright/test';
import {residentPhantoms} from './helpers/residentPhantom';

const active='.resident-viewer.is-active';
test('three loaded patients reuse their data, canvases and 3D textures when reopened',async({page})=>{
  const {requests}=await residentPhantoms(page),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const getContext=HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as any).getContext=function(...args:any[]){
      const context=(getContext as any).apply(this,args);
      if(args[0]==='webgl2'&&context&&!this.dataset.contextId){
        const state=(window as any).glStats??=((window as any).glStats={next:0,uploads:0,draws:{}});
        this.dataset.contextId=String(++state.next);const id=this.dataset.contextId;
        const upload=context.texImage3D;context.texImage3D=function(...values:any[]){state.uploads++;return upload.apply(this,values);};
        for(const name of ['drawArrays','drawElements']){const draw=context[name];context[name]=function(...values:any[]){state.draws[id]=(state.draws[id]??0)+1;return draw.apply(this,values);};}
      }
      return context;
    };
  });
  await page.goto('/');
  const open=async(id:string)=>{
    await page.getByRole('link',{name:`Open patient ${id}`,exact:true}).click();
    await expect(page.locator(`${active} main`)).toHaveAttribute('aria-busy','false');
    await expect(page.locator(active)).toHaveAttribute('data-ready','true');
    const cpes=page.locator(active).getByRole('button',{name:'Show periluminal envelopes',exact:true});
    if(await cpes.getAttribute('aria-pressed')==='false')await cpes.click();
    await expect(page.locator(`${active} .scene`)).toHaveAttribute('data-volume-ready','true');
  };
  const back=()=>page.getByRole('link',{name:'Home',exact:true}).click();
  await open('96');
  await page.locator(active).getByRole('button',{name:'Show radiomic maps',exact:true}).click();
  await page.locator(active).getByLabel('Radiomic feature map',{exact:true}).selectOption('feature-96');
  await expect(page.getByText('Loading map…')).toHaveCount(0);
  const cross=page.getByRole('group',{name:'Orthogonal slice navigation',exact:true});await cross.press('ArrowUp');
  const initial=await page.locator(`${active} .cross canvas`).evaluate(canvas=>(canvas as HTMLCanvasElement).toDataURL());
  const contexts=await page.locator(`${active} canvas[data-context-id]`).evaluateAll(canvases=>canvases.map(canvas=>(canvas as HTMLElement).dataset.contextId));
  await back();await expect(page.locator('canvas:visible')).toHaveCount(0);
  await open('814');await back();await open('893');await back();
  await expect(page.locator('.patient-ready')).toHaveCount(3);
  const baseline=requests.length,uploads=await page.evaluate(()=>(window as any).glStats.uploads),times:number[]=[];
  for(const id of ['96','814','893','96']){
    const start=Date.now();await open(id);times.push(Date.now()-start);
    await expect(page.locator(`${active} .initial-loader`)).toHaveCount(0);
    if(id==='96'){
      await expect(page.locator(active).getByLabel('Radiomic feature map',{exact:true})).toHaveValue('feature-96');
      expect(await page.locator(`${active} .cross canvas`).evaluate(canvas=>(canvas as HTMLCanvasElement).toDataURL())).toBe(initial);
      expect(await page.locator(`${active} canvas[data-context-id]`).evaluateAll(canvases=>canvases.map(canvas=>(canvas as HTMLElement).dataset.contextId))).toEqual(contexts);
    }
    await back();
  }
  expect(requests.slice(baseline).filter(path=>path.startsWith('/api/cases/'))).toEqual([]);
  expect(await page.evaluate(()=>(window as any).glStats.uploads)).toBe(uploads);
  const draws=await page.evaluate(()=>(window as any).glStats.draws);
  await page.setViewportSize({width:1400,height:900});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await page.evaluate(()=>(window as any).glStats.draws)).toEqual(draws);
  await open('96');await expect(page.locator(`${active} canvas[data-context-id]`)).toHaveCount(2);
  console.log('Warm switch times (ms, synthetic volumes):',times);
  await back();await open('fourth');await back();
  await expect(page.locator('.resident-viewer')).toHaveCount(3);
  await expect(page.locator('.resident-viewer[data-patient-id="814"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('leaving an unfinished case cancels it rather than keeping partial data resident',async({page})=>{
  await residentPhantoms(page);
  let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/cases/96/assets/ct',async route=>{await held;await route.fallback().catch(()=>{});});
  await page.goto('/viewer/96');await expect(page.getByRole('progressbar')).toBeVisible();
  await page.getByRole('link',{name:'Home',exact:true}).click();
  await expect(page.locator('.resident-viewer')).toHaveCount(0);release();
  await expect(page.getByRole('heading',{name:'Patients',exact:true})).toBeVisible();
});


test('patient tabs switch warm sessions and close only the selected patient',async({page})=>{
  const {requests}=await residentPhantoms(page);
  const navigation=page.getByRole('navigation',{name:'Open patients'});
  await page.goto('/');
  await expect(navigation.getByRole('link',{name:'Home',exact:true})).toHaveAttribute('aria-current','page');
  await page.getByRole('link',{name:'Open patient 96',exact:true}).click();
  await expect(page.locator(active)).toHaveAttribute('data-ready','true');
  await page.getByLabel('Vessel',{exact:true}).selectOption('RCA');
  await page.locator(`${active} .scene canvas`).evaluate(canvas=>(window as any).firstPatientCanvas=canvas);
  await navigation.getByRole('link',{name:'Home',exact:true}).click();
  await page.getByRole('link',{name:'Open patient 814',exact:true}).click();
  await expect(page.locator(active)).toHaveAttribute('data-ready','true');
  const count=requests.length;
  await navigation.getByRole('link',{name:'Patient 96',exact:true}).click();
  await expect(page.locator(active).getByLabel('Vessel',{exact:true})).toHaveValue('RCA');
  expect(await page.locator(`${active} .scene canvas`).evaluate(canvas=>canvas===(window as any).firstPatientCanvas)).toBe(true);
  expect(requests.slice(count).filter(path=>path.startsWith('/api/cases/'))).toEqual([]);
  await expect(navigation.getByRole('link',{name:'Patient 96',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page.getByRole('button',{name:'Show AI report',exact:true})).toHaveCount(1);
  await page.getByLabel('Layers',{exact:true}).click();await expect(page.getByLabel('Window width',{exact:true})).toBeVisible();
  await page.getByLabel('Layers',{exact:true}).click();
  await page.screenshot({path:'test-results/patient-tabs.png'});
  // Closing a background tab does not navigate or disturb the active canvas.
  await navigation.getByRole('button',{name:'Close patient 814',exact:true}).click();
  await expect(page).toHaveURL(/\/viewer\/96$/);
  await expect(page.locator('.resident-viewer[data-patient-id="814"]')).toHaveCount(0);
  await expect(navigation.getByRole('link',{name:'Patient 814',exact:true})).toHaveCount(0);
  // The active tab closes to its neighbour, and the final tab closes to Home.
  await navigation.getByRole('link',{name:'Home',exact:true}).click();
  await page.getByRole('link',{name:'Open patient 893',exact:true}).click();
  await expect(page.locator(active)).toHaveAttribute('data-ready','true');
  await navigation.getByRole('button',{name:'Close patient 893',exact:true}).click();
  await expect(page).toHaveURL(/\/viewer\/96$/);
  await navigation.getByRole('button',{name:'Close patient 96',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Patients',exact:true})).toBeVisible();
  await expect(page.locator('.resident-viewer')).toHaveCount(0);
  await expect(navigation.getByRole('link')).toHaveCount(1);
  // Browser history can reopen a closed patient as a fresh session.
  await page.goBack();
  await expect(page.locator(active)).toHaveAttribute('data-ready','true');
  await expect(navigation.getByRole('link',{name:'Patient 96',exact:true})).toHaveAttribute('aria-current','page');
});
