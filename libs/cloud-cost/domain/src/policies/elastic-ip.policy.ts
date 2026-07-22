// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { ElasticIp } from '../entities/elastic-ip.entity';

export class ElasticIpWastePolicy extends WastePolicy<ElasticIp> {
  protected judge(ip: ElasticIp): WasteVerdict {
    // Elastic IPs have no creation date: no grace period applicable.
    return ip.isUnassociated() ? waste('unassociated') : notWaste('associated');
  }
}
