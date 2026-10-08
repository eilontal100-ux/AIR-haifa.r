(function(){
'use strict';
// Where each chapter starts in /tour.mp4, in seconds.
const CH=[{"title": "Sign in", "t": 0}, {"title": "Your calendar", "t": 15.1}, {"title": "Moving around", "t": 31.4}, {"title": "Take a flight", "t": 43.0}, {"title": "Post an exchange", "t": 58.4}, {"title": "Answer interest", "t": 86.7}, {"title": "My listings", "t": 109.5}, {"title": "Connect Leon", "t": 119.4}, {"title": "Your own flights", "t": 156.8}, {"title": "Settings", "t": 169.5}, {"title": "Notifications on iPhone", "t": 184.1}];
const video=document.getElementById('video'),list=document.getElementById('chapters');
CH.forEach((c,i)=>{const li=document.createElement('li'),b=document.createElement('button');b.type='button';
  b.innerHTML=`<span class="num">${i+1}</span>`;b.append(c.title);
  b.addEventListener('click',()=>{video.currentTime=c.t+0.05;mark();video.play().catch(()=>{});});li.append(b);list.append(li);});
function mark(){let i=0;CH.forEach((c,j)=>{if(video.currentTime>=c.t)i=j;});
  list.querySelectorAll('li').forEach((li,j)=>{li.classList.toggle('on',j===i);li.classList.toggle('done',j<i);});}
video.addEventListener('timeupdate',mark);video.addEventListener('seeked',mark);mark();
})();
