import { HttpTransform } from "./http/HttpTransformEngine";
import { FetchTransform } from "./fetch/FetchTransformEngine";

/**
 * Unified transform configuration for all instrumentation libraries.
 * Each library has its own transforms array that is applied independently.
 * All fields are optional - you can specify transforms for only the libraries you need.
 */
export interface TransformConfigs {
  http?: HttpTransform[];
  fetch?: FetchTransform[];
}
