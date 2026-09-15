import{NextResponse}from'next/server';
import{readInventoryData,mergeInventoryData,writeInventoryData,readProducts,readMonthData}from'@/lib/db';
import{parseInventoryCsv}from'@/lib/parsers';
export const dynamic='force-dynamic';
export async function GET(request){
  const{searchParams}=new URL(request.url);const month=searchParams.get('month');
  if(!month)return NextResponse.json({error:'month required'},{status:400});
  const data=readInventoryData(month);
  if(!data||!data.snapshots?.length)return NextResponse.json({snapshots:[],products:[],summary:null});
  const productsMap=readProducts();
  const unitsSoldMap={};const monthOrders=readMonthData(month);
  if(monthOrders?.orders){for(const o of monthOrders.orders){if(!unitsSoldMap[o.item_id])unitsSoldMap[o.item_id]={units_sold:0,units_returned:0};if(o.order_type==='return')unitsSoldMap[o.item_id].units_returned+=(o.quantity||1);else unitsSoldMap[o.item_id].units_sold+=(o.quantity||1);}}
  const snapshots=data.snapshots;const allDates=[...new Set(snapshots.map(s=>s.date))].sort();const latestDate=allDates[allDates.length-1];
  const productAging={};
  for(const s of snapshots){const id=s.item_id;if(!productAging[id]){productAging[id]={item_id:id,item_name:s.item_name,cogs:productsMap[id]?.cogs||0,slabs:{'0-30 Days':0,'30-60 Days':0,'>60 Days':0},locations:{darkstore:0,same_warehouse:0,other_warehouse:0},total_units:0,total_charge:0,daily_charges:{}};}
  const p=productAging[id];const slab=s.age_slab||'';const loc=(s.location||'').toLowerCase();
  if(s.date===latestDate){if(slab.includes('0-30'))p.slabs['0-30 Days']+=s.units;else if(slab.includes('30-60'))p.slabs['30-60 Days']+=s.units;else if(slab.includes('>60')||slab.includes('60+'))p.slabs['>60 Days']+=s.units;if(loc.includes('darkstore'))p.locations.darkstore+=s.units;else if(loc.includes('different'))p.locations.other_warehouse+=s.units;else p.locations.same_warehouse+=s.units;p.total_units+=s.units;}
  p.total_charge+=s.net_charge;if(!p.daily_charges[s.date])p.daily_charges[s.date]=0;p.daily_charges[s.date]+=s.net_charge;}
  const products=Object.values(productAging).map(p=>{const days=Object.keys(p.daily_charges).length||1;const avg_daily=parseFloat((p.total_charge/days).toFixed(2));const proj_monthly=parseFloat((avg_daily*30).toFixed(2));const capital_locked=parseFloat((p.total_units*p.cogs).toFixed(2));const pct_aged=p.total_units>0?parseFloat((p.slabs['>60 Days']/p.total_units*100).toFixed(1)):0;const pct_misplaced=p.total_units>0?parseFloat(((p.locations.same_warehouse+p.locations.other_warehouse)/p.total_units*100).toFixed(1)):0;const sold=unitsSoldMap[p.item_id]||{units_sold:0,units_returned:0};const flags=[];if(pct_aged>50)flags.push({type:'danger',msg:`${pct_aged}% stock >60 days`});if(pct_misplaced>30)flags.push({type:'warning',msg:`${pct_misplaced}% at feeder WH`});if(proj_monthly>500)flags.push({type:'info',msg:`~${Math.round(proj_monthly).toLocaleString('en-IN')} ₹/month aging`});return{item_id:p.item_id,item_name:p.item_name,cogs:p.cogs,total_units:p.total_units,slabs:p.slabs,locations:p.locations,units_sold:sold.units_sold,units_returned:sold.units_returned,units_net:sold.units_sold-sold.units_returned,total_charge:parseFloat(p.total_charge.toFixed(2)),avg_daily_charge:avg_daily,proj_monthly_charge:proj_monthly,capital_locked,pct_aged_60plus:pct_aged,pct_misplaced,flags};}).sort((a,b)=>b.total_charge-a.total_charge);
  const summary={latest_date:latestDate,all_dates:allDates,total_units:products.reduce((s,p)=>s+p.total_units,0),total_charge:parseFloat(products.reduce((s,p)=>s+p.total_charge,0).toFixed(2)),proj_monthly:parseFloat(products.reduce((s,p)=>s+p.proj_monthly_charge,0).toFixed(2)),capital_locked:parseFloat(products.reduce((s,p)=>s+p.capital_locked,0).toFixed(2)),total_units_sold:products.reduce((s,p)=>s+p.units_sold,0),products_with_flags:products.filter(p=>p.flags.length>0).length};
  return NextResponse.json({month,summary,products});
}
export async function POST(request){
  try{const formData=await request.formData();const month=formData.get('month');const mode=formData.get('mode')||'merge';if(!month)return NextResponse.json({error:'month required'},{status:400});const allSnapshots=[];const errors=[];for(let i=0;i<=4;i++){const file=formData.get(`inv_${i}`);if(!file||typeof file==='string')continue;try{const buffer=Buffer.from(await file.arrayBuffer());const snapshots=parseInventoryCsv(buffer);allSnapshots.push(...snapshots);}catch(e){errors.push(`File ${i+1}: ${e.message}`);}}if(allSnapshots.length===0)return NextResponse.json({error:'No valid inventory data found',errors},{status:400});if(mode==='replace')writeInventoryData(month,{month,updated_at:new Date().toISOString(),snapshots:allSnapshots});else mergeInventoryData(month,allSnapshots);const uniqueDates=[...new Set(allSnapshots.map(s=>s.date))];const uniqueProducts=[...new Set(allSnapshots.map(s=>s.item_id))];return NextResponse.json({success:true,month,mode,errors,stats:{snapshots:allSnapshots.length,dates:uniqueDates.length,products:uniqueProducts.length}});}
  catch(err){return NextResponse.json({error:err.message},{status:500});}
}
