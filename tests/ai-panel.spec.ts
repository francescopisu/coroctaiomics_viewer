import {test,expect,type Locator} from '@playwright/test';
import type {AiResults} from '../src/aiTypes';

async function expectFeaturesFit(panel:Locator){
  const layout=await panel.locator('.ai-content-features').evaluate(content=>{
    const bounds=content.getBoundingClientRect();
    return {scrollX:content.scrollWidth-content.clientWidth,scrollY:content.scrollHeight-content.clientHeight,
      names:Array.from(content.querySelectorAll<HTMLElement>('.ai-feature-name')).map(name=>{
        const text=name.getBoundingClientRect(),cell=name.parentElement!.getBoundingClientRect();
        return {fitsCell:text.right<=cell.right+1,oneLine:text.height<=parseFloat(getComputedStyle(name).lineHeight)+1};
      }),allRowsVisible:Array.from(content.querySelectorAll<HTMLElement>('.ai-features tr')).every(row=>{
        const box=row.getBoundingClientRect();return box.top>=bounds.top&&box.bottom<=bounds.bottom+1&&box.bottom<=innerHeight;
      })};
  });
  expect(layout.scrollX).toBeLessThanOrEqual(1);expect(layout.scrollY).toBeLessThanOrEqual(1);
  expect(layout.names).toHaveLength(8);expect(layout.names.every(name=>name.fitsCell&&name.oneLine)).toBe(true);expect(layout.allRowsVisible).toBe(true);
}

