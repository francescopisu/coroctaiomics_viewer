"""Shared, patient-weighted radiomic display reference; source maps stay unchanged."""
import hashlib
import math
from .data import ROOT, read_json

REFERENCE_PATH=ROOT/'config/radiomic-cohort-reference.local.json'


def references(path=None):
    path=path or REFERENCE_PATH
    if not path.is_file():return {}
    source=read_json(path)
    if source.get('schema_version')!=1:raise ValueError('Unsupported radiomic cohort reference schema.')
    revision=hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    result={}
    for entry in source['references']:
        vessel={'LAD':'LAD','LCX':'LCx','RCA':'RCA'}.get(entry['vessel'].upper())
        name=entry['feature'];n=entry['patient_count'];knots=[]
        if not vessel or not isinstance(name,str) or not isinstance(n,int) or n<1:raise ValueError('Invalid feature reference identity.')
        for item in entry['lookup']:
            x,lo,eq=item['value'],item['weight_below'],item['weight_equal'];hi=lo+eq
            if not all(isinstance(v,(float,int)) and math.isfinite(v) for v in (x,lo,eq)) or not 0<=lo<=hi<=1+1e-9:raise ValueError('Invalid cohort percentile knot.')
            if knots and (x<=knots[-1][0] or lo+1e-9<knots[-1][2]):raise ValueError('Cohort lookup must be ordered.')
            knots.append([x,max(0,min(1,lo)),max(0,min(1,hi))])
        key=(vessel,name.casefold())
        if not knots or key in result:raise ValueError('Empty or duplicate cohort reference.')
        result[key]={'id':revision,'nPatients':n,'knots':knots}
    return result


def feature_maps(maps):
    lookup=references()
    return {vessel:[{**feature,**({'cohortReference':lookup[(vessel,feature['name'].casefold())]} if (vessel,feature['name'].casefold()) in lookup else {})} for feature in entries] for vessel,entries in maps.items()}
