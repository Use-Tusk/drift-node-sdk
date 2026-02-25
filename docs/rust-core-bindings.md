# Rust Core Bindings

This document explains how Rust acceleration works in the Node SDK, how to enable it, and what fallback behavior to expect.

## Overview

The SDK can offload selected hot-path logic to Rust via Node bindings (`@use-tusk/drift-core-node`), defined in the [`drift-core`](https://github.com/Use-Tusk/drift-core) repository. This is controlled by an environment flag and is designed to fail open.

At a high level:

- Node SDK logic remains the source of truth.
- Rust paths are opportunistic optimizations.
- If Rust is unavailable or fails at runtime, SDK behavior falls back to JavaScript equivalents.

## Enablement

Rust is enabled by default when `TUSK_USE_RUST_CORE` is unset.

Use `TUSK_USE_RUST_CORE` to explicitly override behavior:

- Truthy: `1`, `true`, `yes`, `on`
- Falsy: `0`, `false`, `no`, `off`

Examples:

```bash
# Explicitly enable (same as unset)
TUSK_USE_RUST_CORE=1

# Explicitly disable
TUSK_USE_RUST_CORE=0
```

## Installation Requirements

The Node SDK currently includes `@use-tusk/drift-core-node` as a regular dependency.

Notes:

- There is no Node equivalent of Python extras like `[rust]`.
- Rust acceleration is still runtime-gated by `TUSK_USE_RUST_CORE`, now with default-on behavior.
- If the native binding cannot be loaded on a machine, the SDK continues on JavaScript code paths.

## Platform Compatibility

`drift-core` publishes native artifacts across a defined support matrix. See:

- [`drift-core` compatibility matrix](https://github.com/Use-Tusk/drift-core/blob/main/docs/compatibility-matrix.md)

Node native bindings depend on OS/arch/libc compatibility of published prebuilt artifacts. On unsupported platforms, `drift-node-sdk` fails open to JavaScript paths.

## Fallback Behavior

The bridge module is fail-open:

- Rust calls are guarded behind a binding loader.
- If `TUSK_USE_RUST_CORE` is falsey, Rust is skipped.
- If loading or a Rust call fails, helper functions return `null`.
- Calling code then uses the existing JavaScript implementation.

On startup, the SDK logs whether Rust is enabled/disabled and whether it had to fall back to JavaScript.

This means users do not need Rust installed to run the SDK when Rust acceleration is disabled or unavailable.

## Practical Guidance

- Default production-safe posture: keep Rust enabled (default) only on tested deployment matrices.
- Performance posture: enable Rust and benchmark on your workloads before broad rollout.
- Reliability posture: keep parity/smoke tests in CI to detect drift between JS and Rust paths.
