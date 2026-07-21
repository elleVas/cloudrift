# Policy as Code (OPA)

> 🇬🇧 [English version](../en/policy-as-code.md)

Questo documento parte da zero: cos'è [Open Policy Agent](https://www.openpolicyagent.org/) (OPA), perché cloudrift lo tratta come un livello esterno invece che una feature integrata, e come eseguire davvero le policy di esempio in [`policy/`](../../policy/) contro un report reale. Non è richiesta nessuna esperienza precedente con OPA/Rego.

## Cosa è (e cosa non è)

`cloudrift analyze` ha già un gate integrato: imposta `costAlertThresholdUsd` in `cloudrift.config.json` e il comando esce con codice 2 quando `totalWasteMonthlyUsd` supera quella soglia (`applyCostGate` in [`analyze-waste.command.ts`](../../apps/cli/src/commands/analyze-waste.command.ts)) — sufficiente per far fallire un job CI al superamento del budget. Vedi [Uso in CI/CD](./ci-cd.md).

Quel gate può solo confrontare un numero con un altro. Non può dire "blocca solo se la risorsa sprecata è taggata `production`" oppure "blocca se ci sono più di N volumi idle, indipendentemente dal loro costo". Regole così richiedono un vero motore di regole, valutato sui findings strutturati, non solo su un totale — ed è a questo che serve OPA.

