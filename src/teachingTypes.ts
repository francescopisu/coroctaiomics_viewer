export interface TeachingViewerState {
  code:string;name:string;aiUnlocked:boolean;aiConsulted:boolean;hasDecision:boolean;
  onUnlockAi:()=>void;onAiConsulted:()=>void;onManage:()=>void;onPrognosis:()=>void;
}
export interface TeachingProfile {
  code:string;displayName:string;age:number|null;sex:string;indication:string;riskFactors:string;clinicalProfile:string;
  choices:{id:string;label:string}[];
}
