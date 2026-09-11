import { FastifyReply, FastifyRequest } from "fastify";
import { VCP } from "../vcp";
import { simulateCharge } from "../vcp_commands/simulateCharge";
import { bootVCP } from "../vcp_commands/bootVcp";
import { sleep } from "../utils";
import { v4 as uuid } from "uuid";
import {
  ChangeVcpStatusRequestSchema,
  ConnectorStatusRequestSchema,
  SetChargingProfileRequestSchema,
  StartDlmRequestSchema,
  StartVcpRequestSchema,
  StatusRequestSchema,
  StopDlmRequestSchema,
  StopVcpRequestSchema,
  UpdateDlmRequestSchema,
} from "../schema";
import { transactionManager } from "../v16/transactionManager";
import {
  clearChargingProfiles,
  ProfilePurpose,
  resolveEffectiveLimit,
} from "../v16/chargingProfiles";
import { DlmDevice } from "../dlm/dlmDevice";
import { listDlmDeviceTypes, resolveDlmDeviceType } from "../dlm/registry";

let vcpList: VCP[] = [];
let dlmDevices: DlmDevice[] = [];

/**
 * Total live charger load (watts) across all running VCPs in this process, using
 * the effective DLM limit where one applies (else the charger's rated power).
 * Injected into DlmDevice so the emulated site-meter feed reflects EV demand.
 */
function totalChargerLoadWatts(): number {
  return vcpList.reduce(
    (total, vcp) => total + transactionManager.getChargerLoadWatts(vcp),
    0,
  );
}

export const startVcp = async (
  request: FastifyRequest<{ Body: StartVcpRequestSchema }>,
  reply: FastifyReply,
) => {
  const payload = request.body;

  if (payload.count === 1) {
    const vcpWithChargePointId = vcpList.find(
      (vcp: VCP) => vcp.vcpOptions.chargePointId === payload.chargePointId,
    );

    if (vcpWithChargePointId) {
      return reply.send({
        status: "error",
        message: `VCP with ${payload.chargePointId} already started`,
      });
    }

    startMultipleVcps(payload);

    return reply.send({
      status: "success",
      message: `${payload.chargePointId} VCP started`,
    });
  } else {
    const vcpWithIdPrefix = vcpList.find((vcp: VCP) =>
      vcp.vcpOptions.chargePointId.startsWith(payload.chargePointId!),
    );

    if (vcpWithIdPrefix) {
      return reply.send({
        status: "error",
        message: `VCPs with ${payload.chargePointId} already started`,
      });
    }

    startMultipleVcps(payload);

    return reply.send({
      status: "success",
      message: `${payload.count} VCPs started with prefix ${payload.chargePointId}`,
    });
  }
};

export const stopVcp = async (
  request: FastifyRequest<{ Body: StopVcpRequestSchema }>,
  reply: FastifyReply,
) => {
  const { vcpId, isPrefix } = request.body;

  if (!vcpId) {
    for (let index = 0; index < vcpList.length; index++) {
      const vcp = vcpList[index];
      vcp.disconnect();
      vcpList.splice(index, 1);
    }
    return reply.send({ status: "success", message: "All VCPs stopped" });
  }

  if (vcpId && !isPrefix) {
    const vcp = vcpList.find(
      (vcp: VCP) => vcp.vcpOptions.chargePointId === vcpId,
    );

    if (!vcp) {
      return reply.send({ status: "error", message: "VCP not found" });
    }

    vcp.disconnect();

    vcpList.splice(vcpList.indexOf(vcp), 1);

    return reply.send({
      status: "success",
      message: `VCP with ID: ${vcpId} stopped`,
    });
  }

  if (vcpId && isPrefix) {
    vcpList
      .filter((vcp: VCP) =>
        vcp.vcpOptions.chargePointId.startsWith(vcpId),
      )
      .forEach((vcp: VCP) => {
        vcp.disconnect();

        vcpList.splice(vcpList.indexOf(vcp), 1);
      });

    return reply.send({
      status: "success",
      message: `VCPs with ID prefix: ${vcpId} stopped`,
    });
  }
};

export const changeVcpStatus = async (
  request: FastifyRequest<{ Body: ChangeVcpStatusRequestSchema }>,
  reply: FastifyReply,
) => {
  const { chargePointId, action, payload } = request.body;

  const vcp = vcpList.find(
    (vcp: VCP) => vcp.vcpOptions.chargePointId === chargePointId,
  );

  if (!vcp) {
    return reply.send({ status: "error", message: "VCP not found" });
  }

  console.log("action:" + action);

  let requestJson = vcp.send({
    action,
    messageId: uuid(),
    payload,
  });

  return reply.send({ status: "success", message: "Status updated", requestJson: requestJson });
};

