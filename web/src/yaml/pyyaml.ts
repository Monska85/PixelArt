// How PyYAML (YAML 1.1) turns a plain scalar into a value. The `yaml` package
// resolves numbers and booleans a little differently (`1e3`, `1.0e3` and `y`),
// so the reader applies these rules to the text of every plain scalar.

export type Plain =
  | { kind: "null" }
  | { kind: "bool"; value: boolean }
  | { kind: "int"; value: bigint }
  | { kind: "float"; value: number }
  | { kind: "string" }
  | { kind: "unsupported"; what: string };

const TRUE = /^(?:yes|Yes|YES|true|True|TRUE|on|On|ON)$/;
const FALSE = /^(?:no|No|NO|false|False|FALSE|off|Off|OFF)$/;
const NULL = /^(?:~|null|Null|NULL|)$/;
const INT =
  /^(?:[-+]?0b[01_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/;
const FLOAT =
  /^(?:[-+]?[0-9][0-9_]*\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9][0-9_]*(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
const TIMESTAMP =
  /^(?:[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:[Tt]|[ \t]+)[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]*)?(?:[ \t]*(?:Z|[-+][0-9]{1,2}(?::[0-9]{2})?))?)$/;

function sexagesimal<T extends bigint | number>(
  parts: string[],
  zero: T,
  mul: (d: string, base: bigint) => T,
  add: (a: T, b: T) => T,
): T {
  let value = zero;
  let base = 1n;
  for (const part of [...parts].reverse()) {
    value = add(value, mul(part, base));
    base *= 60n;
  }
  return value;
}

function integer(text: string): bigint {
  let value = text.replace(/_/g, "");
  let sign = 1n;
  if (value.startsWith("-") || value.startsWith("+")) {
    if (value.startsWith("-")) sign = -1n;
    value = value.slice(1);
  }
  let result: bigint;
  if (value === "0") result = 0n;
  else if (value.startsWith("0b")) result = BigInt(`0b${value.slice(2)}`);
  else if (value.startsWith("0x")) result = BigInt(`0x${value.slice(2)}`);
  else if (value.startsWith("0")) result = BigInt(`0o${value.slice(1)}`);
  else if (value.includes(":"))
    result = sexagesimal(
      value.split(":"),
      0n,
      (d, base) => BigInt(d) * base,
      (a, b) => a + b,
    );
  else result = BigInt(value);
  return sign * result;
}

function float(text: string): number {
  let value = text.replace(/_/g, "").toLowerCase();
  let sign = 1;
  if (value.startsWith("-") || value.startsWith("+")) {
    if (value.startsWith("-")) sign = -1;
    value = value.slice(1);
  }
  if (value === ".inf") return sign * Infinity;
  if (value === ".nan") return NaN;
  if (value.includes(":"))
    return (
      sign *
      sexagesimal(
        value.split(":"),
        0,
        (d, base) => Number(d) * Number(base),
        (a, b) => a + b,
      )
    );
  return sign * Number(value);
}

export function resolvePlain(text: string): Plain {
  if (NULL.test(text)) return { kind: "null" };
  if (TRUE.test(text)) return { kind: "bool", value: true };
  if (FALSE.test(text)) return { kind: "bool", value: false };
  if (FLOAT.test(text)) return { kind: "float", value: float(text) };
  if (INT.test(text)) return { kind: "int", value: integer(text) };
  if (TIMESTAMP.test(text)) return { kind: "unsupported", what: "a timestamp" };
  if (text === "<<" || text === "=") return { kind: "unsupported", what: `the special value ${text}` };
  return { kind: "string" };
}
