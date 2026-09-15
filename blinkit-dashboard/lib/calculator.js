const round = (v) => parseFloat((v || 0).toFixed(2));

/**
 * Per product:
 *   Ex-GST Revenue = gross_amount − total_tax  (18% GST on all items)
 *                    Backward compat: if ex_gst_amount missing, derive from gross × 100/118
 *   Net Profit = Ex-GST Revenue − Commission(+GST) − Shipping(+GST)
 *              − TDS − TCS − Storage − Return Handling (B3) − COGS × units_net
 *
 * Account-level:
 *   Net Profit = Σ product profits − Ads Spend
 *
 * @param {Function} getProductCogs  optional fn(item_id) → cogs value
 *                                   if omitted, cogsMap is used directly
 */
export function calculatePnL({ orders, storageCharges, upfrontCharges, adsCampaigns, payoutSummary, cogsMap, getProductCogs }) {
  const productMap = {};

  for (const o of orders) {
    const id = o.item_id;
    if (!productMap[id]) {
      const cogs = getProductCogs ? getProductCogs(id) : (cogsMap?.[id] ?? 0);
      productMap[id] = {
        item_id: id, product_name: o.product_name, cogs,
        units_forward: 0, units_return: 0,
        gross_revenue: 0, total_tax: 0, ex_gst_revenue: 0,
        commission: 0, commission_gst: 0, shipping: 0, shipping_gst: 0,
        tds: 0, tcs: 0, item_payout: 0,
        storage_aging: 0, storage_upfront: 0, return_charge: 0,
      };
    }
    const p = productMap[id];

    if (o.order_type === 'return') {
      p.units_return += (o.quantity || 1);
    } else {
      p.units_forward += (o.quantity || 1);
    }

    const gross = o.gross_amount || 0;
    // Backward-compat: derive ex_gst from gross if field missing (all items 18% GST)
    const ex_gst = (o.ex_gst_amount != null && o.ex_gst_amount !== 0)
      ? o.ex_gst_amount
      : gross * 100 / 118;
    const tax = (o.total_tax != null && o.total_tax !== 0)
      ? o.total_tax
      : gross * 18 / 118;

    p.gross_revenue  += gross;
    p.total_tax      += tax;
    p.ex_gst_revenue += ex_gst;
    p.commission     += o.commission     || 0;
    p.commission_gst += o.commission_gst || 0;
    p.shipping       += o.shipping       || 0;
    p.shipping_gst   += o.shipping_gst   || 0;
    p.tds            += o.tds            || 0;
    p.tcs            += o.tcs            || 0;
    p.item_payout    += o.item_payout    || 0;
  }

  for (const sc of (storageCharges || []))  { if (productMap[sc.item_id]) productMap[sc.item_id].storage_aging   += sc.total_charge || 0; }
  for (const uc of (upfrontCharges || []))  { if (productMap[uc.item_id]) productMap[uc.item_id].storage_upfront += uc.total_charge || 0; }

  // Allocate B3 (return handling fee) proportionally by returns per product
  const totalReturns = Object.values(productMap).reduce((s, p) => s + p.units_return, 0);
  const b3Total = payoutSummary
    ? Math.abs(payoutSummary.return_charge || 0) + Math.abs(payoutSummary.gst_return || 0)
    : 0;
  if (b3Total > 0 && totalReturns > 0) {
    for (const p of Object.values(productMap)) {
      p.return_charge = parseFloat(((p.units_return / totalReturns) * b3Total).toFixed(2));
    }
  }

  const totalAdsSpend = (adsCampaigns || []).reduce((s, c) => s + (c.total_spend || 0), 0);

  const products = Object.values(productMap).map((p) => {
    const units_net     = p.units_forward - p.units_return;
    const cogs_total    = (p.cogs || 0) * Math.max(units_net, 0);
    const total_blinkit = Math.abs(p.commission)     + Math.abs(p.commission_gst)
                        + Math.abs(p.shipping)       + Math.abs(p.shipping_gst)
                        + Math.abs(p.tds)            + Math.abs(p.tcs)
                        + Math.abs(p.storage_aging)  + Math.abs(p.storage_upfront)
                        + Math.abs(p.return_charge);
    const net_profit    = p.ex_gst_revenue - total_blinkit - cogs_total;
    const margin_pct    = p.ex_gst_revenue > 0 ? (net_profit / p.ex_gst_revenue) * 100 : 0;
    const return_rate   = p.units_forward  > 0 ? (p.units_return / p.units_forward) * 100 : 0;

    return {
      item_id:         p.item_id,
      product_name:    p.product_name,
      cogs:            p.cogs || 0,
      units_sold:      p.units_forward,
      units_returned:  p.units_return,
      units_net,
      gross_revenue:   round(p.gross_revenue),
      output_gst:      round(p.total_tax),
      ex_gst_revenue:  round(p.ex_gst_revenue),
      commission:      round(p.commission),
      commission_gst:  round(p.commission_gst),
      shipping:        round(p.shipping),
      shipping_gst:    round(p.shipping_gst),
      tds:             round(p.tds),
      tcs:             round(p.tcs),
      storage_aging:   round(p.storage_aging),
      storage_upfront: round(p.storage_upfront),
      return_charge:   round(p.return_charge),
      total_blinkit:   round(total_blinkit),
      cogs_total:      round(cogs_total),
      net_profit:      round(net_profit),
      margin_pct:      round(margin_pct),
      return_rate_pct: round(return_rate),
    };
  });

  const ex_gst_revenue     = round(products.reduce((s, p) => s + p.ex_gst_revenue,  0));
  const gross_revenue      = round(products.reduce((s, p) => s + p.gross_revenue,   0));
  const output_gst         = round(products.reduce((s, p) => s + p.output_gst,      0));
  const total_blinkit_all  = round(products.reduce((s, p) => s + p.total_blinkit,   0));
  const cogs_total         = round(products.reduce((s, p) => s + p.cogs_total,      0));
  const net_profit_pre_ads = round(products.reduce((s, p) => s + p.net_profit,      0));
  const net_profit         = round(net_profit_pre_ads - totalAdsSpend);

  const summary = {
    gross_revenue, output_gst, ex_gst_revenue,
    total_blinkit:    total_blinkit_all,
    ads_spend:        round(totalAdsSpend),
    net_payout:       payoutSummary?.net_payout ?? round(gross_revenue - total_blinkit_all),
    cogs_total, net_profit_pre_ads, net_profit,
    units_sold:       products.reduce((s, p) => s + p.units_sold, 0),
    units_returned:   products.reduce((s, p) => s + p.units_returned, 0),
    units_net:        products.reduce((s, p) => s + p.units_net, 0),
    commission:       round(products.reduce((s, p) => s + Math.abs(p.commission) + Math.abs(p.commission_gst), 0)),
    shipping:         round(products.reduce((s, p) => s + Math.abs(p.shipping)   + Math.abs(p.shipping_gst), 0)),
    storage:          round(products.reduce((s, p) => s + Math.abs(p.storage_aging) + Math.abs(p.storage_upfront), 0)),
    tds_tcs:          round(products.reduce((s, p) => s + Math.abs(p.tds) + Math.abs(p.tcs), 0)),
    return_charge:    round(b3Total),
    margin_pct:       ex_gst_revenue > 0 ? round((net_profit / ex_gst_revenue) * 100) : 0,
    return_rate:      products.reduce((s, p) => s + p.units_sold, 0) > 0
                        ? round(products.reduce((s, p) => s + p.units_returned, 0) /
                                products.reduce((s, p) => s + p.units_sold, 0) * 100)
                        : 0,
  };

  return { summary, products, adsCampaigns: adsCampaigns || [] };
}
