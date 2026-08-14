import { rm } from 'node:fs/promises'

const dist = new URL('../dist/', import.meta.url)
await rm(dist, { force: true, recursive: true })
