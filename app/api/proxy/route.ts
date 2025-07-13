// app/api/proxy/route.ts
import { NextResponse } from 'next/server';

const ALLOWED_ENDPOINTS = [
  '/balance',
  '/staging',
  '/tx',
  '/private_transactions',
  '/pending_private_transfers',
  '/view_encrypted_balance'
];

const PRIVATE_ENDPOINTS = [
  '/encrypt_balance',
  '/decrypt_balance',
  '/private_transfer',
  '/claim_private_transfer',
  '/send-tx'
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Private-Key',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Expose-Headers': '*'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
};

const DEFAULT_RPC_URL = process.env.DEFAULT_RPC_URL || 'https://octra.network';
const REQUEST_TIMEOUT = 15000;

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      ...CORS_HEADERS,
      ...SECURITY_HEADERS
    }
  });
}

export async function POST(request: Request) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    // Validate Content-Type
    const contentType = request.headers.get('Content-Type');
    if (contentType !== 'application/json') {
      return NextResponse.json(
        { error: 'Unsupported Media Type' },
        { 
          status: 415, 
          headers: { 
            ...CORS_HEADERS, 
            ...SECURITY_HEADERS 
          } 
        }
      );
    }

    const { method = 'GET', endpoint, rpcUrl = DEFAULT_RPC_URL, payload } = await request.json();
    const authHeader = request.headers.get('Authorization');
    const privateKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    // Validate endpoint
    if (!endpoint || typeof endpoint !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid endpoint' },
        { 
          status: 400, 
          headers: { 
            ...CORS_HEADERS, 
            ...SECURITY_HEADERS 
          } 
        }
      );
    }

    // Check if endpoint is allowed
    const isAllowed = ALLOWED_ENDPOINTS.some(allowedEndpoint => 
      endpoint.startsWith(allowedEndpoint)
    );
    
    const isPrivate = PRIVATE_ENDPOINTS.some(privateEndpoint => 
      endpoint.startsWith(privateEndpoint)
    );

    if (!isAllowed && !isPrivate) {
      return NextResponse.json(
        { error: 'Unauthorized endpoint' },
        { 
          status: 403, 
          headers: { 
            ...CORS_HEADERS, 
            ...SECURITY_HEADERS 
          } 
        }
      );
    }

    if (isPrivate && !privateKey) {
      return NextResponse.json(
        { error: 'Private key required for this endpoint' },
        { 
          status: 401, 
          headers: { 
            ...CORS_HEADERS, 
            ...SECURITY_HEADERS 
          } 
        }
      );
    }

    // Construct the target URL with special handling for certain endpoints
    let targetUrl: URL;
    try {
      if (endpoint.startsWith('/pending_private_transfers')) {
        // Special handling for pending transfers endpoint
        targetUrl = new URL(`/api${endpoint}`, rpcUrl);
      } else {
        targetUrl = new URL(endpoint, rpcUrl);
      }
    } catch (err) {
      return NextResponse.json(
        { error: 'Invalid URL format' },
        { 
          status: 400, 
          headers: { 
            ...CORS_HEADERS, 
            ...SECURITY_HEADERS 
          } 
        }
      );
    }

    // Add cache buster for endpoints that need fresh data
    if (endpoint.startsWith('/balance') || endpoint.startsWith('/pending_private_transfers')) {
      targetUrl.searchParams.append('_', Date.now().toString());
    }

    // Prepare fetch options
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(privateKey ? { 'X-Private-Key': privateKey } : {})
      },
      signal: controller.signal,
      cache: 'no-store'
    };

    if (method !== 'GET' && payload) {
      fetchOptions.body = JSON.stringify(payload);
    }

    // Make the request with retry logic
    let response: Response | undefined;
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount <= maxRetries) {
      try {
        response = await fetch(targetUrl.toString(), fetchOptions);
        break;
      } catch (err) {
        if (retryCount === maxRetries) {
          throw err;
        }
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      }
    }

    // Check if response was assigned
    if (!response) {
      return NextResponse.json(
        { error: 'No response received after retries' },
        { 
          status: 504,
          headers: { 
            ...CORS_HEADERS, 
            ...SECURITY_HEADERS 
          }
        }
      );
    }

    // Handle non-OK responses
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: 'Unknown error occurred' };
      }
      
      // Special handling for pending transfers endpoint
      if (endpoint.startsWith('/pending_private_transfers') && response.status === 500) {
        return NextResponse.json(
          [], // Return empty array as fallback
          { 
            status: 200,
            headers: { 
              ...CORS_HEADERS, 
              ...SECURITY_HEADERS 
            }
          }
        );
      }
      
      return NextResponse.json(
        { 
          error: errorData.error || 'Request failed',
          status: response.status,
          endpoint
        },
        { 
          status: response.status,
          headers: { 
            ...CORS_HEADERS, 
            ...SECURITY_HEADERS 
          }
        }
      );
    }

    // Process successful response
    const data = await response.json();
    
    return NextResponse.json(data, { 
      headers: { 
        ...CORS_HEADERS, 
        ...SECURITY_HEADERS 
      } 
    });
    
  } catch (error: unknown) {
    console.error('Proxy error:', error);
    
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { 
          error: 'Request timeout',
          message: 'The request took too long to complete'
        },
        { 
          status: 504,
          headers: { 
            ...CORS_HEADERS, 
            ...SECURITY_HEADERS 
          }
        }
      );
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return NextResponse.json(
      { 
        error: 'Proxy error',
        message: errorMessage
      },
      { 
        status: 500,
        headers: { 
          ...CORS_HEADERS, 
          ...SECURITY_HEADERS 
        }
      }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}