/*!
 * Copyright The OpenTelemetry Authors
 * Copyright Use Tusk
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// ESM loader hooks for drift-node-sdk instrumentation
// This file enables ESM module interception by delegating to import-in-the-middle
//
// Usage: node --experimental-loader=@use-tusk/drift-node-sdk/hook.mjs --import ./telemetry.js app.js

import {
  initialize,
  load,
  resolve,
  getFormat,
  getSource,
} from 'import-in-the-middle/hook.mjs';

export { initialize, load, resolve, getFormat, getSource };
