import { NextResponse } from 'next/server';
import { readProducts, updateCogs, deleteCogsHistory } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const map = readProducts();
  return NextResponse.json(
    Object.values(map)
      .map(p => ({
        ...p,
        cogs_history: (p.cogs_history || []).sort((a, b) =>
          b.from_month.localeCompare(a.from_month)
        ),
      }))
      .sort((a, b) => a.item_name.localeCompare(b.item_name))
  );
}

/** PUT body: array of { item_id, cogs, [target_month] }  */
export async function PUT(request) {
  const body = await request.json();
  updateCogs(Array.isArray(body) ? body : [body]);
  return NextResponse.json({ success: true });
}

/** DELETE body: { item_id, from_month } — remove one history entry */
export async function DELETE(request) {
  const { item_id, from_month } = await request.json();
  if (!item_id || !from_month)
    return NextResponse.json({ error: 'item_id and from_month required' }, { status: 400 });
  deleteCogsHistory(item_id, from_month);
  return NextResponse.json({ success: true });
}
