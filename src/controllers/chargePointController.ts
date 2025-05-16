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

<<<<<<< HEAD
  // if count is greater than 1, require idPrefix
  if (payload.chargePointId) {
    startSingleVcp(payload);

    return reply.send({
      status: "sucess",
      message: `VCP with ${payload.chargePointId} started`,
    });
  } else {
    startMultipleVcps(payload);

    return reply.send({
      status: "sucess",
      message: `${vcpList.length} VCPs started`,
=======
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
>>>>>>> origin/main
    });
  }
};

export const stopVcp = async (
  request: FastifyRequest<{ Body: StopVcpRequestSchema }>,
  reply: FastifyReply,
) => {
  const { vcpId, vcpIdPrefix } = request.body;

  if (!vcpId && !vcpIdPrefix) {
<<<<<<< HEAD
    vcpList = [];

    reply.send({ status: "sucess", message: "All VCPs stopped" });
  }

  if (vcpId) {
    vcpList = vcpList.filter((vcp) => vcp.vcpOptions.chargePointId !== vcpId);

    reply.send({ status: "sucess", message: `VCP with ID: ${vcpId} stopped` });
  }

  if (vcpIdPrefix) {
    vcpList = vcpList.filter(
      (vcp) => !vcp.vcpOptions.chargePointId.startsWith(vcpIdPrefix),
    );

    reply.send({
      status: "sucess",
=======
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
>>>>>>> origin/main
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
<<<<<<< HEAD
    (vcp) => vcp.vcpOptions.chargePointId === chargePointId,
=======
    (vcp: VCP) => vcp.vcpOptions.chargePointId === chargePointId,
>>>>>>> origin/main
  );

  if (!vcp) {
    return reply.send({ status: "error", message: "VCP not found" });
  }

  vcp.send({
    action,
    messageId: uuid(),
    payload,
  });

<<<<<<< HEAD
  reply.send({ status: "sucess", message: "Status updated" });
=======
  return reply.send({ status: "success", message: "Status updated" });
>>>>>>> origin/main
};

export const getVcpStatus = async (
  request: FastifyRequest<{ Querystring: StatusRequestSchema }>,
  reply: FastifyReply,
) => {
  const { verbose } = request.query;
<<<<<<< HEAD
  let response: any[] = [];

  if (verbose) {
    response = vcpList.map((vcp: VCP) => {
=======
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

  response = {meta:  {count: vcpList.length }, statusCount, endpointCount, modelCount};

  if (verbose) {
    const vpcList = vcpList.map((vcp: VCP) => {
>>>>>>> origin/main
      return {
        isFinishing: vcp.isFinishing,
        isWaiting: vcp.isWaiting,
        lastAction: vcp.lastAction,
<<<<<<< HEAD
        connectorIDs: vcp.connectorIDs,
=======
>>>>>>> origin/main
        status: vcp.status,
        ...vcp.vcpOptions,
      };
    });
<<<<<<< HEAD
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

  reply.send({ status: "sucess", data: response });
=======
    response = { ...response, vpcList: vpcList };
  }

  return reply.send({ status: "success", data: response });
>>>>>>> origin/main
};

async function startMultipleVcps(payload: StartVcpRequestSchema) {
  const {
    endpoint,
    idPrefix,
    count,
<<<<<<< HEAD
    sleepTime,
=======
>>>>>>> origin/main
    startChance,
    testCharge,
    duration,
    randomDelay,
<<<<<<< HEAD
    isTwinGun,
    ocppVersion,
  } = payload;

  const tasks: Promise<void>[] = [];
  let adminWsPort = undefined;
=======
    connectors,
    ocppVersion,
    model,
  } = payload;

  const vcps: VCP[] = [];
  const tasks: Promise<void>[] = [];

  const isTwinGun = connectors > 1;
  const connectorIds = computeConnectIds(connectors);
>>>>>>> origin/main

  for (let i = 1; i <= count!; i++) {
    const vcp = new VCP({
      endpoint,
      chargePointId: idPrefix! + i,
      ocppVersion,
      isTwinGun,
<<<<<<< HEAD
      adminWsPort,
    });

    vcpList.push(vcp);
=======
      connectorIds,
      model,
    });

    vcps.push(vcp);
>>>>>>> origin/main

    const task = (async () => {
      // Start each VCP a second apart
      await sleep(i * 1000);
      await vcp.connect();
<<<<<<< HEAD
      await bootVCP(vcp, sleepTime);
=======
      await bootVCP(vcp);
>>>>>>> origin/main
    })();

    tasks.push(task);
  }

<<<<<<< HEAD
=======
  vcpList.push(...vcps);

>>>>>>> origin/main
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
<<<<<<< HEAD
        return simulateCharge(vcp, duration, randomDelay);
=======
        return simulateCharge(vcp, duration, 1, randomDelay);
>>>>>>> origin/main
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
<<<<<<< HEAD
    sleepTime,
    testCharge,
    duration,
    isTwinGun,
    ocppVersion,
  } = payload;

=======
    testCharge,
    duration,
    connectors,
    ocppVersion,
    model,
  } = payload;

  const isTwinGun = connectors > 1;
  const connectorIds = computeConnectIds(connectors);

>>>>>>> origin/main
  const vcp = new VCP({
    endpoint,
    chargePointId: chargePointId!,
    ocppVersion,
    isTwinGun,
<<<<<<< HEAD
=======
    connectorIds,
    model,
>>>>>>> origin/main
  });

  vcpList.push(vcp);

<<<<<<< HEAD
  (async () => {
    await vcp.connect();
    bootVCP(vcp, sleepTime);

    if (testCharge) {
      simulateCharge(vcp, duration);
    }
  })();
}
=======
  await (async () => {
    await vcp.connect();
    await bootVCP(vcp);
    if (testCharge) {
      await simulateCharge(vcp, duration, 1, false);
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
>>>>>>> origin/main
