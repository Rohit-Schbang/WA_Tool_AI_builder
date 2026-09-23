import vm from "node:vm";

// Safe evaluation of small user-authored JavaScript expressions for the
// VALIDATE and TRANSFORM code nodes (#7.1, #7.2).
//
// Security model:
//   - Runs in a fresh vm context with NO access to require, process, fetch,
//     globalThis, the filesystem, network, or timers.
//   - Only the provided `vars` object (the conversation variables) plus a few
//     safe helpers are exposed.
//   - Hard timeout so an infinite loop can't hang the engine.
//
// This is NOT a full security boundary against a determined attacker (vm is
// not a hardened sandbox), but it removes the obvious dangerous globals and
// bounds execution. Workflows are authored by the chatbot's own owner, so the
// threat model is "prevent accidental foot-guns + runaway loops", not
// "run untrusted third-party code".

export interface SandboxResult {
  ok: boolean;
  value?: any;
  error?: string;
}

const SAFE_GLOBALS = `
  const Math = this.Math;
  const Date = this.Date;
  const JSON = this.JSON;
  const String = this.String;
  const Number = this.Number;
  const Boolean = this.Boolean;
  const Array = this.Array;
  const Object = this.Object;
  const parseInt = this.parseInt;
  const parseFloat = this.parseFloat;
  const isNaN = this.isNaN;
`;

// Evaluate a single JS expression, returning its value.
// `vars` is exposed both as `vars` and by spreading each key as a local-ish
// reference via the `vars` object (users write vars.name or {{name}} handled
// upstream). We keep it explicit: expressions reference `vars.xxx`.
export function evalExpression(expression: string, vars: Record<string, any>): SandboxResult {
  if (!expression || !expression.trim()) {
    return { ok: false, error: "Empty expression" };
  }
  try {
    const sandbox: Record<string, any> = {
      Math, Date, JSON, String, Number, Boolean, Array, Object,
      parseInt, parseFloat, isNaN,
      vars: { ...vars },
    };
    const context = vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });
    // Wrap so the expression's value is returned.
    const script = new vm.Script(`(${expression})`);
    const value = script.runInContext(context, { timeout: 1000 });
    return { ok: true, value };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
