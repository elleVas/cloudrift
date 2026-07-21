# Fonti dei prezzi

> 🇬🇧 [English version](../en/pricing-sources.md)

Tabella statica, AWS Pricing API live, e i tuoi override.

I costi sono risolti da tre livelli; vince il più specifico, per `(regione, chiave)`:

1. **I tuoi override `prices`** (config) — le tue tariffe negoziate/aziendali. **Massima priorità.**
2. **AWS Pricing API** (`--live-pricing`) — listino pubblico corrente, recuperato all'avvio.
3. **Tabella statica built-in** (`prices.json`) — sempre presente come fallback.

Ogni report mostra `prices as of` (la data dello statico, quella del fetch live, o `+ custom overrides`).

> **Nota onesta:** anche con `--live-pricing`, AWS restituisce i prezzi di **listino**, non la *tua* bolletta — Savings Plans, Reserved Instances e sconti EDP non sono riflessi. Gli override `prices` sono l'unico modo per far combaciare il report con ciò che paghi davvero. Tutto ciò che il live non riesce a risolvere in modo univoco ricade sulla tabella statica.
