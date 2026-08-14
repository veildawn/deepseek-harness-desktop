import { pathToFileURL } from 'node:url'

const cliEntry = process.env.DSH_DESKTOP_CLI_ENTRY
if (cliEntry === undefined) throw new Error('desktop backend: DSH_DESKTOP_CLI_ENTRY is required')
await import(pathToFileURL(cliEntry).href)
