import {test,expect} from '@playwright/test';

test('smooth meshes, aorta, balanced maps and independent CPE mask visibility',async({page,request})=>{
  test.setTimeout(180000);const manifest=await (await request.get('/api/case')).json(),maps=manifest.featureMaps?.LAD??[];
  test.skip(!maps.length||!manifest.surfaces.ascending_aorta,'Prepared aorta and maps required');
  const errors:string[]=[];page.on('pageerror',e=>{errors.push(e.message);console.log('Browser error:',e.message);});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('Render error:',m.text());}});
  await page.goto('/');const exportButton=page.getByRole('button',{name:'Export',exact:true});await expect(exportButton).toBeEnabled({timeout:90000});
  const selector=page.getByLabel('Radiomic feature map',{exact:true}),cross=page.locator('.cross canvas'),scene=page.locator('.scene');
  const crossImage=()=>cross.evaluate((c:HTMLCanvasElement)=>c.toDataURL());
  await selector.selectOption(maps[0].id);await expect(exportButton).toBeEnabled({timeout:60000});
  const scale=page.getByLabel('Feature scale',{exact:true});await expect(scale).toHaveValue('balanced');
  const balanced=await crossImage(),balancedCpr=await page.getByLabel('Curved CPR',{exact:true}).screenshot();
  await page.screenshot({path:'test-results/smoothed-balanced-aorta.png'});
  await scale.selectOption('raw');expect(await crossImage()).not.toBe(balanced);expect((await page.getByLabel('Curved CPR',{exact:true}).screenshot()).equals(balancedCpr)).toBe(false);
  await expect(page.getByLabel('Feature color scale')).toContainText('0');await scale.selectOption('balanced');expect(await crossImage()).toBe(balanced);
  const masks=page.getByRole('button',{name:'CPE masks',exact:true});await masks.click();await expect(masks).toHaveAttribute('aria-pressed','false');
  await expect(selector).toHaveValue(maps[0].id);await expect(page.getByLabel('Feature color scale')).toBeVisible();const mapWithoutMasks=await crossImage();
  await selector.selectOption('');await expect(exportButton).toBeEnabled();expect(await crossImage()).not.toBe(mapWithoutMasks);
  await selector.selectOption(maps[0].id);await expect(exportButton).toBeEnabled({timeout:60000});expect(await crossImage()).toBe(mapWithoutMasks);await masks.click();expect(await crossImage()).toBe(balanced);
  await page.getByText('Layers',{exact:true}).click();
  const smoothEdges=page.getByRole('checkbox',{name:'Smooth edges',exact:true});await smoothEdges.uncheck();expect(await crossImage()).not.toBe(balanced);
  await page.getByText('Layers',{exact:true}).click();await page.screenshot({path:'test-results/voxel-edges-comparison.png'});await page.getByText('Layers',{exact:true}).click();await smoothEdges.check();expect(await crossImage()).toBe(balanced);
  const smoothMeshes=page.getByRole('checkbox',{name:'Smooth meshes',exact:true});const smooth3d=await scene.screenshot();await smoothMeshes.uncheck();expect((await scene.screenshot()).equals(smooth3d)).toBe(false);await smoothMeshes.check();
  const aorta=page.getByRole('checkbox',{name:'Ascending aorta',exact:true});await expect(aorta).toBeEnabled();const withAorta=await scene.screenshot();await aorta.uncheck();expect((await scene.screenshot()).equals(withAorta)).toBe(false);await aorta.check();
  await expect(page.getByRole('checkbox',{name:'CCTA',exact:true})).toBeChecked();expect(await crossImage()).toBe(balanced);
  await test.info().attach('final-cross.png',{body:Buffer.from((await crossImage()).split(',')[1],'base64'),contentType:'image/png'});
  await page.getByText('Layers',{exact:true}).click();await page.screenshot({path:'test-results/display-controls-final.png'});
  expect(errors).toEqual([]);await expect(page.getByRole('alert')).toHaveCount(0);
});
