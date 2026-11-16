#!/usr/bin/env node
import { runDescribeCli } from './describe.ts'

process.exitCode = await runDescribeCli(process.argv.slice(2), process.env)
