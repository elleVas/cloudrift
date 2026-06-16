import type { Result } from 'shared-kernel';
import type { ResourceKind, WastedResource } from '../../wasted-resource';
import type { AwsRegion } from '../../value-objects/aws-region.value-object';

/**
 * Porta outbound unica per la rilevazione dello spreco: ogni tipo di
 * risorsa è un'implementazione (plugin) di questa porta. Il contratto
 * richiede che lo scanner restituisca solo risorse già confermate come
 * spreco dalla relativa waste policy di dominio.
 */
export interface WasteScannerPort {
  readonly kind: ResourceKind;
  scan(region: AwsRegion): Promise<Result<WastedResource[]>>;
}
