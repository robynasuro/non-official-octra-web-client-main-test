/**
 * A generic SWR fetcher function that uses the native fetch API
 * and our Next.js API proxy route.
 * @param key The key for the SWR request, expected to be an array.
 */
export const fetcher = async (key: [string, string, object?]) => {
  const [endpoint, rpcUrl, payload = {}] = key; // Default payload kosong kalo ga ada

  const response = await fetch('/api/proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      method: payload && Object.keys(payload).length > 0 ? 'POST' : 'GET', // Cek kalo payload ada isi
      endpoint,
      rpcUrl,
      payload: {
        address: endpoint.split('/').pop(), // Ambil address dari endpoint
        ...payload, // Tambah payload tambahan kalo ada
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    const error = new Error(errorData.error || 'An error occurred while fetching the data.');
    throw error;
  }

  return response.json();
};