import { WastePolicy, waste, notWaste, type WasteVerdict } from './waste-policy';
import type { EbsVolume } from '../entities/ebs-volume.entity';
import type { ElasticIp } from '../entities/elastic-ip.entity';
import type { RdsInstance } from '../entities/rds-instance.entity';
import type { LoadBalancer } from '../entities/load-balancer.entity';
import type { Ec2Instance } from '../entities/ec2-instance.entity';
import type { EbsSnapshot } from '../entities/ebs-snapshot.entity';
import type { NatGateway } from '../entities/nat-gateway.entity';

export class EbsVolumeWastePolicy extends WastePolicy<EbsVolume> {
  protected judge(volume: EbsVolume, now: Date): WasteVerdict {
    if (!volume.isUnattached()) return notWaste('volume is attached');
    // AWS non espone la data di detach: l'età del volume è l'unico proxy disponibile.
    if (this.isWithinGracePeriod(volume.createTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('unattached');
  }
}

export class ElasticIpWastePolicy extends WastePolicy<ElasticIp> {
  protected judge(ip: ElasticIp): WasteVerdict {
    // Gli Elastic IP non hanno data di creazione: nessun periodo di grazia applicabile.
    return ip.isUnassociated() ? waste('unassociated') : notWaste('associated');
  }
}

export class RdsInstanceWastePolicy extends WastePolicy<RdsInstance> {
  protected judge(db: RdsInstance): WasteVerdict {
    // AWS riavvia automaticamente un'istanza stopped dopo 7 giorni: se la vediamo
    // stopped è per definizione recente, quindi il periodo di grazia non si applica.
    return db.isStopped()
      ? waste('stopped (storage and backups still billed)')
      : notWaste('not stopped');
  }
}

export class LoadBalancerWastePolicy extends WastePolicy<LoadBalancer> {
  protected judge(lb: LoadBalancer, now: Date): WasteVerdict {
    if (!lb.isIdle()) return notWaste('has registered targets');
    if (this.isWithinGracePeriod(lb.createdTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('no registered targets');
  }
}

export class Ec2InstanceWastePolicy extends WastePolicy<Ec2Instance> {
  protected judge(instance: Ec2Instance, now: Date): WasteVerdict {
    if (!instance.isStopped()) return notWaste('not stopped');
    const stoppedSince = instance.stoppedSince ?? instance.launchTime;
    if (this.isWithinGracePeriod(stoppedSince, now)) {
      return notWaste(`stopped less than ${this.minAgeDays}d ago`);
    }
    return waste('stopped (attached EBS still billed)');
  }
}

export class EbsSnapshotWastePolicy extends WastePolicy<EbsSnapshot> {
  protected judge(snapshot: EbsSnapshot, now: Date): WasteVerdict {
    if (!snapshot.isOrphan()) return notWaste('source volume still exists');
    if (snapshot.boundToAmiId) {
      // Uno snapshot referenziato da un'AMI registrata non è cancellabile.
      return notWaste(`in use by AMI ${snapshot.boundToAmiId}`);
    }
    if (this.isWithinGracePeriod(snapshot.startTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('source volume deleted');
  }
}

export class NatGatewayWastePolicy extends WastePolicy<NatGateway> {
  protected judge(gateway: NatGateway, now: Date): WasteVerdict {
    if (!gateway.isIdle()) return notWaste('has outbound traffic');
    // Un gateway più giovane del periodo di grazia potrebbe semplicemente
    // non aver ancora ricevuto traffico (es. ambiente appena creato).
    if (this.isWithinGracePeriod(gateway.createTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero traffic in last ${gateway.metricWindowHours}h`);
  }
}