export const sendCommand = async (
  request: FastifyRequest<{ Body: ChangeVcpStatusRequestSchema }>,
  reply: FastifyReply,
) => {
  const { chargePointId, action, payload }: { chargePointId: string; action: string; payload: any } = request.body;

  const vcp = vcpList.find(
    (vcp: VCP) => vcp.vcpOptions.chargePointId === chargePointId,
  );

  if (!vcp) {
    return reply.send({ status: "error", message: "VCP not found" });
  }

  var requestJson = '';

  if (action == "Faulted Restart") {

    let connectorId = payload.connectorId || 1;
    let idTag = payload.idTag || "AABBCCDD";

    await vcp.sendAndWait({
      messageId: uuid(),
      action: "StatusNotification",
      payload: {
        connectorId: connectorId,
        errorCode: "OtherError",
        vendorErrorCode: "PENError",
        status: "Faulted",
        timestamp: new Date(),
      },
    });

    let transId =
        transactionManager.getTransactionIdByVcp(vcp, connectorId) ?? 1;
    console.log(`transactionId for stopNotif : ${transId}`);

    await vcp.sendAndWait({
      action: "StopTransaction",
      messageId: uuid(),
      payload: {
        transactionId: transId,
        timestamp: new Date(),
        meterStop: transactionManager.getMeterValue(transId),
      },
    });

    await vcp.sendAndWait({
      action: "Authorize",
      messageId: uuid(),
      payload: {
        idTag: idTag,
      },
    });

    await vcp.sendAndWait({
      action: "StartTransaction",
      messageId: uuid(),
      payload: {
        idTag: idTag,
        connectorId: connectorId,
        meterStart: transactionManager.getMeterValue(transId),
        timestamp: new Date(),
      },
    });

    await vcp.sendAndWait({
      messageId: uuid(),
      action: "StatusNotification",
      payload: {
        connectorId: connectorId,
        errorCode: "NoError",
        status: "Charging",
        timestamp: new Date(),
      },
    });

    requestJson = "StopTransaction > Authorize > StartTransaction > StatusNotification";
  } else if (action == "StopTransaction") {
    // add last transaction id to payload
    payload.transactionId = transactionManager.getTransactionIdByVcp(vcp, payload.connectorId);
    if (!payload.transactionId) {
      return reply.send({ status: "error", message: "Transaction not found" });
    }
    delete payload.connectorId;
    requestJson = vcp.send({
      action,
      messageId: uuid(),
      payload,
    });
  } else {
    requestJson = vcp.send({
      action,
      messageId: uuid(),
      payload,
    });
  }

  return reply.send({ status: "success", message: action + " Command Sent", requestJson: requestJson });
};

export const getConnectorStatus = async (
  request: FastifyRequest<{ Querystring: ConnectorStatusRequestSchema }>,
  reply: FastifyReply,
) => {
  const { chargePointId, connectorId } = request.query;

  const vcp = vcpList.find(
    (v: VCP) => v.vcpOptions.chargePointId === chargePointId,
  );

  if (!vcp) {
    return reply.send({ status: "error", message: "VCP not found" });
  }

  const cid = connectorId ?? 1;
  const transactionId = transactionManager.getTransactionIdByVcp(vcp, cid);
  const transaction = transactionId
    ? transactionManager.transactions.get(transactionId.toString())
    : undefined;
  const eff = resolveEffectiveLimit(vcp, cid, new Date(), {
    transactionId,
    transactionStartedAt: transaction?.startedAt,
  });

  return reply.send({
    status: "success",
    data: {
      chargePointId: vcp.vcpOptions.chargePointId,
      connectorId: cid,
      connectorStatus: vcp.status,
      lastAction: vcp.lastAction,
      appliedLimitAmps: eff.unlimited ? null : Number(eff.limitAmps.toFixed(2)),
      appliedLimitWatts: eff.unlimited ? null : Math.round(eff.limitWatts),
      numberPhases: eff.numberPhases,
      limitSource: eff.source ?? null,
      activeProfileCount: vcp.chargingProfiles.length,
    },
  });
};