test('AI results use the configured patient, switch details and preserve reconstruction layout',async({page,request})=>{
  test.setTimeout(180000);
  const current=await (await request.get('/api/cases/1718')).json();
  const response=await request.get(`/api/cases/${current.patientId}/ai`);
  expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toBe('no-store');
  const data=await response.json() as AiResults;
  expect(data.patientId).toBe(current.patientId);expect(data.features).toHaveLength(8);
  expect(JSON.stringify(data)).not.toContain('/Volumes/');
  expect((await request.get('/api/cases/not-in-catalog/ai')).status()).toBe(404);
  expect((await request.get('/cache/ai/reference.json')).status()).toBe(404);
  expect((await request.get(`/api/cases/${current.patientId}/assets/reference.json`)).status()).toBe(404);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const aiRequests:string[]=[];page.on('request',r=>{if(r.url().endsWith('/ai'))aiRequests.push(r.url());});
  await page.goto('/viewer/1718');await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:90000});
  expect(aiRequests).toHaveLength(0);
  const geometry=async()=>Promise.all(['.overview','.recon','.right-views'].map(selector=>page.locator(selector).boundingBox()));
  const before=await geometry(),curved=page.getByLabel('CPR rotation');
  const indexBefore=await page.locator('.cross canvas').getAttribute('data-centreline-index');
  await page.getByRole('button',{name:'AI',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'AI',exact:true});
  await expect(panel.getByLabel('PRI-only risk')).toHaveText(`${(100*data.predictions.pri.risk!).toFixed(1)}%`);
  await expect(panel.getByLabel('Adjusted risk')).toHaveText(`${(100*data.predictions.adjusted.risk!).toFixed(1)}%`);
  await expect(panel.getByLabel('Risk category')).toHaveText(data.stratum!);
  await expect(panel.getByLabel('PRI percentile',{exact:true})).toHaveText(data.priReference.percentile!.toLocaleString('en-US',{maximumFractionDigits:1}));
  await expect(panel.locator('.ai-risk-track>i')).toHaveAttribute('title',/PRI percentile/);
  expect(await panel.locator('.ai-risk-track>i').evaluate(el=>parseFloat((el as HTMLElement).style.left))).toBeCloseTo(data.priReference.percentile!,3);
  await expect(panel.getByText('Risk category',{exact:true})).toBeVisible();
  await expect(panel).toContainText('Patient 1718');await expect(panel).toContainText('ESC RF-CL 12% · Low');
  await expect(panel.locator('dd').filter({hasText:'Unknown'})).toHaveCount(1);
  expect(await geometry()).toEqual(before);expect(await curved.innerText()).toBe('0°');
  expect(await page.locator('.cross canvas').getAttribute('data-centreline-index')).toBe(indexBefore);
  const bar=await panel.locator('.ai-risk-track').boundingBox();
  const widths=await panel.locator('.ai-risk-track>span').evaluateAll(items=>items.map(el=>el.getBoundingClientRect().width));
  expect(widths[0]/bar!.width).toBeCloseTo(.25,2);expect(widths[1]/bar!.width).toBeCloseTo(.5,2);
  await page.screenshot({path:'test-results/ai-patient.png'});
  await panel.getByRole('tab',{name:'Features',exact:true}).click();
  await expect(panel.locator('.ai-feature-name')).toHaveCount(8);
  await expect(panel.getByText('Legend',{exact:true})).toHaveCount(0);
  await expect(panel.locator('.ai-feature-tools')).not.toContainText('Derivation');
  await expect(panel.getByRole('combobox',{name:'Model',exact:true})).toBeVisible();await expectFeaturesFit(panel);
  const format=(value:number|null)=>value==null?'—':value.toLocaleString('en-US',{maximumSignificantDigits:4});
  for(const item of data.features){
    const row=panel.getByRole('row').filter({has:page.getByRole('button',{name:`Show ${item.vessel} ${item.mapName} map`,exact:true})});
    await expect(row.locator('.ai-feature-patient>span')).toHaveText(format(item.value));
    await expect(row.locator('.ai-feature-reference>span')).toHaveText(format(item.reference.median));
    await expect(row.locator('.ai-feature-reference>small')).not.toHaveText('—');
    await expect(row.locator('.ai-hr-direction')).toHaveCount(0);
    expect(item.reference.percentile).toBeGreaterThanOrEqual(0);expect(item.reference.percentile).toBeLessThanOrEqual(100);
  }
  const cluster=panel.getByRole('row').filter({hasText:'LLH · GLCM ClusterShade'});
  const feature=data.features.find(f=>f.mapName==='wavelet-LLH_glcm_ClusterShade')!;
  await expect(cluster.locator('.ai-hr')).toContainText(feature.models.pri.hr.toFixed(3));
  await cluster.locator('.ai-hr').focus();
  await expect(cluster.getByRole('tooltip')).toBeVisible();await expect(cluster.getByRole('tooltip')).toContainText('95% CI');
  await expect(cluster.getByRole('tooltip')).toContainText('lower-risk association');
  await panel.getByLabel('Model').selectOption('adjusted');
  await expect(cluster.locator('.ai-hr')).toContainText(feature.models.adjusted.hr.toFixed(3));
  await expect(cluster.locator('.ai-hr-uncertain')).toBeVisible();
  await expect(cluster.locator('.ai-feature-reference>span')).toHaveText(format(feature.reference.median));
  await panel.getByRole('tab',{name:'Features',exact:true}).focus();
  await page.mouse.move(1450,20);
  await expectFeaturesFit(panel);
  await page.screenshot({path:'test-results/ai-features.png'});
  await cluster.getByRole('button').click();
  await expect(page.getByLabel('Vessel',{exact:true})).toHaveValue('LCx');
  const map=current.featureMaps.LCx.find((f:{name:string})=>f.name===feature.mapName);
  await expect(page.getByLabel('Radiomic feature map',{exact:true})).toHaveValue(map.id);
  await expect(panel.locator('.ai-selected-feature')).toHaveCount(1);
  await panel.getByRole('tab',{name:'Cohort',exact:true}).click();
  await expect(panel).toContainText('n = 1,038');await expect(panel).toContainText('MACE 92');
  await expect(panel.locator('.ai-comparisons tbody tr')).toHaveCount(4);
  const priRow=panel.locator('.ai-comparisons tbody tr').filter({hasText:/^PRI-only/});
  await expect(priRow.locator('td').first()).toHaveText(`${(100*data.predictions.pri.risk!).toFixed(1)}%`);
  await expect(priRow.locator('.ai-percentile')).toHaveAttribute('title',/out-of-fold/);
  await page.screenshot({path:'test-results/ai-cohort.png'});
  await panel.getByRole('tab',{name:'Cohort',exact:true}).press('ArrowRight');
  await expect(panel.getByRole('tab',{name:'Patient',exact:true})).toHaveAttribute('aria-selected','true');
  await panel.press('Escape');await expect(panel).not.toBeVisible();
  await expect(page.getByRole('button',{name:'AI',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'AI',exact:true}).click();
  await expect(panel.getByLabel('PRI-only risk')).toBeVisible();expect(aiRequests).toHaveLength(1);
  await expect(page.locator('.initial-loader')).toHaveCount(0);expect(errors).toEqual([]);
  await panel.getByRole('button',{name:'Close AI results',exact:true}).click();
  await expect(page.getByRole('button',{name:'AI',exact:true})).toHaveAttribute('aria-expanded','false');
});

