import * as THREE from 'three';

/**
 * Materials of the player figure, ported 1:1 from the character viewer (index.html):
 *  - applySkinShader: procedural skin on a standard material (pores, creases, flush, veins, freckles, subsurface-style rim)
 *  - createInnerWearMaterial: the knit inner wear that shows under the open jacket
 * Both patch three's standard material through onBeforeCompile, so they take part in the game's lights, fog and tone mapping.
 */

export interface SkinShader {
  setTone(hex: string, freckleIndex?: number): void;
  setTexture(v: number): void;
  setFinish(name: 'Dry' | 'Natural' | 'Oily'): void;
}

export interface InnerWearUniforms {
  uBase: { value: number[] };
  uTrim: { value: number[] };
  uFull: { value: number };
}

const lin = (hex: string): number[] => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => {
    const c = parseInt(h.substr(i, 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
};

const SKIN_DECL = `
varying vec3 vRP;uniform vec3 uTone;uniform float uTex;uniform float uFreck;
float gH=0.,gPore=0.;vec3 gAlb=vec3(.5);
float hs(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float vn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
return mix(mix(mix(hs(i),hs(i+vec3(1,0,0)),f.x),mix(hs(i+vec3(0,1,0)),hs(i+vec3(1,1,0)),f.x),f.y),
mix(mix(hs(i+vec3(0,0,1)),hs(i+vec3(1,0,1)),f.x),mix(hs(i+vec3(0,1,1)),hs(i+vec3(1,1,1)),f.x),f.y),f.z);}
float stamp(vec3 p,float f,float occ,float rad){vec3 q=p*f,c=floor(q),l=q-c;
vec3 o=vec3(hs(c+7.1),hs(c+13.7),hs(c+3.3))*.4+.3;float on=step(hs(c+29.9),occ);
float d=length(l-o);return on*(1.-smoothstep(0.,rad,d));}
float blob(vec3 p,vec3 c,float r){vec3 d=p-c;return exp(-dot(d,d)/(r*r));}
`;
const SKIN_COLOR = `
{vec3 p=vRP;vec3 ap=vec3(abs(p.x),p.y,p.z);
float px=max(length(dFdx(p)),length(dFdy(p)));
float tex=min(uTex,1.);
float aC1=1.-smoothstep(.2,.7,px*190.);
float aC2=1.-smoothstep(.2,.7,px*340.);
float aP=1.-smoothstep(.2,.7,px*800.);
float aM=1.-smoothstep(.2,.7,px*2600.);
float aMid=1.-smoothstep(.3,1.,px*60.);
float pore=0.,c1=0.,c2=0.,grain=0.,bump=0.;
if(aP>.02)pore=stamp(p,800.,.7,.3)*aP;
if(aC1>.02)c1=smoothstep(.72,1.,1.-abs(2.*vn(p*190.+3.1)-1.))*aC1;
if(aC2>.02)c2=smoothstep(.75,1.,1.-abs(2.*vn(p*340.+7.7)-1.))*aC2;
if(aM>.02)grain=(vn(p*2600.)-.5)*aM;
if(aMid>.02)bump=(vn(p*55.+2.)-.5)*aMid;
gPore=pore;
gH=uTex*(-pore*6e-5-c1*2.2e-5-c2*1.2e-5+grain*1.2e-5+bump*3.5e-4);
float head=smoothstep(1.57,1.64,p.y);
float arm=smoothstep(.27,.38,ap.x)*(1.-smoothstep(1.55,1.6,p.y));
float hand=smoothstep(.40,.46,ap.x);
float shin=1.-smoothstep(.30,.55,p.y);
float foot=1.-smoothstep(.06,.13,p.y);
float expo=clamp(head+arm*.8+shin*.8,0.,1.);
vec3 t=uTone;
float lum=dot(t,vec3(.2126,.7152,.0722));
t*=mix(1.05,.94,expo);
float m=(vn(p*8.+1.7)-.5)*.11+(vn(p*30.+4.2)-.5)*.08;
if(px*110.<1.)m+=(vn(p*110.)-.5)*.05*(1.-smoothstep(.3,1.,px*110.));
t*=1.+m*max(tex,.6);
float flush=smoothstep(.35,.95,vn(p*9.+9.))*.13;
flush+=blob(ap,vec3(.06,1.745,.10),.055)*.45;
flush+=blob(ap,vec3(0.,1.778,.14),.03)*.55;
flush+=blob(ap,vec3(.34,1.31,-.07),.065)*.35;
flush+=blob(ap,vec3(.105,.50,.035),.075)*.30;
flush+=hand*.18+foot*.22;
flush+=blob(vec3(0.,p.y,p.z),vec3(0.,1.52,.08),.10)*.14;
t=mix(t,t*vec3(1.12,.78,.74),clamp(flush,0.,.65));
t*=1.-.20*pore;
t*=1.-.035*(c1+c2);
float vm=clamp(hand*.9+foot*.8+arm*.9+shin*.35,0.,1.);
if(vm>.05&&lum>.2){float vv=smoothstep(.94,.99,1.-abs(2.*vn(p*vec3(15.)+13.)-1.));
t=mix(t,t*vec3(.80,.86,.95),vv*vm*smoothstep(.15,.5,lum)*.55);}
if(uFreck>0.&&px*210.<1.){float fr=smoothstep(.78,.88,vn(p*210.))*smoothstep(.42,.72,vn(p*7.+5.))*clamp(expo+.25,0.,1.)*uFreck*(1.-smoothstep(.3,1.,px*210.));
t=mix(t,t*vec3(.78,.60,.46),fr*.45);}
gAlb=t;diffuseColor.rgb=t;}
`;
const SKIN_BUMP = `
{vec2 dH=vec2(dFdx(gH),dFdy(gH));vec3 sp=-vViewPosition;vec3 sx=dFdx(sp),sy=dFdy(sp);
vec3 r1=cross(sy,normal),r2=cross(normal,sx);float det=dot(sx,r1)*faceDirection;
vec3 gr=sign(det)*(dH.x*r1+dH.y*r2);normal=normalize(abs(det)*normal-gr);}
`;
const SKIN_RIM = `
{vec3 vd=normalize(vViewPosition);float ndv=clamp(dot(normal,vd),0.,1.);float rim=pow(1.-ndv,3.);
vec3 add=gAlb*(vec3(.6,.16,.08)*rim*.5+vec3(rim*rim*.07));
#if NUM_DIR_LIGHTS>0
for(int i=0;i<NUM_DIR_LIGHTS;i++){float nl=dot(normal,directionalLights[i].direction);
float w=clamp((nl+.45)/1.45,0.,1.);float s=max(w*w-clamp(nl,0.,1.),0.);
add+=gAlb*directionalLights[i].color*s*vec3(1.,.28,.14)*.5*RECIPROCAL_PI;}
#endif
outgoingLight+=add;}
`;

/** Default look from the viewer: tone "Light", natural finish, full skin texture. */
export function applySkinShader(m: THREE.MeshStandardMaterial): SkinShader {
  const U = { uTone: { value: lin('#d09c7f') }, uTex: { value: 1 }, uFreck: { value: 0.25 } };
  m.color.set(0xffffff);
  m.onBeforeCompile = (sh: any) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRP=position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', SKIN_DECL + 'void main() {')
      .replace('#include <color_fragment>', '#include <color_fragment>' + SKIN_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+gPore*.18*uTex,.05,1.);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + SKIN_BUMP)
      .replace('#include <opaque_fragment>', SKIN_RIM + '#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'figure-skin-1';
  return {
    setTone(hex, i = 2) {
      U.uTone.value = lin(hex);
      U.uFreck.value = [0.6, 0.5, 0.25, 0.1][i] || 0;
    },
    setTexture(v) {
      U.uTex.value = v;
    },
    setFinish(n) {
      m.roughness = { Dry: 0.8, Natural: 0.58, Oily: 0.36 }[n];
      m.envMapIntensity = { Dry: 0.4, Natural: 0.5, Oily: 0.8 }[n];
    },
  };
}

/** Knit inner wear (black with gold trim by default), drawn as a slightly inflated copy of the body clipped to the torso. */
export function createInnerWearMaterial(): { material: THREE.MeshStandardMaterial; uniforms: InnerWearUniforms } {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0, envMapIntensity: 0.35, side: THREE.FrontSide });
  const U: InnerWearUniforms = { uBase: { value: lin('#14141a') }, uTrim: { value: lin('#c89a3c') }, uFull: { value: 0 } };
  m.onBeforeCompile = (sh: any) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRP;varying vec3 vRN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRP=position;vRN=normal;transformed+=normal*0.0042;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', INNER_DECL)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', INNER_COLOR);
  };
  m.customProgramCacheKey = () => 'figure-innerwear-1';
  return { material: m, uniforms: U };
}

