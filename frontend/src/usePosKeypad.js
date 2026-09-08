import { useCallback } from "react";
import { usePOSApp } from "./POSLayout";

export function usePosKeypad() {
  const {
    keypadMode,
    keypadValue,
    focusedLine,
    setKeypadValue,
    setKeypadMode,
  } = usePOSApp();

  const commitKeypad = useCallback(() => {
    // Handled inside POSLayout now; this hook re-exposes the same function for consistency.
  }, []);

  return {
    keypadMode,
    keypadValue,
    focusedLine,
    dispatchKeypad,
    setKeypadMode,
    setKeypadValue,
  };
}
