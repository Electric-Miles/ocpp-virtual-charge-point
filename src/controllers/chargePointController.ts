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

let vcpList: VCP[] = [];

export const startVcp = async (
  request: FastifyRequest<{ Body: StartVcpRequestSchema }>,
  reply: FastifyReply,
) => {
  const payload = request.body;

  if (payload.chargePointId) {
    const vcpWithChargePointId = vcpList.find(
      (vcp) => vcp.vcpOptions.chargePointId === payload.chargePointId,
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
    const vcpWithIdPrefix = vcpList.find((vcp) =>
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

      delete vcpList[index];
    }

    return reply.send({ status: "success", message: "All VCPs stopped" });
  }

  if (vcpId) {
    const vcp = vcpList.find((vcp) => vcp.vcpOptions.chargePointId === vcpId);

    if (!vcp) {
      return reply.send({ status: "error", message: "VCP not found" });
    }

    vcp.disconnect();

    const vcpIndex = vcpList.findIndex(
      (vcp) => vcp.vcpOptions.chargePointId === vcpId,
    );

    delete vcpList[vcpIndex];

    return reply.send({
      status: "success",
      message: `VCP with ID: ${vcpId} stopped`,
    });
  }

  if (vcpIdPrefix) {
    const vcps = vcpList.filter((vcp, index, vcpList) => {
      if (vcp.vcpOptions.chargePointId.startsWith(vcpIdPrefix)) {
        delete vcpList[index];

        return true;
      }

      return false;
    });

    for (let index = 0; index < vcps.length; index++) {
      const vcp = vcps[index];

      vcp.disconnect();
    }

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
    (vcp) => vcp.vcpOptions.chargePointId === chargePointId,
  );

  if (!vcp) {
    return reply.send({ status: "error", message: "VCP not found" });
  }

  vcp.send({
    action,
    messageId: uuid(),
    payload,
  });

  return reply.send({ status: "success", message: "Status updated" });
};

export const getVcpStatus = async (
  request: FastifyRequest<{ Querystring: StatusRequestSchema }>,
  reply: FastifyReply,
) => {
  const { verbose } = request.query;
  let response: any[] = [];

  if (verbose) {
    response = vcpList.map((vcp: VCP) => {
      return {
        isFinishing: vcp.isFinishing,
        isWaiting: vcp.isWaiting,
        lastAction: vcp.lastAction,
        connectorIDs: vcp.connectorIDs,
        status: vcp.status,
        ...vcp.vcpOptions,
      };
    });
  } else {
    const data = vcpList.map((vcp: VCP) => {
      return {
        chargePointId: vcp.vcpOptions.chargePointId,
        status: vcp.status,
        endpoint: vcp.vcpOptions.endpoint,
      };
    });

    response.push(data);
    response.push({ meta: { count: data.length } });
  }

  return reply.send({ status: "success", data: response });
};

async function startMultipleVcps(payload: StartVcpRequestSchema) {
  const {
    endpoint,
    idPrefix,
    count,
    sleepTime,
    startChance,
    testCharge,
    duration,
    randomDelay,
    isTwinGun,
    ocppVersion,
  } = payload;

  const tasks: Promise<void>[] = [];
  let adminWsPort = undefined;

  for (let i = 1; i <= count!; i++) {
    const vcp = new VCP({
      endpoint,
      chargePointId: idPrefix! + i,
      ocppVersion,
      isTwinGun,
      adminWsPort,
    });

    vcpList.push(vcp);

    const task = (async () => {
      // Start each VCP a second apart
      await sleep(i * 1000);
      await vcp.connect();
      await bootVCP(vcp, sleepTime);
    })();

    tasks.push(task);
  }

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
        return simulateCharge(vcp, duration, randomDelay);
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
    sleepTime,
    testCharge,
    duration,
    isTwinGun,
    ocppVersion,
  } = payload;

  const vcp = new VCP({
    endpoint,
    chargePointId: chargePointId!,
    ocppVersion,
    isTwinGun,
  });

  vcpList.push(vcp);

  (async () => {
    await vcp.connect();
    bootVCP(vcp, sleepTime);

    if (testCharge) {
      simulateCharge(vcp, duration);
    }
  })();
}
