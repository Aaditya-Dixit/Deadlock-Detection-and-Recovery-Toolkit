
let state = { p:{}, r:{}, hold:[], req:[], dead:new Set(), nodes:{}, wfgNodes:{}, cycleText:"" };

let initialState = JSON.parse(JSON.stringify({
  p:{}, r:{}, hold:[], req:[], dead:[], nodes:{}, wfgNodes:{}, cycleText:""
}));

let history = [];
let future = [];

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const selP = document.getElementById("p");
const selR = document.getElementById("r");
const stateBadge = document.getElementById("stateBadge");

function resize(){
canvas.width = window.innerWidth*0.65;
canvas.height = window.innerHeight*0.85;
}
window.onresize=()=>{resize(); layout(); refresh();};
resize();

function saveState(){
  const copy = JSON.parse(JSON.stringify({
    ...state,
    dead: [...state.dead]
  }));
  history.push(copy);
  if(history.length > 50) history.shift();
  future = [];
}

/* ADD */
function addProcess(){
const id = pid.value.trim();
if(!id) return;
if(state.p[id]){
explain("Process with this name already exists");
return;
}
saveState();
state.p[id]={};
layout(); refresh();
explain(`Process ${id} added`);
}

function addResource(){
saveState();
const id = rid.value.trim();
const inst = parseInt(document.getElementById("inst").value) || 1;
if(!id) return;
state.r[id]={inst,used:0};
layout(); refresh();
explain(`Resource ${id} added`);
}

/* ASSIGN */
function assign(){
saveState();
const pId=selP.value;
const rId=selR.value;
if(!pId||!rId) return;

const res=state.r[rId];
if(res.used>=res.inst) return;

state.hold.push({p:pId,r:rId});
res.used++;
state.p[pId].rolledBack = false;

refresh();
explain(`${pId} holds ${rId}`);
}

/* REQUEST */
function request(){
saveState();
const pId=selP.value;
const rId=selR.value;
if(!pId||!rId) return;

state.req.push({p:pId,r:rId});
state.p[pId].rolledBack = false;

refresh();
explain(`${pId} requests ${rId}`);
}

/* DETECT */
function oldDetect(){
state.dead=new Set();
state.cycleText="";

const g={};
Object.keys(state.p).forEach(x=>g[x]=[]);

state.req.forEach(req=>{
state.hold.forEach(h=>{
if(h.r===req.r && h.p!==req.p){
g[req.p].push(h.p);
}
});
});

let visited={},stack={};

function dfs(v,path=[]){
visited[v]=1; stack[v]=1;

for(let n of g[v]){
if(!visited[n]){
dfs(n,[...path,v]);
}
else if(stack[n]){
const cycle=[...path,v,n];
cycle.forEach(x=>state.dead.add(x));
state.cycleText=cycle.join(" → ");
}
}
stack[v]=0;
}

Object.keys(g).forEach(x=>{
if(!visited[x]) dfs(x,[]);
});
}

function detect(){
state.dead=new Set();
state.cycleText="";

const processes=Object.keys(state.p);
const resources=Object.keys(state.r);
const work={};
const allocation={};
const request={};

resources.forEach(rid=>{
work[rid]=Math.max(0,state.r[rid].inst-state.r[rid].used);
});

processes.forEach(pid=>{
allocation[pid]={};
request[pid]={};
resources.forEach(rid=>{
allocation[pid][rid]=0;
request[pid][rid]=0;
});
});

state.hold.forEach(h=>{
if(allocation[h.p] && state.r[h.r]) allocation[h.p][h.r]++;
});

state.req.forEach(req=>{
if(request[req.p] && state.r[req.r]) request[req.p][req.r]++;
});

const finish={};
processes.forEach(pid=>finish[pid]=false);

let changed=true;
while(changed){
changed=false;

for(let pid of processes){
if(finish[pid]) continue;

let canComplete=true;
for(let rid of resources){
if(request[pid][rid] > work[rid]){
canComplete=false;
break;
}
}

if(canComplete){
resources.forEach(rid=>{
work[rid]+=allocation[pid][rid];
});
finish[pid]=true;
changed=true;
}
}
}

processes.forEach(pid=>{
let holdsResource=resources.some(rid=>allocation[pid][rid]>0);
let waitsForResource=resources.some(rid=>request[pid][rid]>0);
if(!finish[pid] && holdsResource && waitsForResource){
state.dead.add(pid);
}
});

if(state.dead.size){
state.cycleText=[...state.dead].join(" -> ");
}
}

