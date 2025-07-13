import { NextResponse } from 'next/server';

const PUBLIC_ENDPOINTS = [
  '/balance',
  '/staging',
  '/tx/',
  '/pending_private_transfers'
];

const PRIVATE_ENDPOINTS = [
  '/encrypt_balance',
  '/decrypt_balance',
  '/private_transfer',
  '/view_encrypted_balance',
  '/claim_private_transfer'
];

export async function POST(request: Request) {
  try {
    const { method, endpoint, rpcUrl, payload } = await request.json();
    const privateKey = request.headers.get('X-Private-Key');
    
    console.log('Proxy Request:', { 
      method, 
      endpoint, 
      rpcUrl, 
      hasPrivateKey: !!privateKey,
      payload: payload ? { ...payload, privateKey: '***redacted***' } : null 
    });

    if (!rpcUrl || !endpoint) {
      return NextResponse.json({ error: 'Missing rpcUrl or endpoint' }, { status: 400 });
    }

    const isPublicEndpoint = PUBLIC_ENDPOINTS.some(publicEndpoint => 
      endpoint.startsWith(publicEndpoint)
    );

    const isPrivateEndpoint = PRIVATE_ENDPOINTS.some(privateEndpoint => 
      endpoint.startsWith(privateEndpoint)
    );

    // Security enhancement: Validate endpoint type
    if (!isPublicEndpoint && !isPrivateEndpoint) {
      return NextResponse.json({ error: 'Unauthorized endpoint' }, { status: 403 });
    }

    if (isPrivateEndpoint && !privateKey) {
      return NextResponse.json({ error: 'Private key required for this endpoint' }, { status: 401 });
    }

    const url = `${rpcUrl}${endpoint}`;
    console.log('Proxying to:', url);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    if (isPrivateEndpoint && privateKey) {
      headers['X-Private-Key'] = privateKey;
    }

    const options: RequestInit = {
      method: method,
      headers: headers,
      body: method === 'POST' ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(10000)
    };

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Upstream error:', {
        status: response.status,
        url,
        error: errorText
      });
      
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      
      return NextResponse.json(errorData, { 
        status: response.status 
      });
    }

    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error: any) {
    console.error('Proxy server error:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    return NextResponse.json(
      { 
        error: 'Proxy error',
        message: error.message,
        ...(process.env.NODE_ENV === 'development' ? { stack: error.stack } : {})
      },
      { status: 500 }
    );
  }
}