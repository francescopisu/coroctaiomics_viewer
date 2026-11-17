import {test,expect} from '@playwright/test';

test('portable patient importer reports invalid packages without changing the catalogue',async({page,request})=>{
  const runtime=await (await request.get('/api/runtime')).json();
  test.skip(!runtime.portable,'Run against the portable launcher.');
  const before=await (await request.get('/api/patients')).json();
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Import patient',exact:true})).toBeVisible();
  await page.getByLabel('Patient package',{exact:true}).setInputFiles({name:'invalid.cctacase',mimeType:'application/zip',buffer:Buffer.from('invalid package')});
  await expect(page.getByRole('alert')).toContainText('Invalid patient package');
  await expect(page.getByRole('button',{name:'Import patient',exact:true})).toBeEnabled();
  expect(await (await request.get('/api/patients')).json()).toEqual(before);
  const rejected=await request.post('/api/patients/import',{headers:{Origin:'https://example.com','Content-Type':'application/zip'},data:Buffer.from('bad')});
  expect(rejected.status()).toBe(403);
});
