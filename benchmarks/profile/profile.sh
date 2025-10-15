npm run tsc -- benchmarks/profile/simple.profile.ts --module commonjs --target es6

export TUSK_DRIFT_MODE=RECORD

0x -o -D benchmarks/profile/results benchmarks/profile/simple.profile.js

