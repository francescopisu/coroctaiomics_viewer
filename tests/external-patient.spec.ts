import {test,expect} from '@playwright/test';

test('P001 opens as an external patient with native CPE volume, maps and separate AI inputs',async({page,request})=>{
  test.setTimeout(300000);const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const response=await request.get('/api/cases/P001');expect(response.status()).toBe(200);const data=await response.json();
  expect(data.geometry.shape).toEqual([512,512,419]);expect(data.surfaces.ascending_aorta).toBeDefined();
  expect(Object.fromEntries(Object.entries(data.featureMaps).map(([v,maps])=>[v,(maps as any[]).length]))).toEqual({LAD:3,LCx:4,RCA:4});
  const ai=await (await request.get('/api/cases/P001/ai')).json();
  expect(ai.patientId).toBe('P001');expect(ai.sourceCohort).toBe('external');expect(ai.features).toHaveLength(8);expect(ai.cohort.n).toBe(1038);
  expect(ai.patient.KVP).toBe(120);expect(ai.predictions.pri.error).toBeNull();expect(ai.stratum).toBe('High');
  expect(JSON.stringify(ai)).not.toContain('/Volumes/');expect(ai.patient).not.toHaveProperty('EVENT');expect(ai.patient).not.toHaveProperty('TIME');
  await page.goto('/');await page.getByLabel('Search patient ID').fill('P001');await page.getByRole('link',{name:'Open patient P001',exact:true}).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:120000});await expect(page.locator('.viewer-patient')).toHaveText('P001');
  await expect(page.locator('canvas')).toHaveCount(4);await expect(page.locator('.scene')).toHaveAttribute('data-render-mode','cpe');
  await expect(page.locator('.scene')).toHaveAttribute('data-volume-lighting','unlit');
  await page.screenshot({path:'test-results/P001-viewer.png'});
  for(const vessel of ['LAD','LCx','RCA']){
    await page.getByLabel('Vessel',{exact:true}).selectOption(vessel);
    await expect(page.getByLabel('Radiomic feature map',{exact:true}).locator('option')).toHaveCount(data.featureMaps[vessel].length+1);
    expect(data.featureMaps[vessel].every((map:any)=>!map.name.startsWith('P001_'))).toBe(true);
  }
  await page.getByRole('button',{name:'AI',exact:true}).click();const panel=page.getByRole('dialog',{name:'AI',exact:true});
  await expect(panel).toContainText('Patient P001');await expect(panel.getByLabel('PRI-only risk')).toHaveText(`${(100*ai.predictions.pri.risk).toFixed(1)}%`);
  await expect(panel.getByLabel('Adjusted risk')).toHaveText(ai.predictions.adjusted.risk==null?'—':`${(100*ai.predictions.adjusted.risk).toFixed(1)}%`);
  await expect(panel.getByLabel('Risk category')).toHaveText(ai.stratum);
  await panel.getByRole('tab',{name:'Features',exact:true}).click();await expect(panel.locator('.ai-feature-name')).toHaveCount(8);
  for(const button of await panel.locator('.ai-feature-name').all())await expect(button).toBeEnabled();
  await panel.getByRole('button',{name:'Show LAD wavelet-LHL_gldm_LargeDependenceLowGrayLevelEmphasis map',exact:true}).click();
  await expect(page.getByLabel('Vessel',{exact:true})).toHaveValue('LAD');
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:60000});await expect(page.getByLabel('Feature color scale')).toBeVisible();
  await expect(panel.locator('.ai-selected-feature')).toHaveCount(1);await expect(page.locator('.initial-loader')).toHaveCount(0);
  await page.screenshot({path:'test-results/P001-AI-features.png'});
  await panel.getByRole('button',{name:'Close AI results',exact:true}).click();
  const curved=page.getByLabel('Curved CPR',{exact:true}),box=(await curved.boundingBox())!;
  const fixedCross=await page.locator('.cross canvas').evaluate((el:HTMLCanvasElement)=>el.toDataURL());
  await page.mouse.move(box.x+box.width*.3,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.3+50,box.y+box.height*.5,{steps:4});await page.mouse.up();
  await expect(page.getByLabel('CPR rotation')).toHaveText('30°');expect(await page.locator('.cross canvas').evaluate((el:HTMLCanvasElement)=>el.toDataURL())).toBe(fixedCross);
  await page.getByRole('button',{name:'← Patients',exact:true}).click();await expect(page.locator('canvas')).toHaveCount(0);expect(errors).toEqual([]);
});
