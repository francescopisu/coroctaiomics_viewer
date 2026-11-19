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
/** Binary search uses reference knots directly, avoiding a uniform-HU lookup
 * that would lose precision for strongly skewed feature distributions. */
export function cohortShader(reference:CohortReference){
  const f=(x:number)=>x.toExponential(12),knots=reference.knots,n=knots.length,steps=Math.ceil(Math.log2(n))+1;
  return `
    const vec3 cohortKnots[${n}] = vec3[${n}](${knots.map(k=>`vec3(${k.map(f).join(',')})`).join(',')});
    int cohortLo=0, cohortHi=${n-1};
    for(int searchStep=0;searchStep<${steps};++searchStep){
      if(cohortLo>=cohortHi)break;
      int cohortMid=(cohortLo+cohortHi)/2;
      if(cohortKnots[cohortMid].x<value)cohortLo=cohortMid+1;else cohortHi=cohortMid;
    }
    vec3 cohortUpper=cohortKnots[cohortLo];
    float intensity;
    if(value<cohortKnots[0].x)intensity=0.0;
    else if(value>cohortKnots[${n-1}].x)intensity=1.0;
    else if(value==cohortUpper.x)intensity=0.5*(cohortUpper.y+cohortUpper.z);
    else{
      vec3 cohortLower=cohortKnots[max(0,cohortLo-1)];
      intensity=mix(cohortLower.z,cohortUpper.y,clamp((value-cohortLower.x)/max(cohortUpper.x-cohortLower.x,1.0e-30),0.0,1.0));
    }
  `;
}
