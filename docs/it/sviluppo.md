# Sviluppo

> 🇬🇧 [English version](../en/development.md)

Modalità watch, test per libreria, lint, typecheck.

```sh
# Avvia la CLI in modalità watch (ricompila automaticamente)
pnpm nx serve cli

# Esegui tutti i test
pnpm nx run-many -t test

# Esegui i test di una singola libreria
pnpm nx test shared-kernel
pnpm nx test cloud-cost-domain
pnpm nx test cloud-cost-application
pnpm nx test cloud-cost-infrastructure-aws-adapter

# Lint
pnpm nx run-many -t lint

# Type check
pnpm nx run-many -t typecheck
```

Il logging diagnostico è opt-in tramite `DEBUG=cloudrift:*` (es. `DEBUG=cloudrift:* cloudrift analyze ...`), disattivato di default. Scrive su stderr, separato dal report — ma il suo output include ID di risorse AWS (volume ID, instance ID, ecc.) del tuo account. Non incollare l'output di `DEBUG` in una issue GitHub pubblica né condividerlo fuori dalla tua organizzazione senza prima controllarlo.
