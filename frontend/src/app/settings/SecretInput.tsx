"use client";

import { useEffect, useState } from "react";

// A masked input for API secrets (access token, app secret, verify token).
//
// Browsers' password managers treat any <input type="password"> as a login
// password: they offer to SAVE the token as your site password and later
// AUTOFILL your login password into these boxes (or the token into the login
// form). To avoid that, the value is masked with CSS (-webkit-text-security)
// on a plain text input, which password managers ignore. Browsers without
// that CSS fall back to type="password" + autocomplete="new-password".
// The field also stays read-only until focused, which blocks autofill on load.

export function SecretInput({
  id,
  name,
  value,
  onChange,
  placeholder,
  className,
  invalid,
  describedBy,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [cssMask, setCssMask] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [armed, setArmed] = useState(false); // read-only until the user focuses it

  useEffect(() => {
    setCssMask(typeof CSS !== "undefined" && CSS.supports?.("-webkit-text-security", "disc"));
  }, []);

  const type = reveal || cssMask ? "text" : "password";
  const style = !reveal && cssMask ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties) : undefined;

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setArmed(true)}
        readOnly={!armed}
        placeholder={placeholder}
        autoComplete={type === "password" ? "new-password" : "off"}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        // Tell common password managers to leave this field alone.
        data-lpignore="true"
        data-1p-ignore="true"
        data-bwignore="true"
        data-form-type="other"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`${className ?? ""} pr-10`}
        style={style}
      />
      <button
        type="button"
        onClick={() => setReveal((r) => !r)}
        className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md text-slate-400 hover:text-slate-700 flex items-center justify-center"
        aria-label={reveal ? "Hide value" : "Show value"}
        aria-pressed={reveal}
      >
        <i className={`ph ${reveal ? "ph-eye-slash" : "ph-eye"} text-sm`} aria-hidden="true" />
      </button>
    </div>
  );
}
