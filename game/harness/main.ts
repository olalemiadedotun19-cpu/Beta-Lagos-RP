import { GameEngine } from '../src/core/GameEngine';
const data: any = {
  identity:{id:'t',firstName:'T',lastName:'T',username:'tt',dateOfBirth:{year:2000,month:1,day:1,hour:0,minute:0},sex:'male',nationality:'Nigerian'},
  appearance:{gender:'male',skinTone:'#c68c5c',hairStyle:'short',hairColor:'#222',facialHair:'none',facialHairColor:'#222',glasses:'none',shirtColor:'#fff',pantsColor:'#222',shoesColor:'#111',heightScale:1,bodyBuild:'average'},
  stats:{health:95,energy:90,hunger:85,happiness:85,hygiene:90,stress:15},
  finances:{cash:1,bankBalance:1,currencyCode:'NGN',currencySymbol:'N'},
  career:{jobTitle:'x',employer:'x',hourlyWage:1,experienceYears:1,isEmployed:true},
  education:{level:'None',schoolName:'',fieldOfStudy:''},
  location:{continentId:'continent_africa',countryId:'country_nigeria',stateId:'state_lagos',cityId:'city_lagos',districtId:'district_ikeja',position:{x:0,y:0,z:12},rotationY:0},
  inventory:[],createdAt:0,lastSavedAt:Date.now(),
};
const c = document.getElementById('app')!;
const t0 = performance.now();
const e = new GameEngine(c, data);
(window as any).__engine = e;
e.start();
(window as any).__t0 = performance.now() - t0;
