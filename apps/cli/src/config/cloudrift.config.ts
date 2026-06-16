import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { DomainError, Result } from 'shared-kernel';

/**
 * Nomi di file cercati nel CWD, in ordine di priorità.
 */
const CONFIG_FILENAMES = ['cloudrift.config.json', '.cloudriftrc'] as const;

/** Finestra CloudWatch massima consentita (7 giorni). */
export const MAX_CLOUDWATCH_WINDOW_HOURS = 168;

/**
 * Configurazione opzionale letta da `cloudrift.config.json` o `.cloudriftrc`.
 * Ogni campo è opzionale: i flag CLI hanno la precedenza, poi il file di
 * config, poi i default nel codice.
 */
export interface CloudriftConfig {
  /** Regioni da escludere dallo scan anche se passate via -r. */
  excludeRegions?: string[];
  /** Coppie tag=valore che escludono una risorsa (es. { "Environment": "Production" }). */
  excludeTagValues?: Record<string, string>;
  /** Finestra temporale (ore) per le metriche CloudWatch. Default 48, max 168. */
  cloudwatchWindowHours?: number;
  /** Periodo di grazia in giorni. Override di --min-age-days. */
  minAgeDays?: number;
  /** Tag di esclusione esplicita. Override di --ignore-tag. */
  ignoreTag?: string;
  /** Soglia di costo mensile: se superata, il comando esce con codice 2 (utile in CI). */
  costAlertThresholdUsd?: number;
}

export class ConfigError extends DomainError {
  constructor(message: string) {
    super('INVALID_CONFIG', message);
  }
}

/**
 * Carica la configurazione dal CWD (o da un percorso esplicito).
 * Nessun file trovato → config vuota (tutto da CLI/default).
 */
export async function loadConfig(
  cwd: string,
  explicitPath?: string,
): Promise<Result<CloudriftConfig, ConfigError>> {
  if (explicitPath) {
    const path = resolve(cwd, explicitPath);
    const raw = await tryRead(path);
    if (raw === undefined) {
      return Result.fail(new ConfigError(`Config file not found: ${path}`));
    }
    return parseConfig(raw, path);
  }

  for (const name of CONFIG_FILENAMES) {
    const path = resolve(cwd, name);
    const raw = await tryRead(path);
    if (raw !== undefined) return parseConfig(raw, path);
  }
  return Result.ok({});
}

async function tryRead(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Validazione pura del contenuto del file (separata dall'IO per testabilità).
 * Chiavi sconosciute vengono ignorate (forward-compatible); le chiavi note
 * vengono validate per tipo e l'errore aggrega tutti i problemi trovati.
 */
export function parseConfig(
  raw: string,
  source = '<config>',
): Result<CloudriftConfig, ConfigError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Result.fail(new ConfigError(`Config file is not valid JSON: ${source}`));
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return Result.fail(new ConfigError(`Config root must be a JSON object: ${source}`));
  }

  const obj = parsed as Record<string, unknown>;
  const config: CloudriftConfig = {};
  const errors: string[] = [];

  if (obj.excludeRegions !== undefined) {
    if (isStringArray(obj.excludeRegions)) {
      config.excludeRegions = obj.excludeRegions;
    } else {
      errors.push('excludeRegions must be an array of strings');
    }
  }

  if (obj.excludeTagValues !== undefined) {
    if (isStringRecord(obj.excludeTagValues)) {
      config.excludeTagValues = obj.excludeTagValues;
    } else {
      errors.push(
        'excludeTagValues must be an object with string values (e.g. { "Environment": "Production" })',
      );
    }
  }

  if (obj.cloudwatchWindowHours !== undefined) {
    const n = obj.cloudwatchWindowHours;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= MAX_CLOUDWATCH_WINDOW_HOURS) {
      config.cloudwatchWindowHours = n;
    } else {
      errors.push(`cloudwatchWindowHours must be a number between 1 and ${MAX_CLOUDWATCH_WINDOW_HOURS}`);
    }
  }

  if (obj.minAgeDays !== undefined) {
    const n = obj.minAgeDays;
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0) {
      config.minAgeDays = n;
    } else {
      errors.push('minAgeDays must be a non-negative integer');
    }
  }

  if (obj.ignoreTag !== undefined) {
    if (typeof obj.ignoreTag === 'string' && obj.ignoreTag.length > 0) {
      config.ignoreTag = obj.ignoreTag;
    } else {
      errors.push('ignoreTag must be a non-empty string');
    }
  }

  if (obj.costAlertThresholdUsd !== undefined) {
    const n = obj.costAlertThresholdUsd;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) {
      config.costAlertThresholdUsd = n;
    } else {
      errors.push('costAlertThresholdUsd must be a non-negative number');
    }
  }

  if (errors.length > 0) {
    return Result.fail(
      new ConfigError(`Invalid config (${source}):\n  - ${errors.join('\n  - ')}`),
    );
  }
  return Result.ok(config);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((val) => typeof val === 'string')
  );
}
