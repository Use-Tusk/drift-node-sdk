# Rust Core Bindings

This document explains how Rust acceleration works in the Node SDK, how to enable it, and what fallback behavior to expect.

## Overview

The SDK can offload selected hot-path logic to Rust via Node bindings (`@use-tusk/drift-core-node`), defined in the [`drift-core`](https://github.com/Use-Tusk/drift-core) repository. This is controlled by an environment flag and is designed to fail open.

At a high level:

- Node SDK logic remains the source of truth.
- Rust paths are opportunistic optimizations.
- If Rust is unavailable or fails at runtime, SDK behavior falls back to JavaScript equivalents.

## Enablement

Set:

```bash
TUSK_USE_RUST_CORE=1
```

Truthy values are `1` and `true` (case-insensitive). Any other value is treated as disabled.

## Installation Requirements

The Node SDK currently includes `@use-tusk/drift-core-node` as a regular dependency.

Notes:

- There is no Node equivalent of Python extras like `[rust]`.
- Rust acceleration is still runtime-gated by `TUSK_USE_RUST_CORE`.
- If the native binding cannot be loaded on a machine, the SDK continues on JavaScript code paths.

## Platform Coverage and Native Binary Concerns

Node native bindings depend on OS/arch/libc compatibility of published prebuilt artifacts.

Practical implications:

- Some platforms may not have a matching native artifact.
- On such platforms, direct use of `@use-tusk/drift-core-node` can fail at runtime.
- Within `drift-node-sdk`, Rust helper loading is guarded and fails open to non-Rust paths.

Unlike Python wheels, this concern appears as Node native addon compatibility rather than wheel tag compatibility.

## Fallback Behavior

The bridge module is fail-open:

- Rust calls are guarded behind a binding loader.
- If `TUSK_USE_RUST_CORE` is unset/falsey, Rust is skipped.
- If loading or a Rust call fails, helper functions return `null`.
- Calling code then uses the existing JavaScript implementation.

This means users do not need Rust installed to run the SDK when Rust acceleration is disabled or unavailable.

## Practical Guidance

- Default production-safe posture: keep Rust disabled unless your deployment matrix is tested.
- Performance posture: enable Rust and benchmark on your workloads before broad rollout.
- Reliability posture: keep parity/smoke tests in CI to detect drift between JS and Rust paths.
