import { FastifyReply, FastifyRequest } from "fastify";
import { VCP } from "../vcp";
import { simulateCharge } from "../vcp_commands/simulateCharge";
import { bootVCP } from "../vcp_commands/bootVcp";
import { sleep } from "../utils";
import { v4 as uuid } from "uuid";
import {
  ChangeVcpStatusRequestSchema,
  StartVcpRequestSchema,
  StatusRequestSchema,
  StopVcpRequestSchema,
} from "../schema";
import { transactionManager } from "../v16/transactionManager";

let vcpList: VCP[] = [];

export const startVcp = async (
  request: FastifyRequest<{ Body: StartVcpRequestSchema }>,
  reply: FastifyReply,
) => {
  const payload = request.body;

  if (payload.chargePointId) {
    const vcpWithChargePointId = vcpList.find(
      (vcp: VCP) => vcp.vcpOptions.chargePointId === payload.chargePointId,
    );

    if (vcpWithChargePointId) {
      return reply.send({
        status: "error",
        message: `VCP with ${payload.chargePointId} already started`,
      });
    }

    startSingleVcp(payload);

    return reply.send({
      status: "success",
      message: `VCP with ${payload.chargePointId} started`,
    });
  } else {
    const vcpWithIdPrefix = vcpList.find((vcp: VCP) =>
      vcp.vcpOptions.chargePointId.startsWith(payload.idPrefix!),
    );

    if (vcpWithIdPrefix) {
      return reply.send({
        status: "error",
        message: `VCPs with ${payload.idPrefix} already started`,
      });
    }

    startMultipleVcps(payload);

    return reply.send({
      status: "success",
      message: `${payload.count} VCPs started`,
    });
  }
};

export const stopVcp = async (
  request: FastifyRequest<{ Body: StopVcpRequestSchema }>,
  reply: FastifyReply,
) => {
  const { vcpId, vcpIdPrefix } = request.body;

  if (!vcpId && !vcpIdPrefix) {
    for (let index = 0; index < vcpList.length; index++) {
      const vcp = vcpList[index];

      vcp.disconnect();

      vcpList.splice(index, 1);
    }

    return reply.send({ status: "success", message: "All VCPs stopped" });
  }

  if (vcpId) {
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

  if (vcpIdPrefix) {
    vcpList
      .filter((vcp: VCP) =>
        vcp.vcpOptions.chargePointId.startsWith(vcpIdPrefix),
      )
      .forEach((vcp: VCP) => {
        vcp.disconnect();

        vcpList.splice(vcpList.indexOf(vcp), 1);
      });

    return reply.send({
      status: "success",
      message: `VCPs with ID prefix: ${vcpIdPrefix} stopped`,
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

  vcp.send({
    action,
    messageId: uuid(),
    payload,
  });

  return reply.send({ status: "success", message: "Status updated" });
};

export const sendCommand = async (
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

  // @ts-ignore
  if (action == "Faulted Restart") {
    // @ts-ignore
    let connectorId = payload.connectorId || 1;
    // @ts-ignore
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
  } else {
    vcp.send({
      action,
      messageId: uuid(),
      payload,
    });
  }

  return reply.send({ status: "success", message: action + " Command Sent" });
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

  response = {
    meta: { count: vcpList.length },
    statusCount,
    endpointCount,
    modelCount,
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
    idPrefix,
    count,
    startChance,
    testCharge,
    duration,
    randomDelay,
    connectors,
    ocppVersion,
    model,
  } = payload;

  const vcps: VCP[] = [];
  const tasks: Promise<void>[] = [];

  const isTwinGun = connectors > 1;
  const connectorIds = computeConnectIds(connectors);

  for (let i = 1; i <= count!; i++) {
    const vcp = new VCP({
      endpoint,
      chargePointId: idPrefix! + i,
      ocppVersion,
      isTwinGun,
      connectorIds,
      model,
    });

    vcps.push(vcp);

    const task = (async () => {
      // Start each VCP a second apart
      await sleep(i * 1000);
      await vcp.connect();
      await bootVCP(vcp);
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

async function startSingleVcp(payload: StartVcpRequestSchema) {
  const {
    endpoint,
    chargePointId,
    testCharge,
    duration,
    randomDelay,
    connectors,
    ocppVersion,
    model,
  } = payload;

  const isTwinGun = connectors > 1;
  const connectorIds = computeConnectIds(connectors);

  const vcp = new VCP({
    endpoint,
    chargePointId: chargePointId!,
    ocppVersion,
    isTwinGun,
    connectorIds,
    model,
  });

  vcpList.push(vcp);

  await (async () => {
    await vcp.connect();
    await bootVCP(vcp);

    if (testCharge) {
      await simulateCharge(vcp, duration, 1, randomDelay);
    }
  })();
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