export const setChargingProfile = async (
  request: FastifyRequest<{ Body: SetChargingProfileRequestSchema }>,
  reply: FastifyReply,
) => {
  const {
    chargePointId,
    connectorId,
    limit,
    unit,
    purpose,
    stackLevel,
    numberPhases,
    duration,
    clear,
  } = request.body;

  const vcp = vcpList.find(
    (v: VCP) => v.vcpOptions.chargePointId === chargePointId,
  );

  if (!vcp) {
    return reply.send({ status: "error", message: "VCP not found" });
  }

  const cid = connectorId ?? 1;

  if (clear) {
    const removed = clearChargingProfiles(vcp, {});
    transactionManager.sendMeterValuesNow(vcp, 0);
    return reply.send({
      status: "success",
      message: removed ? "Charging profiles cleared" : "No profiles to clear",
    });
  }

  if (limit === undefined) {
    return reply.send({ status: "error", message: "limit is required" });
  }

  const csChargingProfiles = {
    chargingProfileId: Date.now() % 2147483647,
    stackLevel: stackLevel ?? 0,
    chargingProfilePurpose: (purpose ?? "TxProfile") as ProfilePurpose,
    chargingProfileKind: "Absolute" as const,
    chargingSchedule: {
      chargingRateUnit: (unit ?? "A") as "A" | "W",
      duration: duration ?? 86400,
      startSchedule: new Date().toISOString(),
      chargingSchedulePeriod: [
        {
          startPeriod: 0,
          limit: limit,
          numberPhases: numberPhases ?? vcp.numberOfPhases,
        },
      ],
    },
  };

  const { status, effective } = vcp.applyChargingProfile(
    cid,
    csChargingProfiles,
  );

  return reply.send({
    status: "success",
    message: `Charging profile ${status}`,
    data: { status, effective, csChargingProfiles },
  });
};

export const getVcpStatus = async (
  request: FastifyRequest<{ Querystring: StatusRequestSchema }>,
  reply: FastifyReply,
) => {
  const { verbose } = request.query;
  let response: any = {};

  // count how many vcp in each status
  const statusCount = vcpList.reduce((acc: any, vcp: VCP) => {
    acc[vcp.status] = (acc[vcp.status] || 0) + 1;
    return acc;
  }, {});

  // count how many vcp in each endpoint
  const endpointCount = vcpList.reduce((acc: any, vcp: VCP) => {
    acc[vcp.vcpOptions.endpoint] = (acc[vcp.vcpOptions.endpoint] || 0) + 1;
    return acc;
  }, {});

  // count how many vcp in each model
  const modelCount = vcpList.reduce((acc: any, vcp: VCP) => {
    acc[vcp.vcpOptions.model] = (acc[vcp.vcpOptions.model] || 0) + 1;
    return acc;
  }, {});

  const lastCloseReasonCount = vcpList.reduce((acc: any, vcp: VCP) => {
    if (!vcp.lastCloseReason) return acc;
    acc[vcp.lastCloseReason] = (acc[vcp.lastCloseReason] || 0) + 1;
    return acc;
  }, {});

  response = {
    meta: { count: vcpList.length },
    statusCount,
    endpointCount,
    modelCount,
    lastCloseReasonCount,
  };

  if (verbose) {
    const vpcList = vcpList.map((vcp: VCP) => {
      return {
        isFinishing: vcp.isFinishing,
        isWaiting: vcp.isWaiting,
        lastAction: vcp.lastAction,
        status: vcp.status,
        ...vcp.vcpOptions,
      };
    });
    response = { ...response, vpcList: vpcList };
  }

  return reply.send({ status: "success", data: response });
};

async function startMultipleVcps(payload: StartVcpRequestSchema) {
  const {
    endpoint,
    chargePointId,
    count,
    startChance,
    testCharge,
    sendBootStatus,
    duration,
    randomDelay,
    connectors,
    power,
    numberOfPhases,
    ocppVersion,
    model,
    sendMeterValues,
    mixedMeterValues,
    continueMeterValueFromPreviousTransaction,
    sendStopTransactionThenStatusNotification,
  } = payload;

  const vcps: VCP[] = [];
  const tasks: Promise<void>[] = [];

  const isTwinGun = connectors > 1;
  const connectorIds = computeConnectIds(connectors);

  for (let i = 1; i <= count!; i++) {
    const vcp = new VCP({
      endpoint,
      chargePointId: (count === 1 ? chargePointId! : chargePointId! + i),
      ocppVersion,
      isTwinGun,
      connectorIds,
      model,
      power,
      numberOfPhases,
      sendMeterValues,
      mixedMeterValues,
      continueMeterValueFromPreviousTransaction,
      sendStopTransactionThenStatusNotification,
    });

    vcps.push(vcp);

    const task = (async () => {
      await sleep(i * 300);
      await vcp.connect();
      if (sendBootStatus) {
        await bootVCP(vcp);
      } else {
        vcp.status = "Available";
        vcp.configureHeartbeat(300_000);
      }
    })();
    tasks.push(task);
  }

  vcpList.push(...vcps);

  // Wait for all VCPs to be connected and initialized
  await Promise.all(tasks);

  console.log(`${vcpList.length} VCPs loaded...`);

  // After all VCPs have been initialized, start the simulateCharge function concurrently for each VCP
  if (testCharge) {
    const chargeTasks = vcpList.map((vcp) => {
      // VCP performs simulateCharge based on startChance
      const randomChance = Math.floor(Math.random() * 100);
      console.log(`randomChance: ${randomChance}`);

      if (randomChance <= startChance) {
        return simulateCharge(vcp, duration, 1, randomDelay);
      } else {
        return Promise.resolve();
      }
    });

    await Promise.all(chargeTasks);
  }
}


