// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { OpenSearchDomain } from '../entities/opensearch-domain.entity';

export class OpenSearchIdleDomainPolicy extends WastePolicy<OpenSearchDomain> {
  protected judge(domain: OpenSearchDomain): WasteVerdict {
    // DescribeDomains exposes no creation date: no grace period applicable.
    return domain.isIdle() ? waste('no search/indexing traffic') : notWaste('has search/indexing traffic');
  }
}