**OPA/Rego, in un paragrafo:** OPA è un motore di policy general-purpose. Si scrivono regole in un piccolo linguaggio chiamato Rego che leggono un dato strutturato (JSON, nel nostro caso) e decidono `deny`/`allow`. È lo stesso strumento che molti team puntano già contro un piano Terraform o un manifest Kubernetes prima di farlo passare in CI. [`conftest`](https://www.conftest.dev/) è una CLI leggera costruita sopra OPA specificamente per "verifica questo file contro queste policy Rego", che è esattamente il caso d'uso di cloudrift.

**Il ruolo di cloudrift si ferma alla produzione del JSON.** Non esegue OPA, non include un binario OPA, e non guadagna nessuna nuova dipendenza per questo. Sei tu (o la tua pipeline CI) a eseguire `conftest`/`opa`, puntato sull'output `--format json` di cloudrift. Motivazione completa: [ADR-0042](../adr/0042-policy-as-code-external-opa-layer.md).

## Prerequisiti

Installa `conftest` — è lo strumento usato in tutto questo documento:

```sh
# macOS
brew install conftest

# altre piattaforme: vedi https://www.conftest.dev/install/
```

> Anche `opa` puro (`brew install opa`) funziona — `conftest` è un wrapper di comodo sopra di esso, vedi [Equivalente con opa puro](#equivalente-con-opa-puro) qui sotto. Non ti servono entrambi.

## Provalo in 30 secondi — nessun account AWS necessario

Il repo include un piccolo report di esempio in [`policy/testdata/sample-report.json`](../../policy/testdata/sample-report.json), con la stessa identica forma del vero output `cloudrift analyze --format json`, così puoi vedere le policy scattare senza toccare un account reale:

```sh
conftest test --policy policy policy/testdata/sample-report.json
```

Output atteso — tutte e tre le policy di esempio negano qualcosa di proposito, quindi questo fixture fallisce sempre:

```
FAIL - policy/testdata/sample-report.json - main - 3 unattached EBS volumes found, more than the 2 allowed
FAIL - policy/testdata/sample-report.json - main - ebs-volume (vol-0abc123def456) in production is wasting $40/month: unattached (state: available) for 19 days
FAIL - policy/testdata/sample-report.json - main - elastic-ip (eipalloc-0123456789abcdef0) in production is wasting $3.6/month: unassociated (no EC2/NAT binding)
FAIL - policy/testdata/sample-report.json - main - total monthly waste $63.6 exceeds budget $50
```

`--policy policy` dice a conftest dove trovare i file `.rego` (la cartella [`policy/`](../../policy/) nella root del repo); l'ultimo argomento è il file JSON da verificare.

## Eseguilo contro un report reale

```sh
node apps/cli/dist/main.js analyze --format json > report.json
conftest test --policy policy report.json
```

`conftest` esce con `1` se una regola ha negato qualcosa, `0` se il report è pulito — esattamente il segnale di cui ha bisogno uno step CI.

## Cosa c'è in `policy/`

| File | Regola |
| --- | --- |
| [`waste-budget.rego`](../../policy/waste-budget.rego) | Spreco mensile totale oltre un budget fisso — la versione Rego del gate nativo `costAlertThresholdUsd` |
| [`production-tag.rego`](../../policy/production-tag.rego) | Qualunque finding di spreco taggato `Environment: production` — per singolo finding, non solo sul totale |
| [`idle-resource-count.rego`](../../policy/idle-resource-count.rego) | Più di N volumi EBS non attaccati, indipendentemente dal costo di ciascuno |

Ognuno ha un file `_test.rego` gemello e una costante commentata come "la riga da modificare" — vedi [`policy/README.md`](../../policy/README.md) per il dettaglio completo. Esegui la suite di test di esempio con:

```sh
opa test policy/ -v
```

## Scrivere una tua regola

Tutti e tre i file di esempio condividono `package main`, e Rego unisce i blocchi `deny contains msg if {...}` con lo stesso nome tra file diversi in un unico insieme — quindi un quarto file ti serve solo lo stesso header di package e una sua condizione. Ad esempio, per negare qualunque finding oltre $100/mese indipendentemente dai tag:

```rego
# policy/high-cost-finding.rego
package main

import rego.v1

deny contains msg if {
	some finding in input.findings
	finding.category == "waste"
	finding.monthlyCostUsd > 100
	msg := sprintf("%s (%s) is wasting $%v/month", [finding.kind, finding.id, finding.monthlyCostUsd])
}
```

`input` è il report JSON già parsato — vedi [`WasteReportDto`](../../libs/cloud-cost/application/src/dto/waste-report.dto.ts) per l'elenco completo dei campi (`findings[].kind`, `.category`, `.tags`, `.monthlyCostUsd`, `.region`, e a livello superiore `totalWasteMonthlyUsd`, `wasteCount`, ecc.).

> **Una particolarità di Rego da conoscere subito:** il JSON di cloudrift serializza un costo che risulta essere un importo intero in dollari (es. esattamente `$40`) senza punto decimale. Il verbo di formato `%.2f` di Rego va in crash su un valore così (`%!f(int=40)`) — le policy di esempio usano `%v` al suo posto, che stampa entrambe le forme senza errori. Preferisci `%v` a `%.2f` nelle tue regole, a meno che tu non abbia verificato che il campo non possa mai essere un numero intero.

## Integrarlo in CI

Aggiungi uno step dopo la scansione, subito accanto al gate di budget nativo da [Uso in CI/CD](./ci-cd.md):

```yaml
      - run: node cloudrift-cli/apps/cli/dist/main.js analyze -r us-east-1 --format json > report.json
        working-directory: cloudrift-cli

      - uses: openpolicyagent/conftest-action@v1
        with:
          policy: cloudrift-cli/policy
          files: cloudrift-cli/report.json
```

(In alternativa, installa `conftest` direttamente con gli stessi step shell di [Prerequisiti](#prerequisiti) qui sopra ed esegui `conftest test --policy policy report.json` se preferisci non aggiungere una action da marketplace.)

## Perché esterno, non integrato nella CLI

In breve: incorporare un runtime OPA (un binario `opa` shellato o una build WASM) dentro il pacchetto npm `@cloudrift/cli` aggiungerebbe una dipendenza pesante e platform-specific per ottenere un risultato che, per la maggior parte degli utenti, un confronto numerico offre già. Il valore di un vero motore di policy emerge solo quando vuoi regole espressive, multi-segnale, o vuoi riusare un bundle OPA/Rego che già mantieni per Terraform o Kubernetes. Tenere OPA completamente fuori dal pacchetto mantiene cloudrift una CLI piccola e con poche dipendenze, e chi vuole questo livello lo attiva esplicitamente, nel proprio ambiente. Decisione completa: [ADR-0042](../adr/0042-policy-as-code-external-opa-layer.md).
