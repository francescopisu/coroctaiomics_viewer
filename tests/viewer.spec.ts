import {test,expect} from '@playwright/test';

test('five linked views: GPU curved CPR rotates and navigation stays synchronized',async({page})=>{
  test.setTimeout(180000);
  const errors:string[]=[];page.on('pageerror',e=>{errors.push(e.message);console.log('Browser error:',e.message);});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('Render error:',m.text());}});
  await page.goto('/viewer/1718');await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:90000});
  await expect(page.locator('canvas')).toHaveCount(4);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const matchingHeights=async()=>{
    const heights=await page.locator('.cpr-render').evaluate(el=>[Number((el as HTMLElement).dataset.straightHeight),Number((el as HTMLElement).dataset.curvedHeight)]);
    expect(heights[0]).toBeGreaterThan(0);expect(Math.abs(heights[0]-heights[1])).toBeLessThan(.001);
    const widths=await page.locator('.cpr-render').evaluate(el=>[Number((el as HTMLElement).dataset.straightWidth),Number((el as HTMLElement).dataset.curvedWidth)]);
    expect(widths[0]).toBeGreaterThan(0);expect(Math.abs(widths[0]-widths[1])).toBeLessThan(.001);
  };
  await matchingHeights();expect(await page.locator('.cross canvas').evaluate((el:HTMLCanvasElement)=>el.width)).toBe(1024);
  await page.screenshot({path:'test-results/five-views-initial.png'});
  await page.getByLabel('Layers',{exact:true}).click();
  await page.getByRole('checkbox',{name:'3D plane',exact:true}).check();
  await page.getByLabel('Layers',{exact:true}).click();
  const curved=page.getByLabel('Curved CPR',{exact:true}),position=page.getByRole('group',{name:'Orthogonal slice navigation'}),currentIndex=()=>page.locator('.cross canvas').getAttribute('data-centreline-index');
  const before=await curved.screenshot({style:'.angle,.position-marker{visibility:hidden}'});const crossBefore=await page.locator('.cross canvas').evaluate((el:HTMLCanvasElement)=>el.toDataURL());
  const straightBefore=await page.getByLabel('Straightened reconstruction',{exact:true}).screenshot();
  const axialBefore=await page.locator('.axial canvas').evaluate((el:HTMLCanvasElement)=>el.toDataURL());
  const sceneBefore=await page.locator('.scene').screenshot();
  const box=await curved.boundingBox();expect(box).not.toBeNull();
  await page.mouse.move(box!.x+box!.width/2-40,box!.y+box!.height/2);await page.mouse.down();
  await page.mouse.move(box!.x+box!.width/2+60,box!.y+box!.height/2,{steps:5});await page.mouse.up();
  await expect(page.getByLabel('CPR rotation')).toHaveText('60°');
  expect(await currentIndex()).toBe('30');
  const after=await curved.screenshot({style:'.angle,.position-marker{visibility:hidden}'});expect(after.equals(before)).toBe(false);await matchingHeights();
  expect(await page.locator('.cross canvas').evaluate((el:HTMLCanvasElement)=>el.toDataURL())).toBe(crossBefore);
  expect((await page.getByLabel('Straightened reconstruction',{exact:true}).screenshot()).equals(straightBefore)).toBe(true);
  expect(await page.locator('.axial canvas').evaluate((el:HTMLCanvasElement)=>el.toDataURL())).toBe(axialBefore);
  expect((await page.locator('.scene').screenshot()).equals(sceneBefore)).toBe(true);
  await page.screenshot({path:'test-results/five-views-rotated.png'});
  const straight=page.getByLabel('Straightened reconstruction',{exact:true}),sbox=await straight.boundingBox();
  const straightImageBefore=await straight.screenshot({style:'.angle,.position-marker{visibility:hidden}'});
  const curvedAfterRotation=await curved.screenshot();
  // Horizontal straightened rotation must not select the row where the drag starts.
  await page.mouse.move(sbox!.x+sbox!.width/2-40,sbox!.y+sbox!.height*.4);await page.mouse.down();
  await page.mouse.move(sbox!.x+sbox!.width/2+40,sbox!.y+sbox!.height*.4+2,{steps:5});await page.mouse.up();
  await expect(page.getByLabel('Straightened rotation')).toHaveText('48°');
  await expect(page.getByLabel('CPR rotation')).toHaveText('60°');expect(await currentIndex()).toBe('30');
  expect((await straight.screenshot({style:'.angle,.position-marker{visibility:hidden}'})).equals(straightImageBefore)).toBe(false);
  expect((await curved.screenshot()).equals(curvedAfterRotation)).toBe(true);
  expect(await page.locator('.cross canvas').evaluate((el:HTMLCanvasElement)=>el.toDataURL())).toBe(crossBefore);
  expect(await page.locator('.axial canvas').evaluate((el:HTMLCanvasElement)=>el.toDataURL())).toBe(axialBefore);
  expect((await page.locator('.scene').screenshot()).equals(sceneBefore)).toBe(true);await matchingHeights();
  await page.screenshot({path:'test-results/five-views-independent-rotations.png'});
  const oldAxial=await page.locator('.axial canvas').evaluate((el:HTMLCanvasElement)=>el.toDataURL());
  const oldCross=await page.locator('.cross canvas').evaluate((el:HTMLCanvasElement)=>el.toDataURL());
  await page.mouse.move(sbox!.x+sbox!.width/2,sbox!.y+sbox!.height*.4);await page.mouse.down();
  await page.mouse.move(sbox!.x+sbox!.width/2+2,sbox!.y+sbox!.height*.7,{steps:5});await page.mouse.up();
  await expect.poll(currentIndex).not.toBe('30');
  await expect(page.getByLabel('Straightened rotation')).toHaveText('48°');await expect(page.getByLabel('CPR rotation')).toHaveText('60°');
  await expect.poll(()=>page.locator('.cross canvas').evaluate((el:HTMLCanvasElement)=>el.toDataURL())).not.toBe(oldCross);
  await expect.poll(()=>page.locator('.axial canvas').evaluate((el:HTMLCanvasElement)=>el.toDataURL())).not.toBe(oldAxial);
  for(const vessel of ['LCx','RCA','LAD']){
    console.log('Loading',vessel);await page.getByLabel('Vessel',{exact:true}).selectOption(vessel);
    await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:90000});
    await expect(page.getByLabel('Straightened rotation')).toHaveText('0°');await expect(page.getByLabel('CPR rotation')).toHaveText('0°');
    await matchingHeights();
    await position.focus();await position.press('Home');for(let i=0;i<20;i++)await position.press('ArrowDown');
    await expect(page.locator('.cross canvas')).toHaveAttribute('data-distance-mm','10');
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await page.getByLabel('Layers',{exact:true}).click();
  for(const name of ['Lumen','Centerlines','LAD CPE','LCx CPE','RCA CPE','CCTA','3D plane']){
    const control=page.getByRole('checkbox',{name,exact:true});const value=await control.isChecked();await control.setChecked(!value);await control.setChecked(value);
  }
  await page.getByRole('slider',{name:'CPE opacity',exact:true}).focus();await page.getByRole('slider',{name:'CPE opacity',exact:true}).press('ArrowRight');
  await page.getByLabel('Layers',{exact:true}).click();
  await page.getByLabel('Layers',{exact:true}).click();
  await page.getByRole('spinbutton',{name:'Window level',exact:true}).fill('300');
  await page.getByLabel('Layers',{exact:true}).click();
  await page.getByRole('button',{name:'Reset',exact:true}).click();await expect(page.getByLabel('CPR rotation')).toHaveText('0°');
  await expect(page.getByLabel('Straightened rotation')).toHaveText('0°');
  await expect.poll(()=>page.locator('.axial canvas').evaluate((el:HTMLCanvasElement)=>el.width)).toBe(600);
  await page.screenshot({path:'test-results/five-views-final.png'});
  expect(errors).toEqual([]);await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.locator('main').innerText()).not.toMatch(/geometry verified|radiomic|Nominal|CPE present|LPS|workspace/);
});

test('read-only case and native axial endpoint reject unlisted data',async({request})=>{
  const current=await request.get('/api/case');expect(current.status()).toBe(200);expect(current.headers()['cache-control']).toBe('no-store');
  const manifest=await current.json(),base=`/api/cases/${manifest.patientId}`,[width,height,depth]=manifest.geometry.shape;
  expect((await request.get('/api/cases/unlisted-case')).status()).toBe(404);
  expect((await request.get(`${base}/assets/axial.ct.npy`)).status()).toBe(404);
  expect((await request.get(`${base}/axial/-1`)).status()).toBe(404);
  expect((await request.get(`${base}/axial/${depth}`)).status()).toBe(404);
  expect((await request.post(base)).status()).toBe(405);
  const slice=await request.get(`${base}/axial/${Math.floor(depth/2)}`);expect(slice.status()).toBe(200);expect((await slice.body()).length).toBe(width*height*5);
  expect(JSON.stringify(manifest)).not.toContain('/Volumes/');
  for(const volume of Object.values(manifest.volumes) as {ct:string}[])expect(volume.ct).toContain(`${base}/assets/`);
});
