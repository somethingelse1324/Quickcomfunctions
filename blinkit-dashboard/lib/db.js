import fs   from 'fs';
import path from 'path';

function getDataRoot() {
  const dir = process.env.DATA_DIR;
  if (!dir) return path.join(process.cwd(), 'data');
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

function ensureDirs() {
  const root      = getDataRoot();
  const months    = path.join(root, 'months');
  const inventory = path.join(root, 'inventory');
  if (!fs.existsSync(root))      fs.mkdirSync(root,      { recursive: true });
  if (!fs.existsSync(months))    fs.mkdirSync(months,    { recursive: true });
  if (!fs.existsSync(inventory)) fs.mkdirSync(inventory, { recursive: true });
  return { root, months, inventory };
}

const readJson  = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

// ── Products & COGS ────────────────────────────────────────────────────────────
export function readProducts() {
  const { root } = ensureDirs();
  const f = path.join(root, 'products.json');
  if (!fs.existsSync(f)) return {};
  return readJson(f) || {};
}

export function writeProducts(map) {
  const { root } = ensureDirs();
  writeJson(path.join(root, 'products.json'), map);
}

export function upsertProductsFromOrders(orders) {
  const map = readProducts();
  let changed = false;
  for (const o of orders) {
    if (!o.item_id) continue;
    if (!map[o.item_id]) {
      map[o.item_id] = {
        item_id:    o.item_id,
        item_name:  o.product_name,
        cogs:       0,
        cogs_history: [],
        updated_at: new Date().toISOString(),
      };
      changed = true;
    } else if (map[o.item_id].item_name !== o.product_name) {
      map[o.item_id].item_name = o.product_name;
      changed = true;
    }
    // Ensure cogs_history exists for older records
    if (!map[o.item_id].cogs_history) {
      map[o.item_id].cogs_history = [];
      changed = true;
    }
  }
  if (changed) writeProducts(map);
  return map;
}

/**
 * Update COGS for a list of products.
 * Each update: { item_id, cogs, [target_month] }
 *  - If target_month is provided → adds/updates a cogs_history entry for that month
 *  - If not → updates the default cogs
 */
export function updateCogs(updates) {
  const map = readProducts();
  for (const u of updates) {
    if (!map[u.item_id]) continue;
    const p = map[u.item_id];
    const newCogs = parseFloat(u.cogs) || 0;
    if (!p.cogs_history) p.cogs_history = [];

    if (u.target_month) {
      // Historical override for a specific effective-from month
      const existing = p.cogs_history.findIndex(h => h.from_month === u.target_month);
      if (existing >= 0) {
        p.cogs_history[existing].cogs = newCogs;
      } else {
        p.cogs_history.push({ from_month: u.target_month, cogs: newCogs });
      }
      // Sort descending so latest is first
      p.cogs_history.sort((a, b) => b.from_month.localeCompare(a.from_month));
    } else {
      // Update current/default COGS
      p.cogs = newCogs;
    }
    p.updated_at = new Date().toISOString();
  }
  writeProducts(map);
}

/**
 * Delete a COGS history entry for a product.
 */
export function deleteCogsHistory(item_id, from_month) {
  const map = readProducts();
  if (!map[item_id]?.cogs_history) return;
  map[item_id].cogs_history = map[item_id].cogs_history.filter(
    h => h.from_month !== from_month
  );
  map[item_id].updated_at = new Date().toISOString();
  writeProducts(map);
}

/**
 * Get the effective COGS for a product in a given month.
 * Looks through cogs_history for the most recent entry <= targetMonth.
 * Falls back to default cogs if no matching history.
 */
export function getCogsForMonth(product, targetMonth) {
  if (!product) return 0;
  if (product.cogs_history?.length && targetMonth) {
    const applicable = product.cogs_history
      .filter(h => h.from_month <= targetMonth)
      .sort((a, b) => b.from_month.localeCompare(a.from_month));
    if (applicable.length > 0) return applicable[0].cogs || 0;
  }
  return product.cogs || 0;
}

// ── Monthly order/sales data ───────────────────────────────────────────────────
export function readMonthData(month) {
  const { months } = ensureDirs();
  const f = path.join(months, `${month}.json`);
  if (!fs.existsSync(f)) return null;
  return readJson(f);
}

export function writeMonthData(month, data) {
  const { months } = ensureDirs();
  writeJson(path.join(months, `${month}.json`), data);
}

export function deleteMonth(month) {
  const { months, inventory } = ensureDirs();
  const mf = path.join(months,    `${month}.json`);
  const iv = path.join(inventory, `${month}.json`);
  if (fs.existsSync(mf)) fs.unlinkSync(mf);
  if (fs.existsSync(iv)) fs.unlinkSync(iv);
}

export function mergeMonthData(month, newData) {
  const existing = readMonthData(month);
  if (!existing) { writeMonthData(month, newData); return newData; }
  const existingIds = new Set((existing.orders || []).map(o => o.order_id));
  const merged = {
    month, uploaded_at: new Date().toISOString(),
    payout:  mergePayout(existing.payout,  newData.payout),
    orders:  [
      ...(existing.orders || []),
      ...(newData.orders  || []).filter(o => !existingIds.has(o.order_id)),
    ],
    storage: mergeStorage(existing.storage, newData.storage),
    ads:     mergeAds(existing.ads, newData.ads),
  };
  writeMonthData(month, merged);
  return merged;
}

function mergePayout(a, b) {
  if (!a) return b; if (!b) return a;
  const r = {};
  for (const k of Object.keys(a)) r[k] = (Number(a[k]) || 0) + (Number(b[k]) || 0);
  return r;
}
function mergeStorage(a, b) {
  const map = {};
  for (const s of [...(a || []), ...(b || [])]) {
    const key = `${s.item_id}__${s.type}`;
    if (!map[key]) map[key] = { ...s, total_charge: 0 };
    map[key].total_charge += s.total_charge || 0;
  }
  return Object.values(map);
}
function mergeAds(a, b) {
  const map = {};
  for (const c of [...(a || []), ...(b || [])]) {
    if (!map[c.campaign_name]) map[c.campaign_name] = {
      ...c, total_spend: 0, direct_sales: 0, indirect_sales: 0, impressions: 0, qty_sold: 0,
    };
    const m = map[c.campaign_name];
    m.total_spend += c.total_spend || 0; m.direct_sales += c.direct_sales || 0;
    m.indirect_sales += c.indirect_sales || 0; m.impressions += c.impressions || 0;
    m.qty_sold += c.qty_sold || 0;
    m.total_roas = m.total_spend > 0 ? (m.direct_sales + m.indirect_sales) / m.total_spend : 0;
  }
  return Object.values(map);
}

export function listMonths() {
  const { months } = ensureDirs();
  if (!fs.existsSync(months)) return [];
  return fs.readdirSync(months)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const m = f.replace('.json', '');
      const d = readMonthData(m);
      return { month: m, uploaded_at: d?.uploaded_at || '', order_count: d?.orders?.length || 0 };
    })
    .sort((a, b) => b.month.localeCompare(a.month));
}

