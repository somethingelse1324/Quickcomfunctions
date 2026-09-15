import{NextResponse}from'next/server';
import{writeMonthData,mergeMonthData,upsertProductsFromOrders,getDebugInfo}from'@/lib/db';
import{parsePayoutBreakup,parseOrderLevel,parseInventoryCharges,parseAdsReport}from'@/lib/parsers';
export const dynamic='force-dynamic';
export async function POST(request){
  try{
    let formData;try{formData=await request.formData();}catch(e){return NextResponse.json({error:`Cannot parse form: ${e.message}`},{status:400});}
    const month=formData.get('month');const mode=formData.get('mode')||'replace';
    if(!month)return NextResponse.json({error:'Month is required'},{status:400});
    const getBuffer=async(key)=>{const f=formData.get(key);if(!f||typeof f==='string')return null;return Buffer.from(await f.arrayBuffer());};
    const results={parsed:[],errors:[]};
    let payout=null;const payoutBuf=await getBuffer('payout_breakup');
    if(payoutBuf){try{payout=parsePayoutBreakup(payoutBuf);results.parsed.push('Payout Breakup');}catch(e){results.errors.push(`Payout: ${e.message}`);}}
    let orders=[];const orderBuf=await getBuffer('order_level');
    if(orderBuf){try{orders=parseOrderLevel(orderBuf);results.parsed.push('Order Level Charges');}catch(e){results.errors.push(`Orders: ${e.message}`);}}
    let storageData={aging:[],upfront:[]};const invBuf=await getBuffer('inventory_charges');
    if(invBuf){try{storageData=parseInventoryCharges(invBuf);results.parsed.push('Inventory Charges');}catch(e){results.errors.push(`Inventory: ${e.message}`);}}
    let ads=[];const adsBuf=await getBuffer('ads_report');
    if(adsBuf){try{ads=parseAdsReport(adsBuf);results.parsed.push('Ads Report');}catch(e){results.errors.push(`Ads: ${e.message}`);}}
    if(results.parsed.length===0)return NextResponse.json({error:'No files could be parsed.',errors:results.errors},{status:400});
    const newData={month,uploaded_at:new Date().toISOString(),payout,orders,storage:[...storageData.aging.map(s=>({...s,type:'aging'})),...storageData.upfront.map(s=>({...s,type:'upfront'}))],ads};
    try{if(mode==='merge')mergeMonthData(month,newData);else writeMonthData(month,newData);}
    catch(e){return NextResponse.json({error:`Failed to save: ${e.message}`,hint:'Check DATA_DIR env variable',storage_info:getDebugInfo()},{status:500});}
    try{upsertProductsFromOrders(orders);}catch(_){}
    return NextResponse.json({success:true,month,mode,parsed:results.parsed,errors:results.errors,stats:{orders:orders.length,products:[...new Set(orders.map(o=>o.item_id))].length,storageRows:storageData.aging.length,adsCampaigns:ads.length}});
  }catch(err){return NextResponse.json({error:err.message,stack:err.stack},{status:500});}
}
