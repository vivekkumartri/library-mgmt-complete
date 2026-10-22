import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api';

const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('lib_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('lib_token');
      localStorage.removeItem('lib_user');
      if (!window.location.pathname.includes('login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

/** Extracts a friendly message from a backend error response. */
export function apiErrorMessage(err, fallback = 'Something went wrong. Please try again.') {
  return err?.response?.data?.error?.message || fallback;
}

/**
 * Downloads a payment receipt PDF and opens it in a new tab.
 *
 * The receipt endpoint requires a Bearer token (students can only view
 * their own), so a plain `<a href="...">` link never works — the browser's
 * top-level navigation doesn't carry the Authorization header our axios
 * instance adds, and the request comes back 401 UNAUTHENTICATED. Fetching
 * it through `api` (which does attach the token) and turning the response
 * into a blob URL is what actually lets it open/download.
 */
export async function openReceipt(paymentId, fileName) {
  const res = await api.get(`/payments/${paymentId}/receipt.pdf`, { responseType: 'blob' });
  const blobUrl = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  const win = window.open(blobUrl, '_blank');
  if (!win) {
    // Popup blocked — fall back to a same-tab download so the receipt is
    // still reachable rather than silently doing nothing.
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName || `${paymentId}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  // Give the new tab/download a moment to actually load the blob before revoking it.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
}

export default api;
