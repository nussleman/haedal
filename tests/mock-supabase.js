(function(){
const cats=[['지출','식비','외식','🍜'],['지출','식비','식료품','🍜'],['지출','주거','관리비/공과금','🏠'],['지출','교통/차량','택시','🚖'],['지출','문화생활','공연','🎫'],['수입','근로소득','월급','💰'],['수입','투자 수익','배당금','💸'],['이체','투자 자산','증권 계좌','📈'],['이체','연금 자산','연금저축','🧓']];
const tx=[];let id=1;
for(let m=0;m<15;m++){const d=new Date(2025,6+m,1);const y=d.getFullYear(),mo=d.getMonth()+1;
 for(let k=0;k<22;k++){const c=cats[(k*7+m)%cats.length];const day=1+((k*3+m)%27);
  const amt=c[0]==='수입'?(c[2]==='월급'?3200000:12000+k*100):c[0]==='이체'?300000:8000+((k*13+m*7)%40)*1000;
  tx.push({id:id++,category_id:(k%9)+1,date:`${y}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}`,kind:c[0],category:c[1],subcategory:c[2],emoji_category:c[3],amount:amt,merchant_group:k%4?'':'마트',merchant:'가게'+(k%6),note:k%5?'':'메모',good_bad:k%9===0?'Bad':k%11===0?'Good':null,company_paid:false,is_fixed:c[1]==='주거'});}}
const snaps=[];let sid=1;for(let m=0;m<15;m++){const d=new Date(2025,6+m,1);const mm=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
 [['현금 자산','월급 통장',2000000+m*50000],['투자 자산','증권 계좌',60000000+m*800000],['저축 자산','CMA',9000000+m*100000],['연금 자산','퇴직연금',13000000+m*200000]].forEach(([c,a,v])=>snaps.push({id:sid++,month:mm,asset_class:c,account:a,amount:v}));}
const idx=[];for(let m=0;m<20;m++){const d=new Date(2025,1+m,1);idx.push({month:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`,close:6000+m*80});}
const fx={v_transactions:tx,asset_snapshots:snaps,index_prices:idx,
 goals:[{id:1,period:'2026 하반기',kind:'자산',item:'비상금',frequency:null,target_amount:10000000,target_ratio:null,status:'진행중',achieved_on:null,note:null,metric_source:'asset_class',position:1},{id:2,period:'2026 하반기',kind:'지출',item:'고정비',frequency:'월',target_amount:400000,target_ratio:null,status:'진행중',achieved_on:null,note:null,position:2},{id:4,period:'2027 상반기',kind:'자산',item:'총 자산',frequency:null,target_amount:150000000,target_ratio:null,status:'대기',achieved_on:null,note:null,position:3}],
 stocks:[{id:1,name:'로켓 랩',ticker:'RKLB',market:'US',category:null,themes:['우주'],is_active:true},{id:2,name:'삼성전자',ticker:'005930',market:'KR',category:null,themes:['반도체'],is_active:true}],
 categories:cats.map((c,i)=>({id:i+1,kind:c[0],category:c[1],subcategory:c[2],emoji_category:c[3],sort_order:i,is_active:true})),
 accounts:[{id:1,name:'월급 통장',asset_class:'현금 자산',sort_order:0,is_active:true},{id:2,name:'증권 계좌',asset_class:'투자 자산',sort_order:1,is_active:true}],
 merchants:[],app_settings:[{key:'dashboard_settings',value:{emergencyAccount:'CMA',brokerAccount:'증권 계좌',idleAccounts:['퇴직연금']}}],study_cards:[],trade_log:[],merchant_groups:[],toss_summary:[{as_of:'2026-09-28T12:44:00Z',value:7120000,cost:6000000,pl:1120000,pl_rate:0.1867,cash:300000,total:7420000,fx:1390,count:2,daily:12000}],toss_holdings:[{symbol:'RKLB',name:'로켓 랩',country:'US',currency:'USD',qty:20,avg:40,last:74,value_krw:2057200,cost_krw:1112000,pl_krw:945200,pl_rate:0.85},{symbol:'005930',name:'삼성전자',country:'KR',currency:'KRW',qty:10,avg:60000,last:70000,value_krw:700000,cost_krw:600000,pl_krw:100000,pl_rate:0.1667}],toss_daily:[{date:'2026-09-26',total:7300000,value:7000000,cost:6000000,pl:1000000,pl_rate:0.1667},{date:'2026-09-27',total:7350000,value:7050000,cost:6000000,pl:1050000,pl_rate:0.175},{date:'2026-09-28',total:7420000,value:7120000,cost:6000000,pl:1120000,pl_rate:0.1867}],stock_facts:[{name:'로켓 랩',ticker:'RKLB',type_ko:'옵션형',price:'74',checks:{},nums:{eps:'-0.28',mcap:'44256'},memo:'[A] 심층 분석 대상'},{name:'삼성전자',ticker:'005930',type_ko:'사이클형',price:'70000',checks:{},nums:{eps:'5000'},memo:'[B] 유형만'}]};
function q(table){let res={data:fx[table]||[],error:null};
 const p=new Proxy(function(){},{get(t,k){if(k==='then')return (ok,bad)=>Promise.resolve(res).then(ok,bad);
  if(k==='range')return (a,b)=>{res={...res,data:(res.data||[]).slice(a,b+1)};return p};
  if(k==='eq')return (col,val)=>{if(Array.isArray(res.data)&&res.data.length&&col in res.data[0])res={...res,data:res.data.filter(r=>r[col]===val)};return p};
  if(k==='single'||k==='maybeSingle')return ()=>{res={...res,data:(res.data||[])[0]||null};return p};
  return ()=>p;},apply(){return p}});return p;}
window.__SB_MOD={createClient:()=>({from:q,rpc:()=>q('rpc'),functions:{invoke:async()=>({data:{},error:null})},
 auth:{getSession:async()=>({data:{session:{user:{id:'u',email:'a@b.c'},access_token:'x'}}}),getUser:async()=>({data:{user:{id:'u',email:'a@b.c'}}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({})},storage:{from:()=>q('x')}})};
const RealDate=Date;const FIXED=new RealDate('2026-09-28T12:00:00+09:00').getTime();
window.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[FIXED]))} static now(){return FIXED}};
Math.random=(()=>{let s=1;return()=>(s=(s*16807)%2147483647)/2147483647})();
})();
