type Guard<T> = (value: unknown) => value is T;

/** Narrow an IPC value without coercing or copying the caller's payload. */
export function readArgument<T>(value: unknown, name: string, guard: Guard<T>): T {
  if (!guard(value)) throw new Error(`Invalid ${name}.`);
  return value;
}

export function readOptionalArgument<T>(
  value: unknown,
  name: string,
  guard: Guard<T>,
): T | undefined {
  return value === undefined ? undefined : readArgument(value, name, guard);
}

export function isOptional<T>(value: unknown, guard: Guard<T>): value is T | undefined {
  return value === undefined || guard(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

export function isId(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

/** Iteration also visits sparse slots; Array.every would silently skip them. */
export function isArrayOf<T>(value: unknown, guard: Guard<T>): value is T[] {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    if (!guard(item)) return false;
  }
  return true;
}
