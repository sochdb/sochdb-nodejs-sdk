/**
 * koffi type-registration helpers.
 *
 * koffi keeps a *process-global* type registry. Test runners such as Jest
 * re-evaluate each module in a fresh JS module registry per test file, so the
 * second test file that imports an FFI module re-runs its top-level
 * `koffi.struct('X', ...)` / `koffi.pointer('X', ...)` calls against the same
 * native registry and throws `Duplicate type name 'X'`.
 *
 * These helpers make registration idempotent: on the first call the named type
 * is created and returned; on subsequent calls we fall back to the type *name*,
 * which koffi resolves from its registry wherever a type is expected
 * (function signatures, `koffi.pointer(...)`, `koffi.array(...)`, struct fields).
 */
import * as koffi from 'koffi';

export function safePointer(name: string): any {
  try {
    return koffi.pointer(name, koffi.opaque());
  } catch {
    return name;
  }
}

export function safeStruct(name: string, fields: Record<string, any>): any {
  try {
    return koffi.struct(name, fields);
  } catch {
    return name;
  }
}
