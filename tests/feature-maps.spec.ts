import {test,expect} from '@playwright/test';

test('vessel-specific radiomic maps overlay both CPRs and linked CCTA slices',async({page,request})=>{
  test.setTimeout(300000);const manifest=await (await request.get('/api/case')).json();
  test.skip(!Object.values(manifest.featureMaps??{}).some((f:any)=>f.length),'No configured maps');
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/viewer/1718');const selector=page.getByLabel('Radiomic feature map',{exact:true}),viewer=page.locator('main');
  await expect(viewer).toHaveAttribute('aria-busy','false',{timeout:90000});
  for(const vessel of ['LAD','LCx','RCA']){
    await page.getByLabel('Vessel',{exact:true}).selectOption(vessel);await expect(viewer).toHaveAttribute('aria-busy','false',{timeout:90000});
    const maps=manifest.featureMaps[vessel];await expect(selector.locator('option')).toHaveCount(maps.length+1);
    expect(await selector.locator('option').allTextContents()).toEqual(['No feature map',...maps.map((f:any)=>f.name)]);
    if(!maps.length)continue;
    const position=page.getByRole('group',{name:'Orthogonal slice navigation'});await position.focus();await position.press('Home');for(let i=0;i<20;i++)await position.press('ArrowDown');await expect(viewer).toHaveAttribute('aria-busy','false',{timeout:90000});
    const cross=await page.locator('.cross canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL()),axial=await page.locator('.axial canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL());
    const recon=await page.getByLabel('Coronary reconstructions',{exact:true}).screenshot();
    await selector.selectOption(maps[0].id);await expect(viewer).toHaveAttribute('aria-busy','false',{timeout:60000});await expect(page.getByLabel('Feature color scale')).toBeVisible();
    expect(await page.locator('.cross canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).not.toBe(cross);
    expect(await page.locator('.axial canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).not.toBe(axial);
    expect((await page.getByLabel('Coronary reconstructions',{exact:true}).screenshot()).equals(recon)).toBe(false);
    await page.screenshot({path:`test-results/radiomic-map-${vessel}.png`});
    if(vessel==='RCA'){
      const crossMapped=await page.locator('.cross canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL()),axialMapped=await page.locator('.axial canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL());
      for(const name of ['Straightened reconstruction','Curved CPR']){
        const view=page.getByLabel(name,{exact:true}),before=await view.screenshot({style:'.angle,.position-marker{visibility:hidden}'}),box=(await view.boundingBox())!;
        await page.mouse.move(box.x+box.width/2-35,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width/2+35,box.y+box.height*.4,{steps:4});await page.mouse.up();
        expect((await view.screenshot({style:'.angle,.position-marker{visibility:hidden}'})).equals(before)).toBe(false);
        expect(await page.locator('.cross canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(crossMapped);
        expect(await page.locator('.axial canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(axialMapped);
      }
      await page.getByLabel('Layers',{exact:true}).click();const opacity=page.getByRole('slider',{name:'Feature map opacity',exact:true});await opacity.focus();await opacity.press('Home');
      expect(await page.locator('.cross canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).not.toBe(crossMapped);
      await opacity.press('End');await page.getByLabel('Layers',{exact:true}).click();
    }
    await selector.selectOption('');await expect(viewer).toHaveAttribute('aria-busy','false');await expect(page.getByLabel('Feature color scale')).toHaveCount(0);
    expect(await page.locator('.cross canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(cross);
    expect(await page.locator('.axial canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(axial);
  }
  await expect(page.getByRole('alert')).toHaveCount(0);expect(errors).toEqual([]);
  const feature=manifest.featureMaps.RCA[0];
  const response=await request.get(`${feature.axial}/${Math.floor(manifest.geometry.shape[2]/2)}`);expect(response.status()).toBe(200);expect((await response.body()).length).toBe(manifest.geometry.shape[0]*manifest.geometry.shape[1]*5);
  expect((await request.get(`/api/cases/${manifest.patientId}/features/not-a-feature/axial/0`)).status()).toBe(404);
});
