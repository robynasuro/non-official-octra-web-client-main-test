import { NextResponse } from 'next/server';
import { validatePrivateKey } from '@/lib/crypto';

// Define strict types for our configuration
type EndpointConfig = {
  public: string[];
  private: string[];
};

type FieldRequirements = {
  required: string[];
  mappings?: Record<string, string>;
};

type AuthMethods = {
  [key: string]: ('header' | 'payload')[];
  default: ('header' | 'payload')[];
};

const API_CONFIG = {
  endpoints: {
    public: [
      '/balance',
      '/staging',
      '/tx',
      '/private_transactions',
      '/pending_private_transfers',
      '/view_encrypted_balance'
    ],
    private: [
      '/encrypt_balance',
      '/decrypt_balance',
      '/private_transfer',
      '/claim_private_transfer',
      '/send-tx'
    ]
  } as EndpointConfig,
  fieldRequirements: {
    '/private_transfer': {
      required: ['amount', 'to', 'from'],
      mappings: {
        recipient: 'to',
        sender: 'from'
      }
    },
    '/encrypt_balance': {
      required: ['amount', 'address', 'private_key']
    },
    '/decrypt_balance': {
      required: ['amount', 'address', 'private_key']
    }
  } as Record<string, FieldRequirements>,
  authMethods: {
    '/private_transfer': ['payload'],
    default: ['header', 'payload']
  } as AuthMethods
};

const SECURITY_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Private-Key',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

const DEFAULT_RPC_URL = process.env.DEFAULT_RPC_URL || 'https://octra.network';
const REQUEST_TIMEOUT = 30000;

export async function OPTIONS() {
  return new NextResponse(null, { headers: SECURITY_HEADERS });
}

export async function POST(request: Request) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    // Validate Content-Type
    const contentType = request.headers.get('Content-Type');
    if (contentType !== 'application/json') {
      return errorResponse(415, 'Unsupported Media Type');
    }

    const requestBody = await request.json();
    const { method = 'GET', endpoint, rpcUrl = DEFAULT_RPC_URL, payload } = requestBody;
    
    // Validate endpoint
    if (!endpoint || typeof endpoint !== 'string') {
      return errorResponse(400, 'Missing or invalid endpoint');
    }

    // Check authorization
    const isPublic = API_CONFIG.endpoints.public.some(e => endpoint.startsWith(e));
    const isPrivate = API_CONFIG.endpoints.private.some(e => endpoint.startsWith(e));
    
    if (!isPublic && !isPrivate) {
      return errorResponse(403, 'Unauthorized endpoint');
    }

    // Handle authentication
    const authHeader = request.headers.get('Authorization');
    const privateKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const xPrivateKey = request.headers.get('X-Private-Key');
    const usedKey = privateKey || xPrivateKey;

    if (isPrivate && !usedKey) {
      return errorResponse(401, 'Authentication required');
    }

    if (isPrivate && usedKey && !validatePrivateKey(usedKey)) {
      return errorResponse(401, 'Invalid private key format');
    }

    // Process and validate payload
    const processedPayload = payload ? { ...payload } : {};
    if (method !== 'GET' && payload) {
      // Find matching endpoint configuration
      const endpointKey = Object.keys(API_CONFIG.fieldRequirements).find(key => 
        endpoint.startsWith(key)
      );
      
      const endpointConfig = endpointKey ? API_CONFIG.fieldRequirements[endpointKey] : undefined;

      // Apply field mappings if they exist
      if (endpointConfig?.mappings) {
        for (const [frontendField, backendField] of Object.entries(endpointConfig.mappings)) {
          if (payload[frontendField] !== undefined) {
            processedPayload[backendField] = payload[frontendField];
            delete processedPayload[frontendField];
          }
        }
      }

      // Validate required fields
      if (endpointConfig?.required) {
        const missingFields = endpointConfig.required.filter(
          field => processedPayload[field] === undefined
        );
        
        if (missingFields.length > 0) {
          return errorResponse(400, `Missing required fields: ${missingFields.join(', ')}`);
        }
      }

      // Add authentication based on endpoint requirements
      const authMethod = (endpointKey && API_CONFIG.authMethods[endpointKey]) 
        ? API_CONFIG.authMethods[endpointKey] 
        : API_CONFIG.authMethods.default;
      
      if (authMethod.includes('payload') && usedKey) {
        if (endpoint.startsWith('/private_transfer')) {
          processedPayload.from_private_key = usedKey;
        } else {
          processedPayload.private_key = usedKey;
        }
      }
    }

    // Build target URL
    let targetUrl: URL;
    try {
      targetUrl = new URL(endpoint, rpcUrl);
      
      // Add cache buster for specific endpoints
      if (endpoint.startsWith('/balance') || endpoint.startsWith('/pending_private_transfers')) {
        targetUrl.searchParams.append('_', Date.now().toString());
      }
    } catch {
      return errorResponse(400, 'Invalid URL format');
    }

    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // Add authentication headers if required
    const endpointKey = Object.keys(API_CONFIG.authMethods).find(key =>
      endpoint.startsWith(key) && key !== 'default'
    );
    const authMethod = endpointKey 
      ? API_CONFIG.authMethods[endpointKey] 
      : API_CONFIG.authMethods.default;
    
    if (authMethod.includes('header') && usedKey) {
      headers['Authorization'] = `Bearer ${usedKey}`;
      headers['X-Private-Key'] = usedKey;
    }

    // Make the request
    const response = await fetch(targetUrl.toString(), {
      method,
      headers,
      body: method !== 'GET' ? JSON.stringify(processedPayload) : undefined,
      signal: controller.signal
    });

    // Handle special cases
    if (endpoint.startsWith('/pending_private_transfers') && response.status === 500) {
      return successResponse({ pending_transfers: [] });
    }

    // Handle authentication errors specifically
    if (response.status === 401 || response.status === 403) {
      const errorData = await response.json().catch(() => ({}));
      return errorResponse(response.status, errorData.error || 'Authentication failed');
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Backend Error:', {
        url: targetUrl.toString(),
        status: response.status,
        error: errorData
      });
      return errorResponse(response.status, errorData.error || 'Request failed');
    }

    const data = await response.json();
    return successResponse(data);

  } catch (error) {
    console.error('Proxy error:', error);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return errorResponse(504, 'Request timeout');
      }
      return errorResponse(500, error.message);
    }

    return errorResponse(500, 'Internal server error');
  } finally {
    clearTimeout(timeoutId);
  }
}

function successResponse(data: unknown): NextResponse {
  return NextResponse.json(data, { headers: SECURITY_HEADERS });
}

function errorResponse(status: number, message: string): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: SECURITY_HEADERS }
  );
}