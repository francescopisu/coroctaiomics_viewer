export interface CohortReference {id:string;nPatients:number;knots:[number,number,number][]}
/** Midrank at observed knots; interpolate the CDF between retained knots. */
export function cohortPosition(value:number,reference:CohortReference):number{
  const knots=reference.knots,last=knots.length-1;
  if(value<knots[0][0])return 0;if(value>knots[last][0])return 1;
  let lo=0,hi=last;
  while(lo<hi){const mid=(lo+hi)>>1;if(knots[mid][0]<value)lo=mid+1;else hi=mid;}
  const upper=knots[lo];if(value===upper[0])return (upper[1]+upper[2])/2;
  const lower=knots[lo-1],t=(value-lower[0])/(upper[0]-lower[0]);
  return lower[2]+t*(upper[1]-lower[2]);
}
/** The reference lives in a tiny RGBA32F texture, not a dynamically indexed
 * constant array that some Windows drivers compile into expensive code. */
export function cohortShader(){
  return `
    int cohortLo=0, cohortHi=cohortKnotCount-1;
    for(int searchStep=0;searchStep<16;++searchStep){
      if(cohortLo>=cohortHi)break;
      int cohortMid=(cohortLo+cohortHi)/2;
      if(texelFetch(cohortReferenceTexture,ivec2(cohortMid,0),0).x<value)cohortLo=cohortMid+1;else cohortHi=cohortMid;
    }
    vec3 cohortUpper=texelFetch(cohortReferenceTexture,ivec2(cohortLo,0),0).xyz;
    float intensity;
    if(value<texelFetch(cohortReferenceTexture,ivec2(0,0),0).x)intensity=0.0;
    else if(value>texelFetch(cohortReferenceTexture,ivec2(cohortKnotCount-1,0),0).x)intensity=1.0;
    else if(value==cohortUpper.x)intensity=0.5*(cohortUpper.y+cohortUpper.z);
    else{
      vec3 cohortLower=texelFetch(cohortReferenceTexture,ivec2(max(0,cohortLo-1),0),0).xyz;
      intensity=mix(cohortLower.z,cohortUpper.y,clamp((value-cohortLower.x)/max(cohortUpper.x-cohortLower.x,1.0e-30),0.0,1.0));
    }
  `;
}
