// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { EcrImageUntagged } from '../entities/ecr-image-untagged.entity';

export class EcrImageUntaggedPolicy extends WastePolicy<EcrImageUntagged> {
  protected judge(image: EcrImageUntagged, now: Date): WasteVerdict {
    // The scanner only builds entities for already-untagged images; we only
    // apply the grace period so as not to flag an image mid-push/mid-CI-tag.
    if (this.isWithinGracePeriod(image.imagePushedAt, now)) {
      return notWaste(`pushed less than ${this.minAgeDays}d ago`);
    }
    return waste('no image tag');
  }
}
