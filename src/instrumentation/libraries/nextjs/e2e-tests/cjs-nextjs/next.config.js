/** @type {import('next').NextConfig} */
const { withTuskDrift } = require("@use-tusk/drift-node-sdk/next");

module.exports = withTuskDrift(
  {},
  {
    // Tusk Drift options
    debug: true, // Enable debug logging
  },
);
