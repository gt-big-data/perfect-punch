import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createApiFetch } from '../api/apiFetch';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export function useApiFetch() {
  const { getAccessToken, login } = useAuth();
  return useMemo(
    () => createApiFetch({ baseUrl: API_BASE_URL, getAccessToken, login }),
    [getAccessToken, login],
  );
}
