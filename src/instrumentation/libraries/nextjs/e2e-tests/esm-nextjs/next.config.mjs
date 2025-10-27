/** @type {import('next').NextConfig} */
import { withTuskDrift } from "@use-tusk/drift-node-sdk";

export default withTuskDrift(
  {},
  {
    // Tusk Drift options
    debug: true, // Enable debug logging
  },
);
