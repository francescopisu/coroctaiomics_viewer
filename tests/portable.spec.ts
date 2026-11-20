import {test,expect} from '@playwright/test';

test('portable patient importer reports invalid packages without changing the catalogue',async({page,request})=>{
  const runtime=await (await request.get('/api/runtime')).json();
  test.skip(!runtime.portable,'Run against the portable launcher.');
  const before=await (await request.get('/api/patients')).json();
  await page.goto('/');
  await expect(page.getByRole('table',{name:'Patients',exact:true})).toBeVisible();
  const invalid=await request.post('/api/patients/import',{headers:{Origin:new URL(page.url()).origin,'Content-Type':'application/zip'},data:Buffer.from('invalid package')});
  expect(invalid.status()).toBe(400);expect(await (await request.get('/api/patients')).json()).toEqual(before);
  const rejected=await request.post('/api/patients/import',{headers:{Origin:'https://example.com','Content-Type':'application/zip'},data:Buffer.from('bad')});
  expect(rejected.status()).toBe(403);
});
