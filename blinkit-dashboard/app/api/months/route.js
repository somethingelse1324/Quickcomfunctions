import{NextResponse}from'next/server';import{listMonths,deleteMonth}from'@/lib/db';
export const dynamic='force-dynamic';
export async function GET(){return NextResponse.json(listMonths());}
export async function DELETE(request){const{month}=await request.json();if(!month)return NextResponse.json({error:'month required'},{status:400});deleteMonth(month);return NextResponse.json({success:true,deleted:month});}
