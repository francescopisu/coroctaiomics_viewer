import type {Vessel} from './types';

export type AiModel = 'pri' | 'adjusted';
export interface FeatureHazard {coefficient:number;hr:number;ci:[number,number]}
export interface FeatureReference {median:number|null;iqr:[number,number]|null;percentile:number|null;n:number}
export interface AiFeature {name:string;mapName:string;vessel:Vessel;value:number|null;reference:FeatureReference;models:Record<AiModel,FeatureHazard>}
export interface AiComparison {name:string;label:string;value:number|null;median:number|null;percentile:number|null;n:number}
export interface AiResults {
  patientId:string;sourceCohort:'derivation'|'validation'|'external';horizonMonths:number;modelRevision:string;
  patient:Record<string,string|number|null>;
  predictions:Record<AiModel,{risk:number|null;error:string|null}>;
  stratum:'Low'|'Intermediate'|'High'|null;
  priReference:{percentile:number|null;n:number;source:string};
  thresholds:{q25:number;q75:number;source:string;exactPercentileAvailable:boolean};
  cohort:{n:number;events:number;sexKnown:number;womenPercent:number;medianAge:number;comparisons:AiComparison[]};
  features:AiFeature[];
}
