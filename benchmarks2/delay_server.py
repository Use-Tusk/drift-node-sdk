#!/usr/bin/env python3
"""Simple delay server for downstream benchmarks."""
import logging
import time
from flask import Flask, request

logging.getLogger('werkzeug').setLevel(logging.ERROR)

app = Flask(__name__)

@app.route('/delay')
def delay():
    ms = int(request.args.get('ms', 10))
    time.sleep(ms / 1000)
    return 'ok'

@app.route('/health')
def health():
    return 'ok'

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=9999, threaded=True)
