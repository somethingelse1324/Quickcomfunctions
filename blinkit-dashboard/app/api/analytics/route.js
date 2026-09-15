import { NextResponse } from 'next/server';
import { readMonthData, readProducts, listMonths, getCogsForMonth } from '@/lib/db';
import { calculatePnL } from '@/lib/calculator';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  if (!month) return NextResponse.json({ error: 'month param required' }, { status: 400 });

  const monthData = readMonthData(month);
  if (!monthData) return NextResponse.json({ error: 'Month not found' }, { status: 404 });

  const productsMap = readProducts();

  // Month-aware COGS: for each product, use the effective COGS for this month
  const getProductCogs = (item_id) => getCogsForMonth(productsMap[item_id], month);

  const storageCharges = (monthData.storage || []).filter(s => s.type === 'aging');
  const upfrontCharges = (monthData.storage || []).filter(s => s.type === 'upfront');

  const result = calculatePnL({
    orders: monthData.orders || [],
    storageCharges, upfrontCharges,
    adsCampaigns:  monthData.ads     || [],
    payoutSummary: monthData.payout  || null,
    getProductCogs,
  });

  // MoM trend — last 6 months
  const allMonths = listMonths().slice(0, 6).reverse();
  const trend = allMonths.map(({ month: m }) => {
    const md = readMonthData(m); if (!md) return { month: m };
    const sc = (md.storage || []).filter(s => s.type === 'aging');
    const uc = (md.storage || []).filter(s => s.type === 'upfront');
    const trendCogs = (item_id) => getCogsForMonth(productsMap[item_id], m);
    const r = calculatePnL({
      orders: md.orders || [], storageCharges: sc, upfrontCharges: uc,
      adsCampaigns: md.ads || [], payoutSummary: md.payout || null,
      getProductCogs: trendCogs,
    });
    return { month: m, ...r.summary };
  });

  return NextResponse.json({ ...result, trend });
}
