(function(){
'use strict';
const screen=document.getElementById('screen'),phone=document.getElementById('phone');
const tpl=document.getElementById('tpl').innerHTML;
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const q=s=>screen.querySelector(s);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let S,RUN=0,paused=false;

/* ---------- calendar state ---------- */
const BASE=[{d:3,k:'mine',t:'04:20',id:'m3'},{d:4,k:'mine',t:'05:10',id:'m4'},{d:8,k:'mine',t:'04:20',id:'m8'},{d:12,k:'offer',t:'06:00',id:'e12'},
 {d:15,k:'request',t:'05:00',id:'e15'},{d:17,k:'mine',t:'10:50',id:'m17'},{d:20,k:'offer',t:'10:00',id:'e20'},{d:22,k:'request',t:'04:00',id:'e22'},{d:27,k:'offer',t:'05:00',id:'e27'}];
function renderGrid(){
  const g=q('#grid');if(!g)return;
  let h=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(w=>`<div class="wd">${w}</div>`).join('');
  if(S.month==='oct'){
    for(const d of [27,28,29,30])h+=`<div class="day out"><span class="dn">${d}</span></div>`;
    for(let d=1;d<=31;d++){const es=S.entries.filter(e=>e.d===d).map(e=>`<span class="ent ${e.k}" id="${e.id}">${e.t}</span>`).join('');
      h+=`<div class="day" id="d${d}"><span class="dn${d===7?' today':''}" id="dn${d}">${d}</span>${es}</div>`;}
  }else{
    for(let d=1;d<=30;d++)h+=`<div class="day"><span class="dn">${d}</span>${d===5?'<span class="ent offer">07:15</span>':''}${d===19?'<span class="ent request">05:00</span>':''}</div>`;
    for(const d of [1,2,3,4,5])h+=`<div class="day out"><span class="dn">${d}</span></div>`;
  }
  g.innerHTML=h;
  q('#month').textContent=S.month==='oct'?'October 2026':'November 2026';
  q('#nOffer').textContent=S.entries.filter(e=>e.k==='offer').length;
  q('#nMatch').textContent=S.entries.filter(e=>e.k==='matched').length;
}
function mineRows(){
  const matched=S.entries.some(e=>e.id==='e24'&&e.k==='matched'),posted=S.entries.some(e=>e.id==='e24');
  q('#mineList').innerHTML=(posted?`<div class="row"><span class="pill ${matched?'matched':'offer'}">${matched?'Matched':'Offering'}</span><h4>HFA 853 · First officer</h4><p>Sat, 24 Oct · 10:50–17:50</p><div class="acts"><span class="btn sm">Details</span>${matched?'<span class="btn sm" id="bUnmatch">Cancel match</span>':'<span class="btn sm">Edit</span>'}<span class="btn sm danger">Delete</span></div></div>`:'')+
   `<div class="row"><span class="pill request">Requesting</span><h4>Duty shift · First officer</h4><p>Thu, 15 Oct · 05:00–17:00</p><div class="acts"><span class="btn sm">Details</span><span class="btn sm" id="bEdit">Edit</span><span class="btn sm danger" id="bDelete">Delete</span></div></div>`;
}

/* ---------- screen helpers ---------- */
function page(id){for(const p of ['Cal','Mine','Inbox','Set']){q('#pg'+p).classList.toggle('hide',p!==id);q('#t'+p).classList.toggle('on',p===id);} if(id==='Mine')mineRows();}
function sheet(eye,title,body,foot){q('#shEye').textContent=eye;q('#shTitle').textContent=title;q('#shBody').innerHTML=body;q('#shFoot').innerHTML=foot;q('#shBody').scrollTop=0;q('#sheet').classList.add('show');q('#veil').classList.add('show');}
function closeSheet(){q('#sheet').classList.remove('show');q('#veil').classList.remove('show');}
let toastT;function toast(t){const e=q('#toast');e.textContent=t;e.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>e.classList.remove('show'),2600);}
function seg(on,off){q('#'+on).classList.add('on');q('#'+off).classList.remove('on');}
const drow=(k,v)=>`<div class="drow"><small>${k}</small><b>${v}</b></div>`;

/* ---------- the script ---------- */
const cap=text=>({t:'cap',text}), tap=(sel,f,after)=>({t:'tap',sel,f,after}), type=(sel,text)=>({t:'type',sel,text}),
      fx=(f,ms)=>({t:'fx',f,ms}), wait=ms=>({t:'wait',ms}), hl=(sel,ms)=>({t:'hl',sel,ms});

const CH=[
 {title:'Sign in',acts:[
  cap('Open the Pilot Swap link. The first screen asks for the pilot password, which you get from whoever runs the app.'),
  type('#fPw','••••••••'),
  tap('#bContinue',()=>{q('#lgPw').classList.add('hide');q('#lgAcct').classList.remove('hide');}),
  cap('Enter your email and the name other pilots will see. Next time, use the same email to get back into your account.'),
  type('#fEmail','dana@example.com'),
  type('#fName','Dana Cohen'),
  tap('#bSignin',()=>{q('#login').classList.add('hide');q('#app').classList.remove('hide');renderGrid();},900),
 ]},
 {title:'Your calendar',acts:[
  cap('This is the shared calendar. Everyone in the group sees the same offers and requests here.'),
  hl('#summary',2600),
  cap('The strip on top counts what is open this month: flights you can take, requests for coverage, and matches.'),
  wait(1800),
  cap('Orange means someone is giving a flight or shift away. You can take it.'),hl('#lgO',2000),hl('#e12',1600),
  cap('Blue means someone needs a flight or shift covered.'),hl('#lgR',2000),hl('#e15',1400),
  cap('Green means two pilots have agreed on the exchange.'),hl('#lgG',2000),
  cap('Purple is your own flights. Only you see them.'),hl('#lgM',2000),hl('#m8',1400),
 ]},
 {title:'Moving around',acts:[
  cap('Use the arrows to change month.'),
  tap('#bNext',()=>{S.month='nov';renderGrid();},1200),
  cap('Today brings you back to the current month.'),
  tap('#bToday',()=>{S.month='oct';renderGrid();},1000),
  cap('Tap a day number to see everything on that day.'),
  tap('#dn22',()=>sheet('All listings this day','Thursday, 22 October',
    `<div class="dayitem" id="di22"><span class="pill request start">Requesting</span><b>HFA 801 · Captain</b><small>04:00–11:00 · Noa Bar</small></div>`,
    `<span class="btn" id="bCloseDay">Close</span>`),1800),
  tap('#bCloseDay',closeSheet,700),
 ]},
 {title:'Take a flight',acts:[
  cap('Tap an orange entry to see who is giving it away, when, and what they would like in return.'),
  tap('#e12',()=>sheet('Exchange details','HFA 801 · First officer',
    `<span class="pill offer">Offering</span><p class="note">Available to take · flight posted by Avi Levi</p>`+
    drow('Date and time','Mon, 12 Oct · 06:00–13:00')+drow('Flight number','HFA 801')+drow('Other crew','Ron Gal (Captain)')+drow('In return','Any morning flight next week')+
    `<label class="l">Message to this pilot (optional)</label><div class="field" id="fMsg" data-ph="I'm available to take this flight..."></div>`,
    `<span class="btn">Close</span><span class="btn primary" id="bInterest">Send interest →</span>`),1400),
  cap('Add a short message if you like, then tap Send interest.'),
  type('#fMsg','I can take it. Happy to give you my 20th in return.'),
  tap('#bInterest',()=>{closeSheet();toast('Your interest was sent to the listing owner.');},1800),
  cap('Avi gets it in his Exchange inbox and can accept or decline. You will see the answer in yours.'),
  wait(2200),
 ]},
 {title:'Post an exchange',acts:[
  cap('To give away a flight or ask for one, tap New exchange.'),
  tap('#bNew',()=>sheet('','Post a new exchange',
    `<div class="desc"><div class="lab"><svg class="svg"><use href="#wand"/></svg>Describe it in your own words</div><div class="field" id="fDesc" data-ph="e.g. Giving away 6H 123 on 14/11, 06:00–14:30…"></div>
     <div class="act"><span>We fill in the form for you to check.</span><span class="btn sm" id="bFill">Fill in the form</span></div></div>
     <label class="l">What would you like to do?</label><div class="choices"><div class="choice" id="cOffer"><b>Offer / give away</b><small>I can give a flight or shift</small></div><div class="choice" id="cReq"><b>Request / take</b><small>I'm looking for one</small></div></div>
     <label class="l">Type of duty</label><div class="choices kind"><div class="choice" id="cFlight">Flight</div><div class="choice" id="cShift">Shift</div></div>
     <div class="two"><div><label class="l">Start</label><div class="field" id="fStart" data-ph="Date & time"></div></div><div><label class="l">End</label><div class="field" id="fEnd" data-ph="Date & time"></div></div></div>
     <div class="two"><div><label class="l">Flight number</label><div class="field" id="fFlight" data-ph="e.g. HFA 801"></div></div><div><label class="l">Your role</label><div class="field" id="fRole" data-ph="Captain"></div></div></div>
     <label class="l">Other crew member</label><div class="field" id="fCrew" data-ph="Name"></div>`,
    `<span class="btn">Cancel</span><span class="btn primary" id="bPublish">Publish exchange</span>`),1200),
  cap('The quickest way: write it in a sentence, in English or Hebrew, and tap Fill in the form.'),
  type('#fDesc','Giving away HFA 853 on 24/10, 10:50-17:50, first officer, with Ron Gal'),
  tap('#bFill',()=>{q('#cOffer').classList.add('on');q('#cFlight').classList.add('on');q('#fStart').textContent='24/10/2026 10:50';q('#fEnd').textContent='24/10/2026 17:50';q('#fFlight').textContent='HFA 853';q('#fRole').textContent='First officer';q('#fCrew').textContent='Ron Gal';},1000),
  cap('Everything is filled in for you. Check it, and fix anything it got wrong.'),
  hl('#cOffer',1400),hl('#fStart',1200),hl('#fFlight',1200),
  cap('Then tap Publish exchange. It appears on everyone\'s calendar right away.'),
  tap('#bPublish',()=>{closeSheet();S.entries.push({d:24,k:'offer',t:'10:50',id:'e24'});renderGrid();toast('Exchange published for your group.');},1400),
  hl('#e24',1800),
 ]},
 {title:'Answer interest',acts:[
  cap('When someone wants your flight, a number appears on Exchange inbox.'),
  fx(()=>q('#badge').classList.remove('hide'),900),hl('#tInbox',1600),
  tap('#tInbox',()=>page('Inbox'),900),
  cap('Read their message, then tap Accept match or Decline.'),
  hl('#interest',1800),
  tap('#bAccept',()=>{q('#intPill').className='pill matched';q('#intPill').textContent='Accepted';q('#intActs').classList.add('hide');q('#intDone').classList.remove('hide');q('#badge').classList.add('hide');const e=S.entries.find(x=>x.id==='e24');if(e)e.k='matched';renderGrid();},1400),
  cap('It is now a match. You can see each other\'s email to coordinate. Every exchange still needs airline approval.'),
  wait(2400),
  tap('#tCal',()=>page('Cal'),900),
  cap('On the calendar, the flight turns green.'),
  hl('#e24',2000),
 ]},
 {title:'My listings',acts:[
  tap('#tMine',()=>page('Mine'),900),
  cap('My listings shows everything you posted. Tap Edit to change a listing, or Delete to remove it.'),
  hl('#bEdit',1500),hl('#bDelete',1500),
  cap('On a matched listing, Cancel match opens it to other pilots again.'),
  hl('#bUnmatch',2000),
 ]},
 {title:'Your own flights',acts:[
  tap('#tCal',()=>page('Cal'),900),
  cap('Purple entries are your own flights from your roster. Tap one to see the report and end times.'),
  tap('#m8',()=>sheet('My flight','HFA801, HFA802',
    `<span class="pill mine">From my roster</span><p class="note">Only you can see your imported flights.</p>`+
    drow('Report','Thu, 8 Oct · 04:20')+drow('End','Thu, 8 Oct · 11:55')+drow('Flights','HFA801, HFA802')+drow('Captain','ZUR'),
    `<span class="btn" id="bCloseDuty">Close</span><span class="btn primary" id="bOfferDuty">Offer this flight →</span>`),1400),
  cap('Offer this flight opens the exchange form already filled in, ready to publish.'),
  hl('#bOfferDuty',2000),
  tap('#bCloseDuty',closeSheet,700),
  cap('Connecting your Leon roster so these appear has its own short guide.'),
  wait(2200),
 ]},
 {title:'Settings',acts:[
  tap('#tSet',()=>page('Set'),900),
  cap('Settings apply to the phone you are using. Dark mode is easier on the eyes at night.'),
  tap('#sDark',()=>{seg('sDark','sLight');phone.classList.add('dark');},1800),
  tap('#sLight',()=>{seg('sLight','sDark');phone.classList.remove('dark');},1000),
  cap('Time zone: Local follows your phone\'s clock. UTC shows the same times for everyone.'),
  tap('#sUtc',()=>seg('sUtc','sLocal'),1400),
  tap('#sLocal',()=>seg('sLocal','sUtc'),1000),
 ]},
 {title:'Notifications on iPhone',acts:[
  cap('On iPhone, notifications only work when Pilot Swap is added to your Home Screen (iOS 16.4 or later). Start in Safari.'),
  fx(()=>{page('Cal');screen.classList.add('safari');},1400),
  cap('Tap the Share button at the bottom of Safari.'),
  tap('#bShare',()=>{q('#shareSheet').classList.add('show');},1200),
  cap('Scroll down and tap Add to Home Screen.'),
  tap('#rowA2HS',()=>{q('#a2hs').classList.add('show');},1200),
  cap('Tap Add in the top right corner.'),
  tap('#bAdd',()=>{q('#home').classList.add('show');q('#status').classList.add('light');},1700),
  cap('Pilot Swap is now on your Home Screen. From now on, always open it from this icon.'),
  hl('#icoPS',1600),
  tap('#icoPS',()=>{q('#home').classList.remove('show');q('#status').classList.remove('light');screen.classList.remove('safari');q('#shareSheet').classList.remove('show');q('#a2hs').classList.remove('show');},1200),
  cap('In the app, go to Settings and turn on the notifications you want.'),
  tap('#tSet',()=>page('Set'),900),
  tap('#nNewYes',()=>{q('#veil2').classList.add('show');q('#ialert').classList.add('show');},1200),
  cap('iPhone asks for permission. Tap Allow.'),
  tap('#bAllow',()=>{q('#veil2').classList.remove('show');q('#ialert').classList.remove('show');seg('nNewYes','nNewNo');q('#pstat').textContent='Notifications are on for this device.';},1100),
  tap('#nMyYes',()=>seg('nMyYes','nMyNo'),1200),
  cap('Done. You will get an alert when someone posts a flight or answers you, even when the app is closed.'),
  fx(()=>q('#banner').classList.add('show'),3200),
  fx(()=>q('#banner').classList.remove('show'),600),
  cap('That\'s the whole app. Tap Restart to watch again, or pick a chapter.'),
 ]},
];

/* ---------- engine ---------- */
const finger=()=>q('#finger');
function scale(){return parseFloat(getComputedStyle(document.getElementById('scaler')).getPropertyValue('--s'))||1;}
function pos(el){const p=screen.getBoundingClientRect(),r=el.getBoundingClientRect(),s=scale();return[(r.left-p.left+r.width/2)/s,(r.top-p.top+r.height/2)/s];}
async function visible(el,run){
  const box=el.closest('.scroll');if(!box)return;
  const b=box.getBoundingClientRect(),r=el.getBoundingClientRect(),s=scale();
  if(r.top<b.top+10||r.bottom>b.bottom-10){box.scrollTo({top:box.scrollTop+(r.top-b.top)/s-(b.height/s)*0.35,behavior:reduce?'auto':'smooth'});await pace(500,run);}
}
async function pace(ms,run){let left=ms;while(left>0){if(run!==RUN)throw 0;await sleep(Math.min(left,100));if(!paused)left-=100;}}
async function moveTo(el,run){const f=finger(),[x,y]=pos(el);f.style.opacity='1';f.style.transform=`translate(${x}px,${y}px)`;await pace(750,run);}
async function press(run){const f=finger();f.classList.remove('press');void f.offsetWidth;f.classList.add('press');await pace(260,run);}
function setCap(text,instant){const p=document.getElementById('capText');if(p.textContent===text&&!p.classList.contains('fade'))return;if(instant||reduce){p.textContent=text;return;}p.classList.add('fade');setTimeout(()=>{p.textContent=text;p.classList.remove('fade');},220);}

async function exec(a,instant,run){
  const el=a.sel?q(a.sel):null;
  switch(a.t){
    case 'cap':setCap(a.text,instant);if(!instant)await pace(700,run);break;
    case 'tap':if(!instant&&el){await visible(el,run);await moveTo(el,run);await press(run);}a.f&&a.f();if(!instant)await pace(a.after??700,run);break;
    case 'type':if(instant){el.textContent=a.text;break;}await visible(el,run);await moveTo(el,run);await press(run);el.classList.add('typing');
      for(const ch of a.text){el.textContent+=ch;await pace(ch===' '?70:42,run);}el.classList.remove('typing');await pace(400,run);break;
    case 'fx':a.f();if(!instant)await pace(a.ms??600,run);break;
    case 'wait':if(!instant)await pace(a.ms,run);break;
    case 'hl':if(instant||!el)break;await visible(el,run);await moveTo(el,run);el.classList.add('ring');await pace(a.ms||1400,run);el.classList.remove('ring');break;
  }
}
function reset(){screen.innerHTML=tpl;screen.classList.remove('safari');phone.classList.remove('dark');S={month:'oct',entries:BASE.map(e=>({...e}))};}
function chapterUI(i,frac){
  document.getElementById('chNo').textContent=`Chapter ${i+1} of ${CH.length}`;
  document.getElementById('chTitle').textContent=CH[i].title;
  document.querySelectorAll('#chapters li').forEach((li,j)=>{li.classList.toggle('on',j===i);li.classList.toggle('done',j<i);});
  document.getElementById('barFill').style.width=Math.round(frac*100)+'%';
}
async function play(from){
  const run=++RUN;reset();
  for(let c=0;c<from;c++)for(const a of CH[c].acts)await exec(a,true,run);
  try{
    for(let c=from;c<CH.length;c++){
      chapterUI(c,0);
      const first=CH[c].acts.find(a=>a.t==='cap');if(first)setCap(first.text,false);
      const acts=CH[c].acts;
      for(let k=0;k<acts.length;k++){await exec(acts[k],false,run);chapterUI(c,(k+1)/acts.length);}
      await pace(900,run);
    }
    finger().style.opacity='0';setPaused(true,true);
  }catch(e){if(e!==0)throw e;}
}
function current(){return CH.findIndex(c=>c.title===document.getElementById('chTitle').textContent);}
function setPaused(p,ended){paused=p;const b=document.getElementById('bPlay');b.textContent=ended?'Watch again':p?'Play':'Pause';b.dataset.ended=ended?'1':'';}

/* ---------- controls ---------- */
const list=document.getElementById('chapters');
CH.forEach((c,i)=>{const li=document.createElement('li');li.innerHTML=`<button type="button"><span class="num">${i+1}</span>${c.title}</button>`;li.firstChild.addEventListener('click',()=>{setPaused(false);play(i);});list.appendChild(li);});
document.getElementById('bPlay').addEventListener('click',e=>{if(e.currentTarget.dataset.ended){setPaused(false);play(0);}else setPaused(!paused);});
document.getElementById('bRestart').addEventListener('click',()=>{setPaused(false);play(0);});
document.getElementById('bNextCh').addEventListener('click',()=>{setPaused(false);play(Math.min(CH.length-1,current()+1));});
document.getElementById('bPrevCh').addEventListener('click',()=>{setPaused(false);play(Math.max(0,current()-1));});

/* ---------- fit the phone to the screen ---------- */
if(location.hash==='#video')document.body.classList.add('video');
function fit(){
  const w=document.getElementById('stagewrap').clientWidth,narrow=innerWidth<=980,video=document.body.classList.contains('video');
  const s=video?Math.min(1.3,(innerHeight-330)/800,(innerWidth-40)/390):narrow?Math.min(1,(innerWidth-32)/390,(innerHeight-190)/800):Math.min(1,(w-4)/390,(innerHeight-48)/800);
  const v=Math.max(.55,s).toFixed(3);document.getElementById('scaler').style.setProperty('--s',v);phone.style.setProperty('--s',v);
}
addEventListener('resize',fit);fit();
play(0);
})();
