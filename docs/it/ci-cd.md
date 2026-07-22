# Uso in CI/CD

> 🇬🇧 [English version](../en/ci-cd.md)

Esempio GitHub Actions e gate di budget.

cloudrift è pensato per girare dentro le pipeline, non solo nel terminale. Due ingredienti lo rendono CI-friendly:

1. `--format markdown` produce un commento pronto per le Pull Request (totali, breakdown, raccomandazioni principali).
2. `costAlertThresholdUsd` nel config (vedi [File di configurazione](./configurazione.md)) fa **uscire con codice 2** quando lo spreco supera il budget, facendo fallire il job.

**GitHub Actions — come azione riutilizzabile.** [`action.yml`](../../action.yml) nella root del repo incapsula `npm install -g @cloudrift/cli` + `cloudrift analyze`, pubblica il report markdown nel job summary, e fa fallire il job con gli stessi exit code della CLI (`2` = oltre budget).

```yaml
name: Cloud cost check
on: [pull_request]

permissions:
  contents: read

jobs:
  cloudrift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4 # per cloudrift.config.json, letto dalla cwd

      # OIDC o chiavi statiche — qui statiche, dai secret del repo
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - uses: elleVas/cloudrift@v0.5.1
        with:
          regions: us-east-1 eu-west-1
          config: cloudrift.config.json
```

Con un `cloudrift.config.json` committato (`{"costAlertThresholdUsd": 500}`), l'azione fa fallire il check automaticamente quando lo spreco supera il budget — la pipeline si blocca quando nuove risorse lo spingono oltre la soglia. Vedi `action.yml` per tutti gli input (`live-pricing`, `scanners`, `min-age-days`, `ignore-tag`, `pdf`, `json`, `format`, `version`, …) e gli output `report`/`exit-code`.

**GitHub Actions — compilando dai sorgenti:** alternativa se preferisci puntare a un commit non ancora rilasciato invece che a una versione pubblicata.

```yaml
name: Cloud cost check
on: [pull_request]

permissions:
  contents: read

jobs:
  cloudrift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: elleVas/cloudrift
          path: cloudrift-cli

      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm', cache-dependency-path: cloudrift-cli/pnpm-lock.yaml }

      - run: pnpm install --frozen-lockfile
        working-directory: cloudrift-cli
      - run: pnpm nx build cli
        working-directory: cloudrift-cli

      # OIDC o chiavi statiche — qui statiche, dai secret del repo
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      # Pubblica il report markdown nel job summary; esce 2 se oltre costAlertThresholdUsd
      # (cloudrift.config.json viene letto dal checkout di *questo* repo, la cwd)
      - run: node cloudrift-cli/apps/cli/dist/main.js analyze -r us-east-1 eu-west-1 --format markdown >> "$GITHUB_STEP_SUMMARY"
```

Con un `cloudrift.config.json` committato (`{"costAlertThresholdUsd": 500}`), il codice di uscita 2 dell'ultimo step fa fallire il check automaticamente — la pipeline si blocca quando nuove risorse spingono lo spreco oltre la soglia.

## Policy as Code (OPA)

Il gate `costAlertThresholdUsd` qui sopra è un singolo confronto totale-vs-budget. Per qualcosa di più specifico — regole per tag, per tipo di risorsa, per conteggio — cloudrift include policy [Open Policy Agent](https://www.openpolicyagent.org/) di esempio che valuti tu contro il suo output JSON, nella tua pipeline. cloudrift non esegue mai OPA da sé; produce solo JSON, esattamente come già fa.

```sh
node apps/cli/dist/main.js analyze --format json > report.json
conftest test --policy policy report.json
```

Vedi [docs/it/policy-as-code.md](./policy-as-code.md) per una guida da zero e [policy/README.md](../../policy/README.md) per cosa verifica ogni policy di esempio. Motivazione per tenere questo livello esterno alla CLI: [ADR-0042](../adr/0042-policy-as-code-external-opa-layer.md).
