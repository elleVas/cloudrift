import { WastePolicy, waste, notWaste, type WasteVerdict, type WastePolicyOptions } from './waste-policy';
import type { EbsVolume } from '../entities/ebs-volume.entity';
import type { ElasticIp } from '../entities/elastic-ip.entity';
import type { RdsInstance } from '../entities/rds-instance.entity';
import type { LoadBalancer } from '../entities/load-balancer.entity';
import type { Ec2Instance } from '../entities/ec2-instance.entity';
import type { EbsSnapshot } from '../entities/ebs-snapshot.entity';
import type { NatGateway } from '../entities/nat-gateway.entity';
import type { Gp2Volume } from '../entities/gp2-volume.entity';
import type { IdleEbsVolume } from '../entities/idle-ebs-volume.entity';
import type { UnderutilizedEc2Instance } from '../entities/underutilized-ec2-instance.entity';
import type { RdsUnderutilizedInstance } from '../entities/rds-underutilized-instance.entity';

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

export class EbsIdlePolicy extends WastePolicy<IdleEbsVolume> {
  /** maxOps: soglia di operazioni I/O totali sotto la quale il volume è idle. */
  constructor(options: WastePolicyOptions = {}, private readonly maxOps = 0) {
    super(options);
  }

  protected judge(volume: IdleEbsVolume, now: Date): WasteVerdict {
    if (volume.totalOps() > this.maxOps) return notWaste('has I/O activity');
    // Un volume appena creato potrebbe non aver ancora ricevuto I/O.
    if (this.isWithinGracePeriod(volume.createTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`zero I/O in last ${volume.metricWindowHours}h`);
  }
}

export class Ec2UnderutilizedPolicy extends WastePolicy<UnderutilizedEc2Instance> {
  /** maxCpuPercent: soglia di CPU massima sotto cui l'istanza è sottoutilizzata. */
  constructor(options: WastePolicyOptions = {}, private readonly maxCpuPercent = 5) {
    super(options);
  }

  protected judge(instance: UnderutilizedEc2Instance, now: Date): WasteVerdict {
    if (instance.maxCpuPercent >= this.maxCpuPercent) return notWaste('CPU above threshold');
    // Un'istanza appena lanciata potrebbe non aver ancora accumulato traffico reale.
    if (this.isWithinGracePeriod(instance.launchTime, now)) {
      return notWaste(`launched less than ${this.minAgeDays}d ago`);
    }
    return waste(`max CPU ${instance.maxCpuPercent.toFixed(1)}% over ${instance.windowDays}d`);
  }
}

export class RdsUnderutilizedPolicy extends WastePolicy<RdsUnderutilizedInstance> {
  /** maxCpuPercent: soglia di CPU massima sotto cui l'istanza RDS è sottoutilizzata. */
  constructor(options: WastePolicyOptions = {}, private readonly maxCpuPercent = 5) {
    super(options);
  }

  protected judge(instance: RdsUnderutilizedInstance, now: Date): WasteVerdict {
    if (instance.maxCpuPercent >= this.maxCpuPercent) return notWaste('CPU above threshold');
    // Un'istanza appena creata potrebbe non aver ancora accumulato traffico reale.
    if (this.isWithinGracePeriod(instance.instanceCreateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(`max CPU ${instance.maxCpuPercent.toFixed(1)}% over ${instance.windowDays}d`);
  }
}

export class Gp2UpgradePolicy extends WastePolicy<Gp2Volume> {
  protected judge(volume: Gp2Volume, now: Date): WasteVerdict {
    // Il prefiltro server-side garantisce già volume-type=gp2 in-use;
    // applichiamo solo il periodo di grazia per non segnalare risorse
    // appena create (infrastruttura ancora in fase di setup).
    if (this.isWithinGracePeriod(volume.createTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste('gp2 volume upgradeable to gp3');
  }
}
