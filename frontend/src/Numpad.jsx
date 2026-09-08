import { useCallback, useRef, useEffect } from "react";

const KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "⌫"],
];

export default function Numpad({
  value = "",
  onChange,
  onSubmit,
  maxLength = 10,
  buttonSize = 56,
  totalWidth,
}) {
  const inputRef = useRef(null);
  const focusRef = useRef(false);

  // Keep keyboard focus on the invisible input so external keyboard entry still works.
  useEffect(() => {
    if (focusRef.current && inputRef.current) {
      inputRef.current.focus();
    }
  }, [value]);

  const dispatch = useCallback(
    (key) => {
      if (!onChange) return;

      if (key === "⌫") {
        onChange(value.slice(0, -1));
        return;
      }

      if (key === ".") {
        // Only allow one decimal marker and only in the fractional part.
        const beforeDot = value.slice(0, value.indexOf(".") ?? Infinity);
        if (beforeDot.length >= maxLength) return;
        if (value.includes(".")) return;
        onChange(value === "" ? "0." : value + ".");
        return;
      }

      // Digit
      if (value.replace(/[^0-9]/g, "").length >= maxLength) return;
      if (value === "0") {
        onChange(key);
      } else {
        onChange(value + key);
      }
    },
    [value, onChange, maxLength]
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (!onChange) return;
      const key = e.key;
      if (/^[0-9]$/.test(key)) {
        e.preventDefault();
        dispatch(key);
      } else if (key === "." || key === ",") {
        e.preventDefault();
        dispatch(".");
      } else if (key === "Backspace") {
        e.preventDefault();
        dispatch("⌫");
      } else if (key === "Enter" || key === "NumpadEnter") {
        e.preventDefault();
        if (onSubmit) onSubmit(value);
      } else if (key === "Escape") {
        e.preventDefault();
        onChange("");
      }
    },
    [value, onChange, onSubmit, dispatch]
  );

  const handleSubmit = useCallback(() => {
    if (onSubmit) onSubmit(value);
  }, [value, onSubmit]);

  const buttonStyle = {
    width: buttonSize,
    height: buttonSize,
    borderRadius: Math.round(buttonSize * 0.22),
    fontSize: buttonSize * 0.34,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Invisible input keeps external keyboard + screen reader support. */}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          // Allow direct typing but sanitize to digits/one dot.
          const raw = e.target.value.replace(/[^0-9.]/g, "");
          const parts = raw.split(".");
          const sanitized =
            parts.length > 2
              ? parts.slice(0, 2).join(".")
              : raw;
          if (sanitized !== raw) {
            e.target.value = sanitized;
          }
          onChange(sanitized.slice(0, maxLength));
        }}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.target.select()}
        style={{
          position: "absolute",
          opacity: 0,
          pointerEvents: "auto",
          width: 1,
          height: 1,
          top: 0,
          left: 0,
        }}
        tabIndex={-1}
        aria-hidden="true"
      />

      {totalWidth != null ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(3, 1fr) auto`,
            gap: 8,
            width: totalWidth,
          }}
        >
          {KEYS.flatMap((row) => row.map((key) => (
            <button
              key={key}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                dispatch(key);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  dispatch(key);
                }
              }}
              style={{
                ...buttonStyle,
                padding: 0,
              }}
            >
              {key}
            </button>
          )))}
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              onChange("");
            }}
            style={{
              ...buttonStyle,
              background: "var(--muted)",
              color: "var(--text)",
            }}
          >
            C
          </button>
          {onSubmit && (
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                handleSubmit();
              }}
              style={{
                ...buttonStyle,
                background: "var(--primary)",
                color: "#fff",
              }}
            >
              OK
            </button>
          )}
        </div>
      ) : (
        <>
          {KEYS.map((row) => (
            <div key={row.join("")} style={{ display: "flex", gap: 8 }}>
              {row.map((key) => (
                <button
                  key={key}
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    dispatch(key);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      dispatch(key);
                    }
                  }}
                  style={{
                    ...buttonStyle,
                    padding: 0,
                  }}
                >
                  {key}
                </button>
              ))}
            </div>
          ))}
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              onChange("");
            }}
            style={{
              ...buttonStyle,
              background: "var(--muted)",
              color: "var(--text)",
            }}
          >
            C
          </button>
          {onSubmit && (
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                handleSubmit();
              }}
              style={{
                ...buttonStyle,
                background: "var(--primary)",
                color: "#fff",
              }}
            >
              OK
            </button>
          )}
        </>
      )}
    </div>
  );
}
