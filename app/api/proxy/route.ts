import { NextResponse } from 'next/server';
import { validatePrivateKey } from '@/lib/crypto';

// Define allowed endpoints with TypeScript
const ALLOWED_ENDPOINTS: string[] = [
  '/balance',
  '/staging',
  '/tx',
  '/private_transactions',
  '/pending_private_transfers',
  '/view_encrypted_balance'
];

const PRIVATE_ENDPOINTS: string[] = [
  '/encrypt_balance',
  '/decrypt_balance',
  '/private_transfer',
  '/claim_private_transfer',
  '/send-tx'
];

// Security headers TypeScript interface
interface SecurityHeaders {
  [key: string]: string;
}

const CORS_HEADERS: SecurityHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Private-Key',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Expose-Headers': '*'
};

const SECURITY_HEADERS: SecurityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
};

const DEFAULT_RPC_URL = process.env.DEFAULT_RPC_URL || 'https://octra.network';
const REQUEST_TIMEOUT = 15000; // 15 seconds

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

    // Parse and validate request body
    const requestBody = await request.json();
    const { method = 'GET', endpoint, rpcUrl = DEFAULT_RPC_URL, payload } = requestBody;
    
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

    // Authenticate private endpoints
    const authHeader = request.headers.get('Authorization');
    const privateKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const xPrivateKey = request.headers.get('X-Private-Key');

    // Validate private key if required
    const isPrivate = PRIVATE_ENDPOINTS.some(pe => endpoint.startsWith(pe));
    if (isPrivate) {
      if (!privateKey && !xPrivateKey) {
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

      try {
        // Validate the private key format
        const keyToValidate = privateKey || xPrivateKey;
        if (keyToValidate) {
          validatePrivateKey(keyToValidate);
        }
      } catch (error) {
        return NextResponse.json(
          { error: 'Invalid private key format' },
          { 
            status: 401, 
            headers: { 
              ...CORS_HEADERS, 
              ...SECURITY_HEADERS 
            } 
          }
        );
      }
    }

    // Check endpoint authorization
    const isAllowed = ALLOWED_ENDPOINTS.some(ae => endpoint.startsWith(ae)) || isPrivate;
    if (!isAllowed) {
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

    // Construct target URL with special handling
    let targetUrl: URL;
    try {
      if (endpoint.startsWith('/pending_private_transfers')) {
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

    // Add cache buster for balance endpoints
    if (endpoint.startsWith('/balance') || endpoint.startsWith('/pending_private_transfers')) {
      targetUrl.searchParams.append('_', Date.now().toString());
    }

    // Prepare fetch options with TypeScript typing
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(privateKey ? { 'X-Private-Key': privateKey } : {}),
        ...(xPrivateKey ? { 'X-Private-Key': xPrivateKey } : {})
      },
      signal: controller.signal,
      cache: 'no-store'
    };

    if (method !== 'GET' && payload) {
      fetchOptions.body = JSON.stringify(payload);
    }

    // Make the request with retry logic
    let response: Response | null = null;
    let retryCount = 0;
    const maxRetries = 2;
    let lastError: unknown = null;
    
    while (retryCount <= maxRetries) {
      try {
        response = await fetch(targetUrl.toString(), fetchOptions);
        if (response.ok) break;
        
        if (retryCount === maxRetries) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Request failed with status ${response.status}`);
        }
      } catch (error) {
        lastError = error;
        if (retryCount === maxRetries) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      }
      retryCount++;
    }

    if (!response) {
      throw new Error('No response received after retries');
    }

    // Handle special case for pending_private_transfers
    if (endpoint.startsWith('/pending_private_transfers') && response.status === 500) {
      return NextResponse.json(
        { pending_transfers: [] },
        { 
          status: 200,
          headers: { 
            ...CORS_HEADERS, 
            ...SECURITY_HEADERS 
          }
        }
      );
    }

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: 'Unknown error occurred' };
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