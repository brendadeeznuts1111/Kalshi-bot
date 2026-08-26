#!/usr/bin/env bun
import { runCrossCheck } from './run.ts';
const code = await runCrossCheck();
process.exit(code);