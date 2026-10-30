import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { LocationCode } from '@shared/constants';

const KEY = 'tb.location';
/** Screens that exist in both locations keep whichever one the user last chose. */
const SHARED_PATHS = ['/products', '/reports', '/stock-in', '/store/stock-take'];

function stored(): LocationCode {
  try {
    return localStorage.getItem(KEY) === 'STORE' ? 'STORE' : 'SHOP';
  } catch {
    return 'SHOP';
  }
}

export function useLocationCode() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<LocationCode>(stored);

  const fromPath: LocationCode | null = SHARED_PATHS.includes(pathname)
    ? null
    : pathname.startsWith('/store')
      ? 'STORE'
      : 'SHOP';
  const code = fromPath ?? chosen;

  useEffect(() => {
    if (fromPath && fromPath !== chosen) setChosen(fromPath);
  }, [fromPath, chosen]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, code);
    } catch {
      /* ignore */
    }
  }, [code]);

  const switchTo = useCallback(
    (next: LocationCode) => {
      setChosen(next);
      if (!SHARED_PATHS.includes(pathname)) navigate(next === 'STORE' ? '/store' : '/');
    },
    [navigate, pathname],
  );

  return { code, switchTo };
}