/* RECOVERY */
function addRequestIfMissing(pId,rId){
  if(state.p[pId] && state.r[rId] && !state.req.find(req=>req.p===pId && req.r===rId)){
    state.req.push({p:pId,r:rId});
  }
}

function reassignReleasedResources(resourceIds,blockedProcess){
  let assigned = [];

  resourceIds.forEach(rid=>{
    if(!state.r[rid]) return;

    let waiting = state.req.find(req=>req.r===rid && req.p!==blockedProcess);
    if(waiting && state.r[rid].used < state.r[rid].inst){
      state.hold.push({p:waiting.p,r:rid});
      state.req = state.req.filter(req=>!(req.p===waiting.p && req.r===rid));
      state.r[rid].used++;
      assigned.push(`${rid} to ${waiting.p}`);
    }
  });

  return assigned;
}

function kill(){
  const victim = document.getElementById("killSelect").value;
  if(!victim) return;

  saveState();

  let released = state.hold.filter(h=>h.p===victim).map(h=>h.r);

  state.hold = state.hold.filter(h=>h.p!==victim);
  state.req  = state.req.filter(r=>r.p!==victim);

  released.forEach(rid=>{
    if(state.r[rid]) state.r[rid].used = Math.max(0,state.r[rid].used-1);
  });

  delete state.p[victim];
  delete state.nodes[victim];

  reassignReleasedResources(released,victim);

  layout();
  refresh();

  explain(`Killed ${victim}, resources reassigned`);
}

function oldPreempt(){
  const victim = document.getElementById("preemptSelect").value;
  if(!victim){
    explain("No process selected for preemption");
    return;
  }

  saveState();

  // ✅ FIXED: reliable detection
  let heldResources = [];
  for(let h of state.hold){
    if(h.p === victim){
      heldResources.push(h.r);
    }
  }

  if(heldResources.length === 0){
    explain(`${victim} has no resources to preempt`);
    return;
  }

  // Remove victim's resources
  state.hold = state.hold.filter(h => h.p !== victim);

  heldResources.forEach(rid => {
    if(state.r[rid]) state.r[rid].used--;
  });

  // Remove process
  delete state.p[victim];
  delete state.nodes[victim];

  let reassigned = false;

  // Reassign resources
  for(let rid of heldResources){
    let waiting = state.req.find(req => req.r === rid);

    if(waiting){
      state.hold.push({p: waiting.p, r: rid});
      state.req = state.req.filter(r => !(r.p === waiting.p && r.r === rid));
      state.r[rid].used++;
      reassigned = true;
    }
  }

  layout();
  refresh();

  if(reassigned){
    explain(`Preempted ${victim} and reassigned resources`);
  } else {
    explain(`Preempted ${victim}, resources are now free`);
  }
}
function preempt(){
  const victim = document.getElementById("preemptSelect").value;
  if(!victim){
    explain("No process selected for preemption");
    return;
  }

  let heldResources = state.hold.filter(h=>h.p===victim).map(h=>h.r);
  if(heldResources.length === 0){
    explain(`${victim} has no resources to preempt`);
    return;
  }

  saveState();

  state.hold = state.hold.filter(h=>h.p!==victim);
  heldResources.forEach(rid=>{
    if(state.r[rid]) state.r[rid].used = Math.max(0,state.r[rid].used-1);
  });

  let reassigned = reassignReleasedResources(heldResources,victim);
  heldResources.forEach(rid=>addRequestIfMissing(victim,rid));
  state.p[victim].rolledBack = false;

  layout();
  refresh();

  if(reassigned.length){
    explain(`Preempted ${victim}; assigned ${reassigned.join(", ")}. ${victim} is waiting to reacquire its resource.`);
  } else {
    explain(`Preempted ${victim}; no other process was waiting for those resources.`);
  }
}

