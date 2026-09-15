import{NextResponse}from'next/server';import{jwtVerify}from'jose';
const PUBLIC=['/login','/api/auth/login'];
export async function middleware(request){const{pathname}=request.nextUrl;if(PUBLIC.some(p=>pathname.startsWith(p)))return NextResponse.next();const token=request.cookies.get('auth_token')?.value;if(!token)return NextResponse.redirect(new URL('/login',request.url));try{const secret=new TextEncoder().encode(process.env.JWT_SECRET||'fallback');await jwtVerify(token,secret);return NextResponse.next();}catch{const res=NextResponse.redirect(new URL('/login',request.url));res.cookies.delete('auth_token');return res;}}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};
