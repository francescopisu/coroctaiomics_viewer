import {test,expect} from '@playwright/test';

for(const patientId of ['96','814','893']){
  test(`prepared cohort case ${patientId} shows its images, maps and frozen AI inputs`,async({page,request})=>{
    test.setTimeout(180000);
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const data=await (await request.get(`/api/cases/${patientId}`)).json();
    const report=await (await request.get(`/api/cases/${patientId}/ai`)).json();
    expect(data.patientId).toBe(patientId);expect(report.patientId).toBe(patientId);
    expect(report.sourceCohort).toBe('derivation');expect(report.features).toHaveLength(8);
    expect(Object.values(data.featureMaps).flat()).toHaveLength(8);
    expect(report.patient).not.toHaveProperty('EVENT');expect(report.patient).not.toHaveProperty('TIME');
    await page.goto(`/viewer/${patientId}`);
    await expect(page.locator('main')).toHaveAttribute('aria-busy','false',{timeout:120000});
    await expect(page.locator('canvas')).toHaveCount(4);
    await expect(page.locator('.viewer-patient')).toHaveText(patientId);
    await page.getByRole('button',{name:'AI',exact:true}).click();
    const panel=page.getByRole('dialog',{name:'AI',exact:true});
    await expect(panel).toContainText(`Patient ${patientId}`);
    await expect(panel.getByLabel('PRI-only risk')).toHaveText(`${(100*report.predictions.pri.risk).toFixed(1)}%`);
    await expect(panel.getByLabel('Adjusted risk')).toHaveText(`${(100*report.predictions.adjusted.risk).toFixed(1)}%`);
    await expect(panel.getByLabel('PRI percentile',{exact:true})).toHaveText(report.priReference.percentile.toLocaleString('en-US',{maximumFractionDigits:1}));
    await expect(panel.getByLabel('Risk category')).toHaveText(report.stratum);
    await panel.getByRole('tab',{name:'Features',exact:true}).click();
    await expect(panel.locator('.ai-feature-name')).toHaveCount(8);
    for(const button of await panel.locator('.ai-feature-name').all())await expect(button).toBeEnabled();
    await panel.locator('.ai-feature-name').first().click();
    await expect(page.getByLabel('Feature color scale')).toBeVisible();
    await page.screenshot({path:`test-results/prepared-${patientId}.png`});
    expect(errors).toEqual([]);
  });
}