function rollback(){
  const victim = document.getElementById("rollbackSelect").value;
  if(!victim){
    explain("No process selected for rollback");
    return;
  }

  let heldResources = state.hold.filter(h=>h.p===victim).map(h=>h.r);
  let pendingRequests = state.req.filter(req=>req.p===victim);

  if(heldResources.length === 0 && pendingRequests.length === 0){
    explain(`${victim} has no allocation or request to rollback`);
    return;
  }

  saveState();

  state.hold = state.hold.filter(h=>h.p!==victim);
  state.req = state.req.filter(req=>req.p!==victim);

  heldResources.forEach(rid=>{
    if(state.r[rid]) state.r[rid].used = Math.max(0,state.r[rid].used-1);
  });

  let reassigned = reassignReleasedResources(heldResources,victim);
  state.p[victim].rolledBack = true;

  layout();
  refresh();

  if(reassigned.length){
    explain(`Rolled back ${victim}; released resources and assigned ${reassigned.join(", ")}.`);
  } else {
    explain(`Rolled back ${victim}; its resources were released and its pending requests were cleared.`);
  }
}

/* UNDO REDO */
function undo(){
  if(!history.length) return;

  future.push({...state,dead:[...state.dead]});
  const prev = history.pop();

  state = {...prev,dead:new Set(prev.dead)};
  layout();
  refresh();
}

function redo(){
  if(!future.length) return;

  history.push({...state,dead:[...state.dead]});
  const next = future.pop();

  state = {...next,dead:new Set(next.dead)};
  layout();
  refresh();
}

function resetAll(){
  state = {...JSON.parse(JSON.stringify(initialState)),dead:new Set()};
  history=[]; future=[];
  layout(); refresh();
}

/* UI */
function refresh(){
  detect();
  updateUI();
  draw();
}

function updateUI(){
stateBadge.innerText = state.dead.size ? "Deadlock" : "Safe State";
stateBadge.classList.toggle("deadlock", state.dead.size > 0);

    let preemptSel = document.getElementById("preemptSelect");

preemptSel.innerHTML = state.hold
  .map(h => h.p)
  .filter((v,i,a)=>a.indexOf(v)===i) // unique processes
  .map(p => `<option value="${p}">${p}</option>`)
  .join("");
let rollbackSel=document.getElementById("rollbackSelect");
let killSel=document.getElementById("killSelect");

let ps=Object.keys(state.p);
let rs=Object.keys(state.r);

rollbackSel.innerHTML=ps.map(x=>`<option>${x}</option>`).join("");
killSel.innerHTML=ps.map(x=>`<option>${x}</option>`).join("");

selP.innerHTML=ps.map(x=>`<option>${x}</option>`);
selR.innerHTML=rs.map(x=>`<option>${x}</option>`);

let html="";
ps.forEach(id=>{
let s="Running";
if(state.dead.has(id)) s="Deadlock";
else if(state.req.find(x=>x.p===id)) s="Waiting";
else if(state.p[id].rolledBack) s="Rolled Back";

let color=s==="Deadlock"?"red":(s==="Waiting"?"Blue":(s==="Rolled Back"?"#1a6ef5":"green"));

html+=`<tr>
<td><strong>${id}</strong></td>
<td style="color:${color};font-weight:bold">${s}</td>
</tr>`;
});

table.innerHTML=html;
}

/* LAYOUT */
function layout(){
let p=Object.keys(state.p);
let r=Object.keys(state.r);
let splitX=Math.max(360,canvas.width*0.52);
let leftWidth=Math.max(300,splitX-70);
let rightWidth=Math.max(260,canvas.width-splitX-50);
let ragCols=Math.max(1,Math.floor(leftWidth/105));
let wfgCols=Math.max(1,Math.floor(rightWidth/105));

p.forEach((id,i)=>{
let col=i%ragCols;
let row=Math.floor(i/ragCols);
state.nodes[id]={x:75+col*105,y:125+row*80,type:"p"};
});

r.forEach((id,i)=>{
let col=i%ragCols;
let row=Math.floor(i/ragCols);
state.nodes[id]={x:75+col*105,y:325+row*80,type:"r"};
});

state.wfgNodes={};
p.forEach((id,i)=>{
let col=i%wfgCols;
let row=Math.floor(i/wfgCols);
state.wfgNodes[id]={x:splitX+70+col*105,y:145+row*85,type:"p"};
});
}

/* DRAW */
function draw(){
ctx.clearRect(0,0,canvas.width,canvas.height);
drawDivider();
drawRag();
drawWfg();
drawGraphLabels();
}

