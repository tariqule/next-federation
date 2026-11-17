#!/usr/bin/env node
import { runTypesCli } from './sync.ts'

process.exitCode = await runTypesCli(process.argv.slice(2))
