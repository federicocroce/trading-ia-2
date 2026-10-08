import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve(import.meta.dirname ?? '.')
const parts = [
  '.parcial-lly-repx.json',
  '.parcial-hci-cpa.json',
  '.parcial-mye-tel.json',
  '.parcial-tsm-trow.json',
  '.parcial-rev-aph-lly.json',
  '.parcial-rev-musa-blx.json',
]
const out: { verificaciones: unknown[]; revisiones: unknown[] } = { verificaciones: [], revisiones: [] }
for (const p of parts) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8'))
  out.verificaciones.push(...(j.verificaciones || []))
  out.revisiones.push(...(j.revisiones || []))
}
fs.writeFileSync(path.join(dir, '2026-10-02.json'), JSON.stringify(out, null, 2) + '\n')
console.log('verificaciones:', out.verificaciones.map((v: any) => v.symbol).join(' '))
console.log('revisiones:', out.revisiones.map((v: any) => v.symbol).join(' '))