test('patient 8 GLDM value has a cohort reference and remains readable in a compact panel',async({page})=>{
  test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1050,height:800});await page.goto('/viewer/8');
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:90000});
  await page.getByRole('button',{name:'AI',exact:true}).click();const panel=page.getByRole('dialog',{name:'AI',exact:true});
  await expect(panel.getByLabel('PRI-only risk')).toBeVisible();await panel.getByRole('tab',{name:'Features',exact:true}).click();
  const gldm=panel.getByRole('row').filter({has:page.getByRole('button',{name:'Show LAD wavelet-LHL_gldm_LargeDependenceLowGrayLevelEmphasis map',exact:true})});
  await expect(gldm.locator('.ai-feature-patient>span')).toHaveText('0.0087');await expect(gldm.locator('.ai-feature-patient>small')).toHaveText('P70.6');
  await expect(gldm.locator('.ai-feature-reference>span')).toHaveText('0.004885');await expect(gldm.locator('.ai-feature-reference>small')).toHaveText('(0.00243 – 0.00966)');
  await expect(gldm.locator('.ai-hr-direction')).toHaveCount(0);await expect(gldm.locator('.ai-hr-uncertain')).toBeVisible();
  await gldm.locator('.ai-hr').focus();await expect(gldm.getByRole('tooltip')).toContainText('not this patient');
  await panel.getByRole('tab',{name:'Features',exact:true}).focus();await page.mouse.move(1000,20);
  await expectFeaturesFit(panel);
  await page.screenshot({path:'test-results/ai-features-patient-8-compact.png'});
  await panel.getByLabel('Model').selectOption('adjusted');await expect(gldm.locator('.ai-hr')).toContainText('0.891');
  await expect(gldm.locator('.ai-feature-patient>small')).toHaveText('P70.6');
  await page.setViewportSize({width:1280,height:720});await expectFeaturesFit(panel);
  await page.screenshot({path:'test-results/ai-features-720p.png'});expect(errors).toEqual([]);
});

test('AI failure stays in the panel and offers retry without interrupting the viewer',async({page})=>{
  test.setTimeout(150000);
  await page.route('**/api/cases/*/ai',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'AI source files changed. Run python -m backend.export_ai again.'})}));
  await page.goto('/viewer/1718');await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:90000});
  await page.getByRole('button',{name:'AI',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'AI',exact:true});
  await expect(panel.getByRole('alert')).toContainText('AI source files changed');
  await expect(panel.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false');
  await page.unroute('**/api/cases/*/ai');await panel.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(panel.getByLabel('PRI-only risk')).toBeVisible();await expect(panel.getByRole('alert')).toHaveCount(0);
});
