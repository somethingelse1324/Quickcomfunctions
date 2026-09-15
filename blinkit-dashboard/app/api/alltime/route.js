import { NextResponse } from 'next/server';
import { readMonthData, readProducts, listMonths, getCogsForMonth } from '@/lib/db';
import { calculatePnL } from '@/lib/calculator';

export const dynamic = 'force-dynamic';

export async function GET() {
  const months      = listMonths();
  const productsMap = readProducts();

  if (months.length === 0) {
    return NextResponse.json({ summary: null, byMonth: [], topProducts: [] });
  }

  const byMonth      = [];
  const allTimeProds = {};

  for (const { month } of months) {
    const md = readMonthData(month); if (!md) continue;
    const sc = (md.storage || []).filter(s => s.type === 'aging');
    const uc = (md.storage || []).filter(s => s.type === 'upfront');

    // Use COGS effective for this specific month
    const monthCogs = (item_id) => getCogsForMonth(productsMap[item_id], month);

    const r = calculatePnL({
      orders: md.orders || [], storageCharges: sc, upfrontCharges: uc,
      adsCampaigns: md.ads || [], payoutSummary: md.payout || null,
      getProductCogs: monthCogs,
    });
    byMonth.push({ month, ...r.summary });

    for (const p of r.products) {
      if (!allTimeProds[p.item_id]) {
        allTimeProds[p.item_id] = {
          item_id: p.item_id, product_name: p.product_name, cogs: p.cogs,
          units_net: 0, units_sold: 0, gross_revenue: 0, ex_gst_revenue: 0,
          total_blinkit: 0, cogs_total: 0, net_profit: 0, units_returned: 0,
        };
      }
      const a = allTimeProds[p.item_id];
      a.units_net      += p.units_net;       a.units_sold      += p.units_sold;
      a.gross_revenue  += p.gross_revenue;   a.ex_gst_revenue  += p.ex_gst_revenue;
      a.total_blinkit  += p.total_blinkit;   a.cogs_total      += p.cogs_total;
      a.net_profit     += p.net_profit;      a.units_returned  += p.units_returned;
    }
  }

  const rnd = (v) => parseFloat((v || 0).toFixed(2));
  const summary = {
    months_count:   months.length,
    gross_revenue:  rnd(byMonth.reduce((s, m) => s + m.gross_revenue, 0)),
    output_gst:     rnd(byMonth.reduce((s, m) => s + (m.output_gst || 0), 0)),
    ex_gst_revenue: rnd(byMonth.reduce((s, m) => s + m.ex_gst_revenue, 0)),
    total_blinkit:  rnd(byMonth.reduce((s, m) => s + m.total_blinkit, 0)),
    ads_spend:      rnd(byMonth.reduce((s, m) => s + m.ads_spend, 0)),
    cogs_total:     rnd(byMonth.reduce((s, m) => s + m.cogs_total, 0)),
    net_profit:     rnd(byMonth.reduce((s, m) => s + m.net_profit, 0)),
    units_net:      byMonth.reduce((s, m) => s + (m.units_net || 0), 0),
    units_returned: byMonth.reduce((s, m) => s + m.units_returned, 0),
    net_payout:     rnd(byMonth.reduce((s, m) => s + m.net_payout, 0)),
    best_month:     byMonth.length ? byMonth.reduce((a, b) => a.net_profit > b.net_profit ? a : b) : null,
    worst_month:    byMonth.length ? byMonth.reduce((a, b) => a.net_profit < b.net_profit ? a : b) : null,
  };
  summary.margin_pct = summary.ex_gst_revenue > 0
    ? rnd((summary.net_profit / summary.ex_gst_revenue) * 100) : 0;

  const topProducts = Object.values(allTimeProds)
    .map(p => ({
      ...p,
      margin_pct: p.ex_gst_revenue > 0 ? rnd((p.net_profit / p.ex_gst_revenue) * 100) : 0,
    }))
    .sort((a, b) => b.net_profit - a.net_profit);

  return NextResponse.json({ summary, byMonth: byMonth.reverse(), topProducts });
}
