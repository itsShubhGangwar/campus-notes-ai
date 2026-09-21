import axios from 'axios';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/+$/, '');

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Normalize URLs and attach JWT token from localStorage to outgoing requests
api.interceptors.request.use((config) => {
  if (config.url) {
    const baseURL = (config.baseURL || API_BASE_URL).replace(/\/+$/, '');
    const baseHasApi = /\/api$/.test(baseURL);

    if (baseHasApi && config.url.startsWith('/api/')) {
      // Strip duplicate /api prefix when baseURL already terminates with /api
      config.url = config.url.replace(/^\/api/, '');
    } else if (!baseHasApi && !config.url.startsWith('/api/') && !/^https?:\/\//.test(config.url)) {
      // Ensure /api prefix is present when baseURL lacks /api
      config.url = `/api${config.url.startsWith('/') ? '' : '/'}${config.url}`;
    }
  }

  const token = localStorage.getItem('token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});


// Handle global response errors (such as 401 Unauthorized)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear invalid token if expired
      const isAuthEndpoint = error.config.url?.includes('/auth/login') || error.config.url?.includes('/auth/register');
      if (!isAuthEndpoint) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    return Promise.reject(error);
  }
);
