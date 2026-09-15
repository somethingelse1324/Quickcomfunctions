import * as XLSX from 'xlsx';

const n = (v) => { const f = parseFloat(v); return isNaN(f) ? 0 : f; };

// ─────────────────────────────────────────────────────────────────
// Payout Breakup — auto-detects OLD (S.No. at col 1) vs NEW (col 0)
// ─────────────────────────────────────────────────────────────────
export function parsePayoutBreakup(buffer) {
  const wb   = XLSX.read(buffer, { type: 'buffer' });
  const ws   = wb.Sheets['Payout Breakup'];
  if (!ws) throw new Error('Sheet "Payout Breakup" not found');
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Old format: col 0 always null, S.No. at col 1 (numeric 1,2,3...), Total at col 5
  // New format: S.No. at col 0 (A,B1,B2...), Total at col 4
  let snoCol = 0, partCol = 1, netCol = 4;
  for (const row of rows.slice(0, 15)) {
    if (!row) continue;
    if (row[0] == null && row[1] != null && !isNaN(Number(row[1])) && row[2]) {
      snoCol = 1; partCol = 2; netCol = 5; break;
    }
    if (row[0] != null && row[1] != null) {
      snoCol = 0; partCol = 1; netCol = 4; break;
    }
  }
  const isOld = (snoCol === 1);

  const r = {
    customer_payable_net: 0, commission: 0, gst_commission: 0,
    shipping: 0, gst_shipping: 0, return_charge: 0, gst_return: 0,
    tcs: 0, tds: 0, upfront_storage: 0, gst_upfront: 0,
    storage_charge: 0, gst_storage: 0, recall: 0, courier: 0,
    ads_refund: 0, lost_damaged: 0, tcs_reimb: 0, tds_reimb: 0,
    other_cdn: 0, other_deductions: 0, net_payout: 0,
  };

  for (const row of rows) {
    if (!row) continue;
    const sno        = String(row[snoCol]  ?? '').trim();
    const particular = String(row[partCol] ?? '').toLowerCase().trim();
    const total      = n(row[netCol]);

    if (isOld) {
      switch (sno) {
        case '1':  r.customer_payable_net = total; break;
        case '2':  r.commission   = total; break;
        case '3':  r.shipping     = total; break;
        case '4':  r.return_charge= total; break;
        case '5':  r.tcs          = total; break;
        case '6':  r.tds          = total; break;
        case '7':  r.lost_damaged = total; break;
        case '8':  r.tds_reimb    = total; break;
        case '9':  r.tcs_reimb    = total; break;
        case '17': r.storage_charge = total; break;
        case '18': r.ads_refund   = total; break;
        case '19': r.recall       = total; break;
        case '20': r.courier      = total; break;
      }
      if (!sno || sno === 'null') {
        if      (particular.includes('gst on commission')) r.gst_commission = total;
        else if (particular.includes('gst on shipping'))   r.gst_shipping   = total;
        else if (particular.includes('gst on return'))     r.gst_return     = total;
        else if (particular.includes('gst on storage'))    r.gst_storage    = total;
      }
    } else {
      switch (sno) {
        case 'A':  r.customer_payable_net = total; break;
        case 'B1': r.commission    = total; break;
        case 'B2': r.shipping      = total; break;
        case 'B3': r.return_charge = total; break;
        case 'B4': r.tcs           = total; break;
        case 'B5': r.tds           = total; break;
        case 'C1': r.upfront_storage = total; break;
        case 'C2': r.recall        = total; break;
        case 'C3': r.storage_charge= total; break;
        case 'C4': r.courier       = total; break;
        case 'D1': r.ads_refund    = total; break;
        case 'D2': r.lost_damaged  = total; break;
        case 'D3': r.tcs_reimb     = total; break;
        case 'D4': r.tds_reimb     = total; break;
        case 'D5': r.other_cdn     = total; break;
        case 'E':  r.other_deductions = total; break;
      }
      if (!sno || sno === 'null') {
        if      (particular.includes('gst on commission'))           r.gst_commission = total;
        else if (particular.includes('gst on shipping'))             r.gst_shipping   = total;
        else if (particular.includes('gst on customer return'))      r.gst_return     = total;
        else if (particular.includes('gst on upfront'))              r.gst_upfront    = total;
        else if (particular.includes('gst on storage'))              r.gst_storage    = total;
      }
    }
    if (particular.includes('net payout in this cycle')) r.net_payout = total;
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────
// Order Level Charges
//   NEW: single sheet "Forward & Return Orders", headers at row 2
//   OLD: "Forward Orders" + "Cancelled or Returned Orders"
//        title at row 0, blanks rows 1-3, headers at row 4, blank row 5, data from row 6
// ─────────────────────────────────────────────────────────────────
export function parseOrderLevel(buffer) {
  const wb         = XLSX.read(buffer, { type: 'buffer' });
  const sheetNames = wb.SheetNames;
  if (sheetNames.includes('Forward & Return Orders')) return parseNewOrderSheet(wb);
  if (sheetNames.includes('Forward Orders'))           return parseOldOrderSheets(wb);
  throw new Error(
    `No recognisable order sheet. Found: ${sheetNames.join(', ')}`
  );
}

function parseNewOrderSheet(wb) {
  const ws      = wb.Sheets['Forward & Return Orders'];
  const rows    = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const headers = rows[2]; if (!headers) return [];
  const h = {};
  headers.forEach((hdr, i) => { if (hdr) h[String(hdr).trim()] = i; });
  return buildOrders(rows, 3, h, 'new');
}

function parseOldOrderSheets(wb) {
  const orders = [];
  const fwdWs = wb.Sheets['Forward Orders'];
  if (fwdWs) {
    const rows    = XLSX.utils.sheet_to_json(fwdWs, { header: 1, defval: null });
    const headers = rows[4]; // headers at row 4
    if (headers) {
      const h = {};
      headers.forEach((hdr, i) => { if (hdr) h[String(hdr).trim()] = i; });
      orders.push(...buildOrders(rows, 5, h, 'forward')); // data from row 5 (row 6 = first real data)
    }
  }
  const retName = wb.SheetNames.find(
    s => s === 'Cancelled or Returned Orders' || s === 'Return Orders'
  );
  const retWs = retName ? wb.Sheets[retName] : null;
  if (retWs) {
    const rows    = XLSX.utils.sheet_to_json(retWs, { header: 1, defval: null });
    const headers = rows[4];
    if (headers) {
      const h = {};
      headers.forEach((hdr, i) => { if (hdr) h[String(hdr).trim()] = i; });
      orders.push(...buildOrders(rows, 5, h, 'return'));
    }
  }
  return orders;
}

function buildOrders(rows, startRow, h, defaultType) {
  const orders  = [];
  const idCol   = h['Order ID'] ?? h['Return Order ID'];
  if (idCol == null) return orders;

  for (let i = startRow; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some(v => v != null)) continue;      // skip all-null rows
    const rawId = r[idCol];
    if (rawId == null || rawId === '') continue;
    // Skip header text appearing in data area
    if (rawId === 'Order ID' || rawId === 'Return Order ID') continue;

    const item_id = String(r[h['Item ID']] ?? '').trim();
    if (!item_id) continue;

    let order_type;
    if (defaultType === 'new') {
      order_type = String(r[h['Order Type']] ?? 'forward').trim().toLowerCase();
    } else {
      order_type = h['Order Type'] != null
        ? String(r[h['Order Type']] ?? defaultType).trim().toLowerCase()
        : defaultType;
    }

    const gross = n(r[h['Total Gross Bill Amount']]);
    const tax   = n(r[h['Total Tax']]);

    orders.push({
      order_id:       String(rawId),
      order_type,
      item_id,
      product_name:   String(r[h['Product Name']] ?? ''),
      quantity:       n(r[h['Quantity']]) || 1,
      selling_price:  n(r[h['Selling Price (Rs)']]),
      gross_amount:   gross,
      total_tax:      tax,
      ex_gst_amount:  gross - tax,
      commission:     n(r[h['Commission Charge (Rs)']]),
      commission_gst: n(r[h['Commission GST (Rs)']]),
      shipping:       n(r[h['Shipping Charge (Rs)']]),
      shipping_gst:   n(r[h['Shipping GST (Rs)']]),
      tds:            n(r[h['TDS 194O Amount']]) + n(r[h['TDS 194Q Amount']]),
      tcs:            n(r[h['TCS Amount']]),
      item_payout:    n(r[h['Item Level Payout']]),
      order_date:     String(r[h['Order Date']] ?? r[h['Return Order Date']] ?? ''),
    });
  }
  return orders;
}

// ─────────────────────────────────────────────────────────────────
// Inventory / Storage Charges (C file)
//   NEW: sheets "Aging Charge" + "Upfront Charge", headers at row 2
//   OLD: sheets "Daily Ageing" + "Ageing Reversal" + "Upfront Storage Charges"
//        row 0 = sheet title, row 1 = headers, data from row 2
//        columns: State|Item ID|Item Name|Per day charge|Total unit×days|
//                 Unit Charge|Regime|Ageing Slab|Total Charge (Rs)|date1|date2...
//        Reversals already have negative Total Charge values.
// ─────────────────────────────────────────────────────────────────
export function parseInventoryCharges(buffer) {
  const wb         = XLSX.read(buffer, { type: 'buffer' });
  const sheetNames = wb.SheetNames;
  if (sheetNames.includes('Daily Ageing')) return parseOldInventory(wb);
  return parseNewInventory(wb);
}

function parseNewInventory(wb) {
  function parseSheet(sheetName, amtCol) {
    const ws = wb.Sheets[sheetName]; if (!ws) return [];
    const rows    = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const headers = rows[2]; if (!headers) return [];
    const h = {};
    headers.forEach((hdr, i) => { if (hdr) h[String(hdr).trim()] = i; });
    const map = {};
    for (let i = 3; i < rows.length; i++) {
      const r  = rows[i]; if (!r) continue;
      const id = String(r[h['Item ID']] ?? '').trim();
      const nm = String(r[h['Item Name']] ?? '').trim();
      const amt = n(r[h[amtCol]]);
      if (!id) continue;
      if (!map[id]) map[id] = { item_id: id, item_name: nm, total: 0 };
      map[id].total += amt;
    }
    return Object.values(map).map(x => ({
      item_id: x.item_id, item_name: x.item_name,
      total_charge: parseFloat(x.total.toFixed(2)),
    }));
  }
  return {
    aging:   parseSheet('Aging Charge',   'Net amount after reversal and credit notes (Rs)'),
    upfront: parseSheet('Upfront Charge', 'Total Charge (Rs)'),
  };
}

function parseOldInventory(wb) {
  // Helper: find header row by looking for 'Item ID' at col 1
  function findHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      if (rows[i] && String(rows[i][1] ?? '').trim() === 'Item ID') return i;
    }
    return 1; // fallback: row 1
  }

  const agingMap = {};

  // Both "Daily Ageing" and "Ageing Reversal" have the same structure.
  // "Total Charge (Rs)" is already negative for reversals — just sum them.
  for (const sheetName of ['Daily Ageing', 'Ageing Reversal']) {
    const ws = wb.Sheets[sheetName]; if (!ws) continue;
    const rows      = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const headerIdx = findHeaderRow(rows);
    const h = {};
    rows[headerIdx].forEach((hdr, i) => { if (hdr) h[String(hdr).trim()] = i; });

    const itemIdCol      = h['Item ID'];
    const itemNameCol    = h['Item Name'];
    const totalChargeCol = h['Total Charge (Rs)'];
    if (itemIdCol == null || totalChargeCol == null) continue;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const id = String(r[itemIdCol] ?? '').trim();
      if (!id || id === 'Item ID') continue;
      const nm  = String(r[itemNameCol] ?? '').trim();
      const amt = n(r[totalChargeCol]);  // negative for reversals = correct
      if (!agingMap[id]) agingMap[id] = { item_id: id, item_name: nm, total: 0 };
      agingMap[id].total += amt;
    }
  }

  const aging = Object.values(agingMap).map(x => ({
    item_id: x.item_id, item_name: x.item_name,
    total_charge: parseFloat(x.total.toFixed(2)),
  }));

  // "Upfront Storage Charges" — find header row by 'S.No.' at col 0
  const upfrontMap = {};
  const upfrontWs  = wb.Sheets['Upfront Storage Charges'];
  if (upfrontWs) {
    const rows = XLSX.utils.sheet_to_json(upfrontWs, { header: 1, defval: null });
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      if (rows[i] && String(rows[i][0] ?? '').trim() === 'S.No.') { headerIdx = i; break; }
    }
    if (headerIdx >= 0) {
      const h = {};
      rows[headerIdx].forEach((hdr, i) => { if (hdr) h[String(hdr).trim()] = i; });
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const r  = rows[i]; if (!r) continue;
        const id = String(r[h['Item ID']] ?? '').trim();
        const nm = String(r[h['Item Name']] ?? '').trim();
        const amt = n(r[h['Total Charge (Rs)']]);
        if (!id) continue;
        if (!upfrontMap[id]) upfrontMap[id] = { item_id: id, item_name: nm, total: 0 };
        upfrontMap[id].total += amt;
      }
    }
  }

  const upfront = Object.values(upfrontMap).map(x => ({
    item_id: x.item_id, item_name: x.item_name,
    total_charge: parseFloat(x.total.toFixed(2)),
  }));

  return { aging, upfront };
}

