'use client';
import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';

const fmtMonth = (m) => {
  if (!m) return '';
  const [y, mo] = m.split('-');
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
};

function CogsHistoryRow({ product, onRefresh }) {
  const [adding, setAdding]   = useState(false);
  const [month, setMonth]     = useState('');
  const [cogsVal, setCogsVal] = useState('');
  const [saving, setSaving]   = useState(false);

  const handleAdd = async () => {
    if (!month || !cogsVal) return;
    setSaving(true);
    await fetch('/api/products', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ item_id: product.item_id, cogs: parseFloat(cogsVal), target_month: month }]),
    });
    setSaving(false); setAdding(false); setMonth(''); setCogsVal(''); onRefresh();
  };

  const handleDelete = async (from_month) => {
    if (!confirm(`Remove COGS override for ${fmtMonth(from_month)}?`)) return;
    await fetch('/api/products', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: product.item_id, from_month }),
    });
    onRefresh();
  };

  const history = product.cogs_history || [];

  return (
    <div className="px-5 pb-3 bg-blue-50/40 border-t border-blue-100">
      <p className="text-xs font-semibold text-blue-700 mt-2 mb-1.5">
        📅 COGS History
        <span className="text-gray-400 font-normal ml-2">
          (when your purchase price changed, add an entry — calculator uses it automatically)
        </span>
      </p>

      {history.length === 0 && !adding && (
        <p className="text-xs text-gray-400 mb-2">No overrides — current COGS (₹{product.cogs}) used for all months.</p>
      )}

      {history.map(h => (
        <div key={h.from_month} className="flex items-center gap-3 mb-1.5">
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium w-28 text-center">
            From {fmtMonth(h.from_month)}
          </span>
          <span className="text-xs font-medium text-gray-800">₹{h.cogs}</span>
          <button
            onClick={() => handleDelete(h.from_month)}
            className="text-xs text-red-400 hover:text-red-600 ml-1"
          >✕</button>
        </div>
      ))}

      {adding ? (
        <div className="flex items-center gap-2 mt-2">
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
          <span className="text-xs text-gray-500">→</span>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">₹</span>
            <input type="number" min="0" step="0.01" value={cogsVal} onChange={e => setCogsVal(e.target.value)}
              placeholder="COGS" className="border border-gray-300 rounded pl-5 pr-2 py-1 text-xs w-24 focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
          <button onClick={handleAdd} disabled={saving || !month || !cogsVal}
            className="text-xs bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600 disabled:opacity-50">
            {saving ? '…' : 'Save'}
          </button>
          <button onClick={() => { setAdding(false); setMonth(''); setCogsVal(''); }}
            className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="text-xs text-blue-600 hover:text-blue-800 underline mt-1">
          + Add override for specific month
        </button>
      )}
    </div>
  );
}

export default function ProductsPage() {
  const [products, setProducts]   = useState([]);
  const [edits, setEdits]         = useState({});
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [search, setSearch]       = useState('');
  const [expanded, setExpanded]   = useState({});

  const load = () => {
    fetch('/api/products', { cache: 'no-store' }).then(r => r.json()).then(data => {
      setProducts(data);
      const init = {};
      data.forEach(p => { init[p.item_id] = p.cogs ?? 0; });
      setEdits(init);
    });
  };

  useEffect(() => { load(); }, []);

  const filtered    = products.filter(p =>
    p.item_name.toLowerCase().includes(search.toLowerCase()) || p.item_id.includes(search)
  );
  const hasPending  = products.some(p => Number(edits[p.item_id]) !== Number(p.cogs));
  const missingCogs = products.filter(p => !p.cogs || p.cogs === 0).length;

  async function saveAll() {
    setSaving(true);
    await fetch('/api/products', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.entries(edits).map(([item_id, cogs]) => ({ item_id, cogs }))),
    });
    load();
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Products & COGS</h1>
            <p className="text-sm text-gray-500">
              Auto-populated from uploads. Enter cost per unit (excl. GST).
              Click <strong>▸ History</strong> to add past prices.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm text-green-600 font-medium">✅ Saved!</span>}
            <button onClick={saveAll} disabled={saving || !hasPending}
              className="btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Current COGS'}
            </button>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 mb-5">
          <p className="font-semibold mb-0.5">💡 How COGS affects profit</p>
          <p>
            <strong>Net Profit = Ex-GST Revenue − Blinkit Charges − COGS × net units.</strong>
            &nbsp;Enter current purchase price here. Use <strong>▸ History</strong> to record a different
            price for older months — it's applied automatically when recalculating past data.
          </p>
        </div>

        {products.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-4xl mb-3">🛍️</p>
            <h2 className="text-xl font-semibold text-gray-700 mb-2">No Products Yet</h2>
            <a href="/upload" className="btn-primary inline-block mt-2">Upload Files First</a>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <input type="text" placeholder="Search by product name or Item ID…"
                value={search} onChange={e => setSearch(e.target.value)} className="input w-full text-sm" />
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">
                  <th className="text-left px-5 py-3">Product</th>
                  <th className="text-left px-4 py-3">Item ID</th>
                  <th className="text-right px-4 py-3 w-40">Current COGS (₹)</th>
                  <th className="text-center px-4 py-3 w-28">History</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const changed = Number(edits[p.item_id]) !== Number(p.cogs);
                  const hasHistory = (p.cogs_history || []).length > 0;
                  const isExpanded = expanded[p.item_id];

                  return (
                    <>
                      <tr key={p.item_id}
                        className={`border-t border-gray-50 hover:bg-gray-50 ${changed ? 'bg-amber-50/40' : ''}`}>
                        <td className="px-5 py-3 font-medium text-gray-800">
                          <div>{p.item_name}</div>
                          {hasHistory && (
                            <div className="text-xs text-blue-500 mt-0.5">
                              {p.cogs_history.length} historical override{p.cogs_history.length > 1 ? 's' : ''}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-400">{p.item_id}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {changed && <span className="text-xs text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">edited</span>}
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                              <input type="number" min="0" step="0.01"
                                value={edits[p.item_id] ?? ''}
                                onChange={e => setEdits(prev => ({
                                  ...prev,
                                  [p.item_id]: e.target.value === '' ? 0 : parseFloat(e.target.value),
                                }))}
                                className="input w-32 pl-7 text-right text-sm" placeholder="0.00" />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => setExpanded(prev => ({ ...prev, [p.item_id]: !prev[p.item_id] }))}
                            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                              isExpanded
                                ? 'bg-blue-100 border-blue-300 text-blue-700'
                                : 'border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'
                            }`}
                          >
                            {isExpanded ? '▾ Hide' : '▸ History'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${p.item_id}-history`}>
                          <td colSpan={4} className="p-0">
                            <CogsHistoryRow product={p} onRefresh={load} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>

            <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400 flex justify-between">
              <span>{filtered.length} products</span>
              {missingCogs > 0 && (
                <span className="text-amber-500">⚠️ {missingCogs} missing COGS — profit understated</span>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