// ── Inventory / Aging CSV ──────────────────────────────────────────────────────
export function readInventoryData(month) {
  const { inventory } = ensureDirs();
  const f = path.join(inventory, `${month}.json`);
  if (!fs.existsSync(f)) return null;
  return readJson(f);
}

export function writeInventoryData(month, data) {
  const { inventory } = ensureDirs();
  writeJson(path.join(inventory, `${month}.json`), data);
}

export function mergeInventoryData(month, newSnapshots) {
  const existing = readInventoryData(month);
  if (!existing) {
    writeInventoryData(month, { month, updated_at: new Date().toISOString(), snapshots: newSnapshots });
    return;
  }
  const existingKeys = new Set(
    (existing.snapshots || []).map(s => `${s.date}__${s.item_id}__${s.warehouse_id}__${s.age_slab}__${s.location}`)
  );
  writeInventoryData(month, {
    month, updated_at: new Date().toISOString(),
    snapshots: [
      ...(existing.snapshots || []),
      ...newSnapshots.filter(s =>
        !existingKeys.has(`${s.date}__${s.item_id}__${s.warehouse_id}__${s.age_slab}__${s.location}`)
      ),
    ],
  });
}

// ── Debug ──────────────────────────────────────────────────────────────────────
export function getDebugInfo() {
  const root = getDataRoot();
  const { months, inventory } = ensureDirs();
  return {
    cwd: process.cwd(), data_dir_env: process.env.DATA_DIR || '(not set)',
    data_root: root, months_dir: months, inventory_dir: inventory,
    root_exists:     fs.existsSync(root),
    products_exists: fs.existsSync(path.join(root, 'products.json')),
    month_files:     fs.existsSync(months)    ? fs.readdirSync(months)    : [],
    inventory_files: fs.existsSync(inventory) ? fs.readdirSync(inventory) : [],
  };
}
