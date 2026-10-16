# Perf — Leef

Contrat §7. Avant : L01 (b6fb674 + marques de démarrage). Après : L18.

## Budgets (§7)
- bundle : chunk index ≤ 821 kB (782 + 5 %), gzip ≤ 293 kB ; chunks paresseux listés
- démarrage : médiane 5 runs (vite preview Chromium, tauri dev) ≤ avant + 10 %
- aperçu : `src/lib/markdown.bench.ts` (1 000 lignes ; + 50 liens wiki dès L09) ≤ avant + 10 %

## Avant (b6fb674)

### Aperçu
`npx vitest bench --run src/lib/markdown.bench.ts`
```
     name                hz     min     max    mean     p75     p99    p995    p999     rme  samples
   · parseMarkdown   922.46  0.9536  2.0833  1.0841  1.1125  1.8980  2.0383  2.0833  ±1.35%      462
   · renderDocument  800.80  1.1701  2.8942  1.2487  1.2327  1.6807  1.7169  2.8942  ±1.08%      401

 BENCH  Summary

```

### Bundle
`npm run build` (20 plus gros chunks ; index-BOHElK-c = entrée)
```
dist/assets/xychartDiagram-FW5EYKEG-DHiHpY3h.js        41.93 kB  gzip:  11.96 kB
dist/assets/vennDiagram-L72KCM5P-BolhW84u.js           42.37 kB  gzip:  15.66 kB
dist/assets/index-T9nXgFO3.js                          45.07 kB  gzip:  18.64 kB
dist/assets/chunk-V7JOEXUC-DejC_yj_.js                 49.30 kB  gzip:  15.59 kB
dist/assets/flowDiagram-23GEKE2U-DjOR38gk.js           61.39 kB  gzip:  19.40 kB
dist/assets/c4Diagram-LMCZKHZV-DMjk03Tz.js             69.95 kB  gzip:  19.48 kB
dist/assets/ganttDiagram-NO4QXBWP-BkZzb016.js          69.44 kB  gzip:  23.19 kB
dist/assets/index-Zn95XJ_Y.js                          70.77 kB  gzip:  25.07 kB
dist/assets/blockDiagram-677ZJIJ3-BceVeqna.js          75.12 kB  gzip:  21.42 kB
dist/assets/cose-bilkent-JH36ORCC-tvTsh5us.js          81.55 kB  gzip:  22.35 kB
dist/assets/index-vjpoSb8F.js                          97.73 kB  gzip:  27.91 kB
dist/assets/index-Rqic5Xss.js                         103.88 kB  gzip:  33.29 kB
dist/assets/sequenceDiagram-DBY2YBRQ-QzuLscX8.js      117.42 kB  gzip:  31.01 kB
dist/assets/swimlanes-5IMT3BWC-CfXDXwZQ.js            120.25 kB  gzip:  43.66 kB
dist/assets/architectureDiagram-ZJ3FMSHR-BG9CYLnF.js  151.50 kB  gzip:  42.78 kB
dist/assets/katex-C5jXJg4s.js                         258.49 kB  gzip:  77.25 kB
dist/assets/cytoscape.esm-CUqq0XTU.js                 443.69 kB  gzip: 141.74 kB
dist/assets/mermaid.core-BR-3JoxD.js                  634.77 kB  gzip: 151.27 kB
dist/assets/cynefin-VYW2F7L2-CRztUjYh.js              690.56 kB  gzip: 154.58 kB
dist/assets/index-BOHElK-c.js                         782.19 kB  gzip: 279.64 kB
```
index-BOHElK-c.js : 782.19 kB, gzip 279.64 kB

### Démarrage
`npx vite preview --port 4004 --strictPort` + Playwright Chromium, `performance.measure("leef:boot","leef:ready")`, 5 runs
```
runs_ms 40.2 30.1 30.3 31.0 32.3 mediane_ms 31.0
```