const INNER_DECL = `#include <common>
varying vec3 vRP;varying vec3 vRN;uniform vec3 uBase;uniform vec3 uTrim;uniform float uFull;
float ih(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}`;
const INNER_COLOR = `vec4 diffuseColor = vec4( diffuse, opacity );
{
 vec3 p=vRP;float ax=abs(p.x);
 float neckY=min(1.575+9.0*ax*ax,1.628);
 float hemY=0.985;
 float half_=0.188;
 float frontOK=uFull>.5?1.:step(-0.045,p.z);
 if(p.y>neckY||p.y<hemY||ax>half_||frontOK<.5)discard;
 float px=max(length(dFdx(p)),length(dFdy(p)));
 // knit: small V columns
 float amp=1.-smoothstep(.12,.45,px*260.);
 float colx=fract(p.x*230.),rowy=fract(p.y*210.+abs(colx-.5)*1.1);
 float knit=smoothstep(.0,.55,rowy)*(1.-smoothstep(.55,1.,rowy));
 float grain=ih(floor(p.xy*vec2(230.,210.)));
 vec3 base=uBase;
 base*=1.+amp*(knit-.5)*.55+amp*(grain-.5)*.18;
 // collar + hem trim
 float dn=neckY-p.y;
 float collar=(1.-smoothstep(.0085,.0125,dn))*(1.-smoothstep(.055,.085,ax));
 float hem=1.-smoothstep(.0105,.0145,p.y-hemY);
 float rib=.5+.5*sin(p.y*900.);
 vec3 trim=uTrim*(.82+.18*mix(1.,rib,amp));
 base=mix(base,trim,max(collar,hem*.0));
 // fake occlusion under the jacket flaps and around the neck / belly
 float ao=mix(.30,1.,1.-smoothstep(.035,.165,ax));
 ao*=mix(.55,1.,smoothstep(.0,.06,dn));
 ao*=mix(.75,1.,smoothstep(.0,.07,p.y-hemY));
 diffuseColor.rgb=base*ao;
}`;
