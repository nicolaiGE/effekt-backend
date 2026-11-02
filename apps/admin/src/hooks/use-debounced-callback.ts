import { useEffect, useMemo, useRef } from "react";

/** A debounced `callback`. `.cancel()` drops a pending call (e.g. when the input is cleared). */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay = 300,
) {
  const callbackRef = useRef(callback);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    callbackRef.current = callback;
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  return useMemo(() => {
    function debounced(...args: Args) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => callbackRef.current(...args), delay);
    }
    debounced.cancel = () => clearTimeout(timer.current);
    return debounced;
  }, [delay]);
}
