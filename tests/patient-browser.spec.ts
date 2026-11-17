import {test,expect} from '@playwright/test';

test('patient browser is lightweight, searchable, sortable and keyboard accessible',async({page,request})=>{
  const response=await request.get('/api/patients');expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toBe('no-store');
  const data=await response.json();expect(data.patients.map((p:{patientId:string})=>p.patientId)).toEqual(expect.arrayContaining(['1718','1','8','P001']));
  expect(data.patients.every((p:{available:boolean})=>p.available)).toBe(true);expect(JSON.stringify(data)).not.toContain('/Volumes/');
  const assets:string[]=[];page.on('request',r=>{if(/\/api\/cases\/.*\/assets\//.test(r.url()))assets.push(r.url());});
  await page.goto('/');await expect(page.getByRole('heading',{name:'Patients',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:/^Open patient /})).toHaveCount(data.patients.length);await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByLabel('Search patient ID').fill('1718');await expect(page.getByRole('link',{name:/^Open patient /})).toHaveCount(1);
  await expect(page).toHaveURL(/q=1718/);await page.reload();await expect(page.getByLabel('Search patient ID')).toHaveValue('1718');
  await page.getByLabel('Search patient ID').fill('nothing');await expect(page.getByText('No matching patients.')).toBeVisible();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await page.getByRole('button',{name:'Patient',exact:true}).click();await expect(page.getByRole('columnheader',{name:'Patient'})).toHaveAttribute('aria-sort','descending');
  await page.getByLabel('Filter risk category').selectOption('High');await expect(page.getByRole('link',{name:'Open patient 1718',exact:true})).toBeVisible();
  await page.getByLabel('Filter risk category').selectOption('');expect(assets).toEqual([]);
  await page.screenshot({path:'test-results/patient-browser.png'});
});

test('switching real patients isolates images and AI, preserves list state and restores selection',async({page,request})=>{
  test.setTimeout(360000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.getByLabel('Search patient ID').fill('8');
  await page.getByRole('link',{name:'Open patient 8',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/viewer\/8$/);await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:120000});
  await expect(page.locator('.viewer-patient')).toHaveText('8');await expect(page.locator('canvas')).toHaveCount(4);
  await page.getByLabel('Vessel',{exact:true}).selectOption('RCA');
  const curved=await page.getByLabel('Curved CPR',{exact:true}).boundingBox();
  await page.mouse.move(curved!.x+curved!.width/2,curved!.y+curved!.height/2);await page.mouse.down();await page.mouse.move(curved!.x+curved!.width/2+50,curved!.y+curved!.height/2,{steps:3});await page.mouse.up();
  await expect(page.getByLabel('CPR rotation')).toHaveText('30°');
  const axial=page.getByRole('group',{name:'Axial slice navigation',exact:true});
  await axial.focus();await axial.press('ArrowDown');await axial.press('ArrowDown');
  const axialIndex=await page.locator('.axial canvas').getAttribute('data-slice-index');
  await page.getByRole('button',{name:'AI',exact:true}).click();
  const ai=await request.get('/api/cases/8/ai');
  if(ai.ok()){
    const panel=page.getByRole('dialog',{name:'AI',exact:true});await expect(panel).toContainText('Patient 8');
    await panel.getByRole('tab',{name:'Features',exact:true}).click();
    await expect(panel.getByRole('button',{name:'Show LAD original_glcm_Id map',exact:true})).toBeDisabled();
  }
  await page.getByRole('button',{name:'Close AI results',exact:true}).click();
  await page.getByRole('button',{name:'← Patients',exact:true}).click();
  await expect(page.getByLabel('Search patient ID')).toHaveValue('8');await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByLabel('Search patient ID').fill('1');await page.getByRole('link',{name:'Open patient 1',exact:true}).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:120000});await expect(page.locator('.viewer-patient')).toHaveText('1');
  await expect(page.getByLabel('CPR rotation')).toHaveText('0°');await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goBack();await expect(page.getByLabel('Search patient ID')).toHaveValue('1');await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByLabel('Search patient ID').fill('8');await page.getByRole('link',{name:'Open patient 8',exact:true}).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:120000});
  await expect(page.getByLabel('Vessel',{exact:true})).toHaveValue('RCA');await expect(page.getByLabel('CPR rotation')).toHaveText('30°');
  await expect(page.locator('.axial canvas')).toHaveAttribute('data-slice-index',axialIndex!);
  await page.reload();await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:120000});
  await expect(page.locator('.viewer-patient')).toHaveText('8');await expect(page.getByLabel('CPR rotation')).toHaveText('30°');
  await expect(page.locator('.axial canvas')).toHaveAttribute('data-slice-index',axialIndex!);
  await page.screenshot({path:'test-results/viewer-patient-8.png'});expect(errors).toEqual([]);
});

test('loading can be cancelled and unknown patient links recover to the list',async({page})=>{
  test.setTimeout(180000);let release!:()=>void;const held=new Promise<void>(r=>{release=r;});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/cases/8/assets/axial.volume.ct.bin',async route=>{await held;await route.continue().catch(()=>{});});
  await page.goto('/viewer/8');await expect(page.getByRole('progressbar',{name:'Loading viewer'})).toBeVisible();
  await page.getByRole('button',{name:'← Patients',exact:true}).click();release();
  await expect(page.getByRole('heading',{name:'Patients',exact:true})).toBeVisible();await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByRole('link',{name:'Open patient 1718',exact:true}).click();await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:90000});
  await expect(page.locator('.viewer-patient')).toHaveText('1718');await expect(page.locator('canvas')).toHaveCount(4);
  await page.goto('/viewer/not-a-patient');await expect(page.getByRole('alert')).toContainText('not in the case catalogue');
  await page.getByRole('button',{name:'← Patients',exact:true}).click();await expect(page.getByRole('heading',{name:'Patients',exact:true})).toBeVisible();expect(errors).toEqual([]);
});
