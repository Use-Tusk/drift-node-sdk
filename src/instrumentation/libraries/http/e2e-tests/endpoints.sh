#!/bin/bash

# HTTP library endpoint definitions
# Shared between CJS and ESM variants

# Define all endpoints to hit during E2E test
# This function is called by base-runner.sh
define_endpoints() {
  make_request GET /health
  make_request GET /test-http-get
  make_request POST /test-http-request
  make_request GET /test-https-get
  make_request GET /test-axios-get
  make_request POST /test-axios-post
  make_request GET /test-url-object-get
  make_request POST /test-url-object-request
}
