import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ message: 'Hello from API!' });
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const agent = searchParams.get('agent');

  // Get request body if needed
  const body = await request.json().catch(() => ({}));

  return NextResponse.json({
    message: 'POST request received',
    agent,
    body,
  });
}
