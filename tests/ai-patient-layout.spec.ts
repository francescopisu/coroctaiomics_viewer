import {test,expect} from '@playwright/test';
import {residentPhantoms} from './helpers/residentPhantom';
import type {AiResults} from '../src/aiTypes';

test('AI report groups patient details while retaining all main report tabs and metrics',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await residentPhantoms(page);
  const result:AiResults={patientId:'96',sourceCohort:'derivation',modelRevision:'test',horizonMonths:48,
    patient:{'Age at CCTA':60,Sex:'Man','Clinical Likelihood':12,'Clinical Likelihood Class':'Low',CADRADS:'Score 2','Coronary artery calcium score':26,
      Smoker:'Yes',Hypertension:'No',Diabetes:'No',Dyslipidemia:'Yes','Familiarity for CAD':'Yes','Body mass index (BMI)':24,Dyspnea:'No','Type of chest pain ':'No chest pain'},
    predictions:{pri:{risk:.121,error:null},adjusted:{risk:.097,error:null}},stratum:'High',priReference:{percentile:83.9,n:1000,source:'test'},
    thresholds:{q25:.03,q75:.1,source:'test',exactPercentileAvailable:true},features:[],cohort:{n:1000,events:50,sexKnown:1000,womenPercent:50,medianAge:60,comparisons:[]}};
  await page.route('**/api/cases/96/ai',route=>route.fulfill({json:result}));
  await page.goto('/viewer/96');await expect(page.locator('.resident-viewer.is-active')).toHaveAttribute('data-ready','true');
  await page.getByRole('button',{name:'Show AI report',exact:true}).click();const panel=page.getByRole('dialog',{name:'AI report',exact:true});
  await expect(panel.locator('.ai-patient-fields dt')).toHaveText(['Age','Sex','ESC RF-CL','CAD-RADS','Agatston','Smoking','Hypertension','Diabetes','Dyslipidemia','Family history of CAD','BMI','Dyspnea','Chest pain']);
  await expect(panel.locator('.ai-patient-fields dd').nth(0)).toHaveText('60 years');await expect(panel.locator('.ai-patient-fields dd').nth(2)).toHaveText('12% · Low');
  await expect(panel.locator('.ai-patient-fields>.ai-group-start dt')).toHaveText(['Smoking','Dyspnea']);
  await expect(panel.getByLabel('PRI-only risk')).toHaveText('12.1%');await expect(panel.getByLabel('Adjusted risk')).toHaveText('9.7%');await expect(panel.getByLabel('PRI percentile')).toHaveText('83.9');
  await expect(panel.getByRole('tab')).toHaveText(['Patient','Features','Cohort']);
  await panel.getByRole('tab',{name:'Features',exact:true}).click();await expect(panel.getByRole('combobox',{name:'Model',exact:true})).toBeVisible();
  await panel.getByRole('tab',{name:'Cohort',exact:true}).click();await expect(panel.locator('.ai-cohort-heading')).toContainText('Derivation');
  await panel.getByRole('tab',{name:'Patient',exact:true}).click();await panel.screenshot({path:'test-results/main-ai-report.png'});expect(errors).toEqual([]);
});
