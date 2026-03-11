/** @type {import('next').NextConfig} */
import { withTuskDrift } from "@use-tusk/drift-node-sdk/next";

export default withTuskDrift(
  {},
  {
    // Tusk Drift options
    debug: true, // Enable debug logging
  },
);