function computeConnectIds(connectors: number) {
  const connectorIds = [];

  if (connectors > 1) {
    for (let index = 1; index <= connectors; index++) {
      connectorIds.push(index);
    }
  } else {
    connectorIds.push(1);
  }

  return connectorIds;
}

export const getDlmDeviceTypes = async (
  _request: FastifyRequest,
  reply: FastifyReply,
) => {
  return reply.send({ status: "success", data: listDlmDeviceTypes() });
};

export const startDlmDevice = async (
  request: FastifyRequest<{ Body: StartDlmRequestSchema }>,
  reply: FastifyReply,
) => {
  const {
    endpoint,
    deviceTypeId,
    deviceId,
    nonChargerLoadWatts,
    includeChargerLoad,
    voltagePerPhase,
    phases,
    reportIntervalMs,
    voltageSensePhases,
    phaseBalance,
    unmeasuredPhaseOffsetsW,
    quantisation,
    reportEnergyRegister,
  } = request.body;

  if (dlmDevices.find((d) => d.options.deviceId === deviceId)) {
    return reply.send({
      status: "error",
      message: `DLM device ${deviceId} already started`,
    });
  }

  try {
    resolveDlmDeviceType(deviceTypeId);
  } catch (e) {
    return reply.send({
      status: "error",
      message: `Unknown DLM device type: ${deviceTypeId}`,
    });
  }

  const device = new DlmDevice({
    endpoint,
    deviceTypeId,
    deviceId,
    nonChargerLoadWatts: nonChargerLoadWatts ?? 0,
    includeChargerLoad: includeChargerLoad ?? true,
    voltagePerPhase,
    phases,
    reportIntervalMs,
    voltageSensePhases,
    phaseBalance,
    unmeasuredPhaseOffsetsW,
    quantisation,
    reportEnergyRegister,
    loadProvider: totalChargerLoadWatts,
  });

  dlmDevices.push(device);

  try {
    await device.connect();
  } catch (e) {
    dlmDevices = dlmDevices.filter((d) => d !== device);
    return reply.send({
      status: "error",
      message: `Failed to connect DLM device: ${(e as Error).message}`,
    });
  }

  return reply.send({
    status: "success",
    message: `DLM device ${deviceId} started`,
  });
};

export const updateDlmDevice = async (
  request: FastifyRequest<{ Body: UpdateDlmRequestSchema }>,
  reply: FastifyReply,
) => {
  const { deviceId, nonChargerLoadWatts } = request.body;

  const device = dlmDevices.find((d) => d.options.deviceId === deviceId);
  if (!device) {
    return reply.send({ status: "error", message: "DLM device not found" });
  }

  if (nonChargerLoadWatts !== undefined) {
    device.updateNonChargerLoad(nonChargerLoadWatts);
  }

  return reply.send({
    status: "success",
    message: "DLM device updated",
    data: device.getStatus(),
  });
};

export const stopDlmDevice = async (
  request: FastifyRequest<{ Body: StopDlmRequestSchema }>,
  reply: FastifyReply,
) => {
  const { deviceId } = request.body;

  if (!deviceId) {
    dlmDevices.forEach((d) => d.stop());
    dlmDevices = [];
    return reply.send({ status: "success", message: "All DLM devices stopped" });
  }

  const device = dlmDevices.find((d) => d.options.deviceId === deviceId);
  if (!device) {
    return reply.send({ status: "error", message: "DLM device not found" });
  }

  device.stop();
  dlmDevices = dlmDevices.filter((d) => d !== device);

  return reply.send({
    status: "success",
    message: `DLM device ${deviceId} stopped`,
  });
};

export const getDlmStatus = async (
  _request: FastifyRequest,
  reply: FastifyReply,
) => {
  return reply.send({
    status: "success",
    data: {
      types: listDlmDeviceTypes(),
      devices: dlmDevices.map((d) => d.getStatus()),
    },
  });
};