function drawRag(){
state.hold.forEach(e=>{
drawArrow(state.nodes[e.r],state.nodes[e.p],"blue",false);
});

state.req.forEach(e=>{
drawArrow(state.nodes[e.p],state.nodes[e.r],"red",true);
});

Object.entries(state.nodes).forEach(([id,n])=>{
let dead=state.dead.has(id);

ctx.beginPath();
ctx.lineWidth=dead?4:1;

if(n.type==="p"){
ctx.arc(n.x,n.y,22,0,Math.PI*2);
ctx.fillStyle=dead?"#ff0000":"#1a6ef5";
}else{
ctx.rect(n.x-22,n.y-22,44,44);
ctx.fillStyle=dead?"#ff0000":"#27ae60";
}

ctx.fill();
ctx.fillStyle="#fff";
ctx.fillText(id,n.x-10,n.y+5);
});
}

function drawWfg(){
const edges=buildWfgEdges();

edges.forEach(e=>{
drawArrow(state.wfgNodes[e.from],state.wfgNodes[e.to],"#d97706",true);
});

Object.entries(state.wfgNodes).forEach(([id,n])=>{
let dead=state.dead.has(id);

ctx.beginPath();
ctx.lineWidth=dead?4:1;
ctx.arc(n.x,n.y,22,0,Math.PI*2);
ctx.fillStyle=dead?"#ff0000":"#1a6ef5";
ctx.fill();
ctx.strokeStyle=dead?"#991b1b":"#0f4db3";
ctx.stroke();
ctx.fillStyle="#fff";
ctx.fillText(id,n.x-10,n.y+5);
});
}

function buildWfgEdges(){
const seen=new Set();
const edges=[];

state.req.forEach(req=>{
state.hold.forEach(hold=>{
if(req.r===hold.r && req.p!==hold.p && state.p[req.p] && state.p[hold.p]){
const key=`${req.p}->${hold.p}`;
if(!seen.has(key)){
seen.add(key);
edges.push({from:req.p,to:hold.p});
}
}
});
});

return edges;
}

function drawDivider(){
let splitX=Math.max(360,canvas.width*0.52);
ctx.save();
ctx.strokeStyle="rgba(15,95,89,.78)";
ctx.lineWidth=2;
ctx.setLineDash([7,7]);
ctx.beginPath();
ctx.moveTo(splitX-25,70);
ctx.lineTo(splitX-25,canvas.height-75);
ctx.stroke();
ctx.restore();
}

function drawGraphLabels(){
let splitX=Math.max(360,canvas.width*0.52);
let ragBottom=getBottomY(state.nodes);
let wfgBottom=getBottomY(state.wfgNodes);

drawGraphLabel("RAG",splitX/2,Math.min(canvas.height-32,ragBottom+58));
drawGraphLabel("WFG",(splitX+canvas.width)/2,Math.min(canvas.height-32,wfgBottom+58));
}

function getBottomY(nodes){
let values=Object.values(nodes);
if(!values.length) return 335;
return Math.max(...values.map(n=>n.y));
}

function drawGraphLabel(text,x,y){
ctx.save();
ctx.font="700 18px Arial, Helvetica, sans-serif";
ctx.textAlign="center";
ctx.fillStyle="#0f5f59";
ctx.fillText(text,x,y);
ctx.restore();
}

function drawArrow(a,b,color,dashed){
if(!a||!b) return;
let dx=b.x-a.x, dy=b.y-a.y;
let ang=Math.atan2(dy,dx);

let sx=a.x+Math.cos(ang)*26;
let sy=a.y+Math.sin(ang)*26;
let ex=b.x-Math.cos(ang)*26;
let ey=b.y-Math.sin(ang)*26;

ctx.strokeStyle=color;
ctx.fillStyle=color;
ctx.lineWidth=dashed?2:3;

if(dashed) ctx.setLineDash([6,4]);

ctx.beginPath();
ctx.moveTo(sx,sy);
ctx.lineTo(ex,ey);
ctx.stroke();

ctx.setLineDash([]);

ctx.beginPath();
ctx.moveTo(ex,ey);
ctx.lineTo(ex-10*Math.cos(ang-0.4),ey-10*Math.sin(ang-0.4));
ctx.lineTo(ex-10*Math.cos(ang+0.4),ey-10*Math.sin(ang+0.4));
ctx.closePath();
ctx.fill();
}

function explain(msg){
document.getElementById("explain").innerText="Explanation: "+msg;
}