import{NextResponse}from'next/server';import{getDebugInfo}from'@/lib/db';
export const dynamic='force-dynamic';
export async function GET(){try{return NextResponse.json({ok:true,...getDebugInfo()});}catch(err){return NextResponse.json({ok:false,error:err.message},{status:500});}}
