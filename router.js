/* Halton offline router: loads halton.bin (OpenStreetMap © contributors), geocodes, routes, orders stops, draws map. */
(function(root){
'use strict';
const ABBR={STREET:'ST',AVENUE:'AVE',DRIVE:'DR',CRESCENT:'CRES',COURT:'CRT',CT:'CRT',ROAD:'RD',BOULEVARD:'BLVD',PLACE:'PL',LN:'LANE',CIRCLE:'CIR',CIRCUIT:'CIRCT',TERRACE:'TERR',TRAIL:'TRAIL',TRL:'TRAIL',LANDING:'LANDNG',HEIGHTS:'HTS',SQUARE:'SQ',PARKWAY:'PKY',PKWY:'PKY',GARDENS:'GDNS',HIGHWAY:'HWY',SIDEROAD:'SR',CONCESSION:'CONC',POINT:'PT',CROSSING:'CROSS',PARK:'PK',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W',SAINT:'ST',MOUNT:'MT',GATEWAY:'GTWY',GROVE:'GROVE',LINE:'LINE',COMMON:'COMMON',CRESENT:'CRES',CR:'CRES',CRCL:'CIR',CIRCL:'CIR',TER:'TERR',ESTATES:'ESTATE',HILLS:'HILL'};
const norm=s=>String(s||'').toUpperCase().replace(/[.,']/g,' ').split(/\s+/).filter(Boolean).map(t=>ABBR[t]||t).join(' ');
const CITY_ALIAS={'NORTH YORK':'Toronto',TORONTO:'Toronto',MISSISSAUGA:'Mississauga',GEORGETOWN:'Halton Hills',ACTON:'Halton Hills','HALTON HILLS':'Halton Hills',MILTON:'Milton',BURLINGTON:'Burlington',OAKVILLE:'Oakville'};
let MX=0.807,MY=1.113; // metres per quantum; set from the file's header in build()

class Heap{constructor(){this.k=[];this.v=[]}push(key,val){const k=this.k,v=this.v;let i=k.length;k.push(key);v.push(val);while(i>0){const p=(i-1)>>1;if(k[p]<=key)break;k[i]=k[p];v[i]=v[p];i=p}k[i]=key;v[i]=val}
 pop(){const k=this.k,v=this.v,top=v[0],lk=k.pop(),lv=v.pop(),n=k.length;if(n){let i=0;for(;;){let c=2*i+1;if(c>=n)break;if(c+1<n&&k[c+1]<k[c])c++;if(k[c]>=lk)break;k[i]=k[c];v[i]=v[c];i=c}k[i]=lk;v[i]=lv}return top}
 topKey(){return this.k[0]}get size(){return this.k.length}}

function parse(buf){
  const dv=new DataView(buf),L=dv.getUint32(0,true),hdr=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,4,L))),base=4+L,A={};
  const T={u16:Uint16Array,u32:Uint32Array,u8:Uint8Array,i8:Int8Array};
  for(const s of hdr.sections)A[s.name]=new T[s.type](buf,base+s.offset,s.count);
  return{hdr,A};
}

function build(buf){
  const{hdr,A}=parse(buf),nx=A.nx,ny=A.ny,N=nx.length,W=A.wCls.length,ws=A.wStart,wn=A.wNodes;
  MY=111320/hdr.q;MX=MY*Math.cos(43.6*Math.PI/180);root.HaltonRouter.MX=MX;root.HaltonRouter.MY=MY;
  const toQ=(lon,lat)=>[(lon-hdr.bbox[0])*hdr.q,(lat-hdr.bbox[1])*hdr.q];
  // junctions
  const use=new Uint8Array(N);
  for(let w=0;w<W;w++){const s=ws[w],e=ws[w+1];for(let i=s;i<e;i++){const n=wn[i];if(use[n]<3)use[n]+=(i===s||i===e-1)?2:1}}
  const vid=new Int32Array(N).fill(-1);let V=0;
  for(let n=0;n<N;n++)if(use[n]>=2)vid[n]=V++;
  const vNode=new Int32Array(V);for(let n=0;n<N;n++)if(vid[n]>=0)vNode[vid[n]]=n;
  // edges
  const eu=[],ev=[],ec=[],ew=[],ea=[],eb=[];
  for(let w=0;w<W;w++){const s=ws[w],e=ws[w+1],sp=Math.max(5,A.wSp[w])/3.6,ow=A.wOw[w];let start=s,len=0;
    for(let i=s+1;i<e;i++){const a=wn[i-1],b=wn[i],dx=(nx[b]-nx[a])*MX,dy=(ny[b]-ny[a])*MY;len+=Math.sqrt(dx*dx+dy*dy);
      if(vid[b]>=0){const u=vid[wn[start]],v=vid[b],t=len/sp+(A.wCls[w]>=5?2:1);
        if(ow>=0){eu.push(u);ev.push(v);ec.push(t);ew.push(w);ea.push(start);eb.push(i)}
        if(ow<=0){eu.push(v);ev.push(u);ec.push(t);ew.push(w);ea.push(i);eb.push(start)}
        start=i;len=0}}}
  const E=eu.length,head=new Int32Array(V+1);for(let i=0;i<E;i++)head[eu[i]+1]++;for(let i=0;i<V;i++)head[i+1]+=head[i];
  const fill=head.slice(0,V),eTo=new Int32Array(E),eC=new Float32Array(E),eW=new Int32Array(E),eA=new Int32Array(E),eB=new Int32Array(E);
  for(let i=0;i<E;i++){const p=fill[eu[i]]++;eTo[p]=ev[i];eC[p]=ec[i];eW[p]=ew[i];eA[p]=ea[i];eB[p]=eb[i]}
  // reverse graph (for reaching a stop from every other point we only need forward runs; kept small)
  // snap grid over junctions of local roads (class >=2, not links)
  const G=400,gx=Math.ceil(65536/G),grid=new Map();
  const vOk=new Uint8Array(V);
  for(let w=0;w<W;w++){const c=A.wCls[w];if(c<2||c===7)continue;for(let i=ws[w];i<ws[w+1];i++){const v=vid[wn[i]];if(v>=0)vOk[v]=1}}
  // keep only the main strongly-connected network (reachable both ways from central Milton)
  {const tail=new Int32Array(E);for(let u=0;u<V;u++)for(let e=head[u];e<head[u+1];e++)tail[e]=u;
   const rh=new Int32Array(V+1);for(let e=0;e<E;e++)rh[eTo[e]+1]++;for(let i=0;i<V;i++)rh[i+1]+=rh[i];const rf=rh.slice(0,V),rs=new Int32Array(E);for(let e=0;e<E;e++)rs[rf[eTo[e]]++]=tail[e];
   let c=0,bd=1e18;const[cx,cy]=toQ(-79.88,43.51);for(let v=0;v<V;v++){if(!vOk[v])continue;const n=vNode[v],d=(nx[n]-cx)**2+(ny[n]-cy)**2;if(d<bd){bd=d;c=v}}
   const f=new Uint8Array(V),r=new Uint8Array(V);let q=[c];f[c]=1;while(q.length){const u=q.pop();for(let e=head[u];e<head[u+1];e++){const v=eTo[e];if(!f[v]){f[v]=1;q.push(v)}}}
   q=[c];r[c]=1;while(q.length){const u=q.pop();for(let i=rh[u];i<rh[u+1];i++){const v=rs[i];if(!r[v]){r[v]=1;q.push(v)}}}
   for(let v=0;v<V;v++)if(!(f[v]&&r[v]))vOk[v]=0;}
  for(let v=0;v<V;v++){if(!vOk[v])continue;const n=vNode[v],k=Math.floor(nx[n]/G)*gx+Math.floor(ny[n]/G);let a=grid.get(k);if(!a)grid.set(k,a=[]);a.push(v)}
  // name index
  const names=hdr.names,nameIdx=new Map();names.forEach((n,i)=>nameIdx.set(n,i));
  const addrBy=new Map();for(let i=0;i<A.aName.length;i++){const k=A.aName[i];let a=addrBy.get(k);if(!a)addrBy.set(k,a=[]);a.push(i)}
  const wayBy=new Map();for(let w=0;w<W;w++){const k=A.wName[w];if(!k)continue;let a=wayBy.get(k);if(!a)wayBy.set(k,a=[]);a.push(w)}
  // city centroids
  const cs=new Map();for(let i=0;i<A.aCity.length;i++){const c=hdr.cities[A.aCity[i]];if(!c)continue;let o=cs.get(c);if(!o)cs.set(c,o={x:0,y:0,n:0});o.x+=A.aX[i];o.y+=A.aY[i];o.n++}
  const cityC=new Map();for(const[c,o]of cs)if(o.n>50)cityC.set(c,{x:o.x/o.n,y:o.y/o.n});
  // way bboxes + grid for drawing
  const wb=new Uint16Array(W*4),DG=2000,dgx=Math.ceil(65536/DG),dgrid=new Map();
  for(let w=0;w<W;w++){let x0=65535,y0=65535,x1=0,y1=0;for(let i=ws[w];i<ws[w+1];i++){const n=wn[i];if(nx[n]<x0)x0=nx[n];if(nx[n]>x1)x1=nx[n];if(ny[n]<y0)y0=ny[n];if(ny[n]>y1)y1=ny[n]}
    wb.set([x0,y0,x1,y1],w*4);for(let gxi=Math.floor(x0/DG);gxi<=Math.floor(x1/DG);gxi++)for(let gyi=Math.floor(y0/DG);gyi<=Math.floor(y1/DG);gyi++){const k=gxi*dgx+gyi;let a=dgrid.get(k);if(!a)dgrid.set(k,a=[]);a.push(w)}}
  const ll2q=(lon,lat)=>toQ(lon,lat),q2ll=(x,y)=>[x/hdr.q+hdr.bbox[0],y/hdr.q+hdr.bbox[1]];
  return{ll2q,q2ll,MX,MY,hdr,A,N,V,vNode,vid,head,eTo,eC,eW,eA,eB,grid,G,gx,nameIdx,addrBy,wayBy,cityC,wb,dgrid,DG,dgx,names};
}

function canonCity(c){c=String(c||'').trim().toUpperCase();return CITY_ALIAS[c]||(c?c[0]+c.slice(1).toLowerCase():'')}

function geocode(M,address,city){
  const A=M.A,m=/^\s*(\d+)\s*([A-Z])?\s+(.+)$/i.exec(String(address||'').toUpperCase());if(!m)return null;
  const num=+m[1],cc=canonCity(city);let st=norm(m[3]);
  let k=M.nameIdx.get(st);
  if(k==null){const alt=[st.replace(/\s+[NSEW]$/,''),st+' N',st+' S',st+' E',st+' W'];for(const a of alt){if(M.nameIdx.has(a)){k=M.nameIdx.get(a);break}}}
  if(k==null)return null;
  const cen=M.cityC.get(cc);
  let pts=(M.addrBy.get(k)||[]).map(i=>({n:A.aNum[i],x:A.aX[i],y:A.aY[i],c:M.hdr.cities[A.aCity[i]]}));
  if(cc){const same=pts.filter(p=>p.c===cc);if(same.length)pts=same;else if(cen)pts=pts.filter(p=>Math.hypot((p.x-cen.x)*MX,(p.y-cen.y)*MY)<9000)}
  if(pts.length){
    const ex=pts.find(p=>p.n===num);if(ex)return{x:ex.x,y:ex.y,how:'exact'};
    const par=pts.filter(p=>p.n%2===num%2),P=par.length?par:pts;
    let lo=null,hi=null;for(const p of P){if(p.n<num&&(!lo||p.n>lo.n))lo=p;if(p.n>num&&(!hi||p.n<hi.n))hi=p}
    if(lo&&hi&&hi.n!==lo.n&&Math.hypot((hi.x-lo.x)*MX,(hi.y-lo.y)*MY)<3000){const t=(num-lo.n)/(hi.n-lo.n);return{x:lo.x+(hi.x-lo.x)*t,y:lo.y+(hi.y-lo.y)*t,how:'near'}}
    const p=lo&&hi?(num-lo.n<hi.n-num?lo:hi):(lo||hi);return{x:p.x,y:p.y,how:'near'};
  }
  let ways=M.wayBy.get(k)||[];if(!ways.length)return null;
  const mid=w=>{const s=A.wStart[w],e=A.wStart[w+1],n=A.wNodes[(s+e)>>1];return{x:A.nx[n],y:A.ny[n]}};
  if(cen){const near=ways.filter(w=>{const p=mid(w);return Math.hypot((p.x-cen.x)*MX,(p.y-cen.y)*MY)<9000});if(near.length)ways=near}
  const ms=ways.map(mid);ms.sort((a,b)=>a.x-b.x);const p=ms[ms.length>>1];return{x:p.x,y:p.y,how:'street'};
}

function snap(M,x,y){
  const{grid,G,gx,vNode,A}=M;let best=-1,bd=1e18;
  for(let r=1;r<=4&&best<0;r++){const cx=Math.floor(x/G),cy=Math.floor(y/G);
    for(let i=cx-r;i<=cx+r;i++)for(let j=cy-r;j<=cy+r;j++){const a=grid.get(i*gx+j);if(!a)continue;for(const v of a){const n=vNode[v],dx=(A.nx[n]-x)*MX,dy=(A.ny[n]-y)*MY,d=dx*dx+dy*dy;if(d<bd){bd=d;best=v}}}}
  return best;
}

function dijkstra(M,src,targets,keepPrev){
  const V=M.V,dist=new Float32Array(V).fill(Infinity),prev=keepPrev?new Int32Array(V).fill(-1):null,done=new Uint8Array(V);
  const want=new Set(targets);let left=want.size;dist[src]=0;const h=new Heap();h.push(0,src);
  while(h.size){const d=h.topKey(),u=h.pop();if(done[u])continue;done[u]=1;if(want.has(u)&&--left<=0)break;
    for(let e=M.head[u];e<M.head[u+1];e++){const v=M.eTo[e],nd=d+M.eC[e];if(nd<dist[v]){dist[v]=nd;if(prev)prev[v]=e;h.push(nd,v)}}}
  return{dist,prev};
}

function pathGeom(M,prev,src,dst){
  const A=M.A,segs=[];let v=dst,guard=0;
  while(v!==src&&prev[v]>=0&&guard++<100000){const e=prev[v];segs.push(e);let u=-1;// find tail: search edge owner
    u=M._tail[e];v=u}
  const pts=[];segs.reverse();
  for(const e of segs){const a=M.eA[e],b=M.eB[e],st=a<b?1:-1;for(let i=a;i!==b+st;i+=st){const n=A.wNodes[i];pts.push(A.nx[n],A.ny[n])}}
  return pts;
}

function ensureTail(M){if(M._tail)return;const t=new Int32Array(M.eTo.length);for(let u=0;u<M.V;u++)for(let e=M.head[u];e<M.head[u+1];e++)t[e]=u;M._tail=t}

// matrix of seconds between points (vertex ids)
function matrix(M,vs){const n=vs.length,mat=[];for(let i=0;i<n;i++){const{dist}=dijkstra(M,vs[i],vs.filter((_,j)=>j!==i));mat.push(vs.map(v=>dist[v]===Infinity?1e7:dist[v]))}return mat}

// order an open path through idx[] starting from s (index or -1), with optional end-bias toward set endT (indices)
function orderSection(mat,idx,s,endT,wEnd){
  if(idx.length<=1)return idx.slice();
  const endCost=last=>endT&&endT.length?wEnd*Math.min(...endT.map(t=>mat[last][t])):0;
  const cost=seq=>{let c=s>=0?mat[s][seq[0]]:0;for(let i=1;i<seq.length;i++)c+=mat[seq[i-1]][seq[i]];return c+endCost(seq[seq.length-1])};
  const starts=s>=0?[null]:idx;let best=null,bc=Infinity;
  for(const st of starts){const rest=idx.filter(x=>x!==st),seq=st==null?[]:[st];let cur=st==null?s:st;
    while(rest.length){let bi=0,bv=Infinity;rest.forEach((x,i)=>{const c=mat[cur][x];if(c<bv){bv=c;bi=i}});cur=rest.splice(bi,1)[0];seq.push(cur)}
    // 2-opt
    let imp=true,it=0;while(imp&&it++<60){imp=false;for(let i=0;i<seq.length-1;i++)for(let j=i+1;j<seq.length;j++){const t=seq.slice(0,i).concat(seq.slice(i,j+1).reverse(),seq.slice(j+1));if(cost(t)+1e-6<cost(seq)){seq.splice(0,seq.length,...t);imp=true}}}
    const c=cost(seq);if(c<bc){bc=c;best=seq}}
  return best;
}

root.HaltonRouter={norm,build,geocode,snap,dijkstra,matrix,orderSection,ensureTail,pathGeom,MX,MY,canonCity};
})(typeof window!=='undefined'?window:globalThis);
