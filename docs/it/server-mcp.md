# Usare cloudrift come server MCP

> 🇬🇧 [English version](../en/mcp-server.md)

cloudrift può girare come server [MCP](https://modelcontextprotocol.io) (Model Context Protocol) locale, così un agente AI — Claude Code, Kiro, VS Code Copilot Chat (Agent mode), o qualsiasi altro client compatibile con MCP — può chiamare direttamente gli scanner di cloudrift come tool, invece che tu lanci la CLI a mano e incolli l'output di ritorno.

Questa pagina copre solo il **collegamento di un client**. Per il comando `cloudrift mcp` in sé (come avviarlo, l'interruttore `CLOUDRIFT_DISABLE_MCP`), vedi [utilizzo.md](utilizzo.md#mcp---esegui-cloudrift-come-server-mcp-locale).

## Tool esposti

| Tool | Fa chiamate AWS? | Cosa restituisce |
| --- | --- | --- |
| `analyze_cloudrift` | **Sì** — chiamate reali, con credenziali | Un report JSON aggregato sui quattro domini (spreco cloud-cost, risorse morte, sicurezza delle risorse, trend di spesa). Accetta `regions`, `livePricing`, `minAgeDays`, `ignoreTag`, `configPath` — le stesse leve di `cloudrift.config.json`. |
| `get_resource_types` | No — statico | Il catalogo completo dei tipi di risorsa che cloudrift può rilevare, con etichette. |
| `get_required_iam_permissions` | No — statico | La policy IAM in sola lettura di cui ha bisogno il principal AWS per `analyze_cloudrift`. |

`analyze_cloudrift` eredita le **stesse credenziali AWS** di ogni altro comando `cloudrift` — un agente con accesso a questo server vede tutto ciò che quelle credenziali possono vedere, non solo i finding di spreco/risorse morte/sicurezza. Tienilo presente quando decidi se auto-approvarlo (vedi la sezione di ciascun client qui sotto).

## Collegare un client

Kiro, VS Code e Claude Code usano ciascuno un **formato di configurazione diverso** — un file copiato 1:1 da uno all'altro non funzionerà.

### Kiro IDE

`.kiro/settings/mcp.json` (workspace) oppure `~/.kiro/settings/mcp.json` (globale), chiave radice `mcpServers`:

```json
{
  "mcpServers": {
    "cloudrift": {
      "command": "npx",
      "args": ["@cloudrift/cli@latest", "mcp"],
      "disabled": false,
      "autoApprove": ["get_resource_types", "get_required_iam_permissions"]
    }
  }
}
```

`analyze_cloudrift` è deliberatamente escluso da `autoApprove` sopra: è l'unico tool che fa chiamate AWS reali e con credenziali — gli altri due sono statici. Aggiungilo tu stesso quando ti senti a tuo agio con questo.

### VS Code (GitHub Copilot Chat, Agent mode)

`.vscode/mcp.json` (workspace) oppure tramite `MCP: Open User Configuration`, chiave radice `servers` (non `mcpServers`):

```json
{
  "servers": {
    "cloudrift": {
      "command": "npx",
      "args": ["@cloudrift/cli@latest", "mcp"]
    }
  }
}
```

I tool MCP sono utilizzabili solo in **Agent mode** della Chat di Copilot — non in modalità Ask/Edit.

### Claude Code

Claude Code ha tre scope di configurazione, scelti con `--scope` su `claude mcp add` (default `local`):

| Scope | Salvato in | Chi lo vede |
| --- | --- | --- |
| `local` (default) | `~/.claude.json`, solo per questo progetto | Solo tu, solo questo progetto |
| `project` | `.mcp.json` nella root del repo | Chiunque clona il repo (committa questo file se vuoi condividerlo) |
| `user` | `~/.claude.json`, a livello globale | Solo tu, tutti i progetti |

Il modo più rapido — lascia che sia la CLI a scrivere la configurazione:

```sh
claude mcp add cloudrift -- npx @cloudrift/cli@latest mcp
```

Aggiungi `--scope project` se invece vuoi che `.mcp.json` finisca committato nel repo e condiviso col resto del team (un server a scope `project` richiede un'approvazione di fiducia una tantum la prima volta che ogni collega apre il progetto). `.mcp.json` scritto a mano, equivalente:

```json
{
  "mcpServers": {
    "cloudrift": {
      "type": "stdio",
      "command": "npx",
      "args": ["@cloudrift/cli@latest", "mcp"]
    }
  }
}
```

Comandi utili: `claude mcp list` (stato di ogni server configurato), `claude mcp get cloudrift` (dettagli su questo), e `/mcp` dentro una sessione (pannello di approvazione/riconnessione). A differenza di Claude Desktop, Claude Code **non** legge `claude_desktop_config.json` — i due formati sono incompatibili (esiste un importer a senso unico, `claude mcp add-from-claude-desktop`, se hai già una config di Claude Desktop).

Qui non esiste un equivalente di `autoApprove` — Claude Code chiede l'approvazione alla prima chiamata di un tool in una sessione, secondo il proprio sistema di permessi; `analyze_cloudrift`, che fa chiamate AWS reali, è esattamente il tipo di cosa che vale la pena rivedere a quel primo prompt piuttosto che pre-approvare.

## Usare un ambiente AWS non predefinito

Un client MCP lancia `cloudrift mcp` con un ambiente ridotto e curato — **non** una copia della tua shell. Se normalmente ti appoggi a `AWS_PROFILE`, un override di regione, o altro impostato nel profilo della shell, questo **non** arriverà al server a meno che tu non lo aggiunga esplicitamente sotto `env` nella configurazione del client:

```json
{
  "mcpServers": {
    "cloudrift": {
      "command": "npx",
      "args": ["@cloudrift/cli@latest", "mcp"],
      "env": { "AWS_PROFILE": "my-profile", "AWS_REGION": "eu-west-1" }
    }
  }
}
```

(Stessa chiave `env` sotto `servers.cloudrift` di VS Code; per Claude Code, aggiungi `"type": "stdio"` accanto, oppure passa `--env AWS_PROFILE=my-profile --env AWS_REGION=eu-west-1` a `claude mcp add`.)

Un sintomo silenzioso di questa dimenticanza: ogni chiamata a un tool riesce, ma `analyze_cloudrift` restituisce un report vuoto — nessun errore, perché un fallimento di scan per regione viene catturato ed esposto come `scanErrors`/`domainErrors`, non un crash. Se i finding sembrano più scarsi del previsto, controlla `env` prima di ogni altra cosa.