// ─────────────────────────────────────────────────────────────────
// Aging / Inventory CSV (bi-monthly seller_data export)
// ─────────────────────────────────────────────────────────────────
export function parseInventoryCsv(buffer) {
  const wb   = XLSX.read(buffer, { type: 'buffer' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  const snapshots = [];
  for (const row of rows) {
    const item_id = String(row['Item ID'] ?? '').trim();
    if (!item_id) continue;
    snapshots.push({
      date:            String(row['Date'] ?? '').trim(),
      item_id,
      item_name:       String(row['Item Name'] ?? '').trim(),
      warehouse_id:    String(row['Purchase Warehouse ID'] ?? '').trim(),
      warehouse_name:  String(row['Purchase Warehouse Name'] ?? '').trim(),
      location:        String(row['Present Location of Inventory'] ?? '').trim(),
      age_slab:        String(row['Age Slab'] ?? '').trim(),
      units:           n(row['Sellable Inventory (in Units)']),
      per_unit_charge: String(row['Per unit charge (Rs)'] ?? '').trim(),
      gross_charge:    n(row['Aging Amount (Rs)']),
      gst_charge:      n(row['GST (Rs)']),
      net_charge:      n(row['Net amount after reversal and credit notes (Rs)']),
    });
  }
  return snapshots;
}

// ─────────────────────────────────────────────────────────────────
// Ads Report
// ─────────────────────────────────────────────────────────────────
export function parseAdsReport(buffer) {
  const wb   = XLSX.read(buffer, { type: 'buffer' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  const map  = {};
  for (const row of rows) {
    const name = String(row['Campaign Name'] ?? '').trim();
    if (!name) continue;
    if (!map[name]) map[name] = {
      campaign_name: name, total_spend: 0, direct_sales: 0,
      indirect_sales: 0, impressions: 0, qty_sold: 0, roas_sum: 0, roas_count: 0,
    };
    const c = map[name];
    c.total_spend    += n(row['Estimated Budget Consumed']);
    c.direct_sales   += n(row['Direct Sales']);
    c.indirect_sales += n(row['Indirect Sales']);
    c.impressions    += n(row['Impressions']);
    c.qty_sold       += n(row['Direct Quantities Sold']);
    const roas = n(row['Total RoAS']);
    if (roas) { c.roas_sum += roas; c.roas_count++; }
  }
  return Object.values(map).map(c => ({
    campaign_name:  c.campaign_name,
    total_spend:    parseFloat(c.total_spend.toFixed(2)),
    direct_sales:   parseFloat(c.direct_sales.toFixed(2)),
    indirect_sales: parseFloat(c.indirect_sales.toFixed(2)),
    impressions:    c.impressions,
    qty_sold:       c.qty_sold,
    total_roas:     c.roas_count ? parseFloat((c.roas_sum / c.roas_count).toFixed(2)) : 0,
  }));
}
