import { FastifyReply, FastifyRequest } from "fastify";
import { VCP } from "../vcp";
import { OcppVersion } from "../ocppVersion";
import { simulateCharge } from "../vcp_commands/simulateCharge";
import { bootVCP } from "../vcp_commands/bootVcp";
import { sleep } from "../utils";
import "dotenv/config";
import { v4 as uuid } from "uuid";

interface StartChargePointsRequest {
  idPrefix: string;
  count: number;
  sleepTime: number;
  startChance: number;
  testCharge: boolean;
  duration: number;
  randomDelay: boolean;
  isTwinGun: boolean;
  adminPort?: string;
  adminPortIncrement?: boolean;
  ocppVersion?: string;
}

const vcpList: VCP[] = [];

export const startChargePoints = async (
  request: FastifyRequest<{ Body: StartChargePointsRequest }>,
  reply: FastifyReply,
) => {
  const payload = request.body;

  try {
    run(payload);

    const response = vcpList.map((vcp: VCP) => {
      return {
        uuid: uuid(),
        isFinishing: vcp.isFinishing,
        isWaiting: vcp.isWaiting,
        lastAction: vcp.lastAction,
        connectorIDs: vcp.connectorIDs,
        ...vcp.vcpOptions,
      };
    });

    reply.send({ message: `${vcpList.length} VCPs loaded`, data: response });
  } catch (error) {
    console.error("Error: " + error);

    reply.code(500).send({ message: "Unable to start VCPs" });
  }

  // run().catch(console.error);

  // reply.send({ message: response, vcps: vcpList });
};

// export const getChargePoints = async (
//   request: FastifyRequest,
//   reply: FastifyReply,
// ) => {
//   const chargePoints = [];

//   reply.send(chargePoints);
// };

// export const changeStatus = async (
//   request: FastifyRequest,
//   reply: FastifyReply,
// ) => {
//   const chargePoint = {
//     id: "1",
//     name: "Charge Point 1",
//     location: "Location 1",
//   };

//   reply.send(chargePoint);
// };

async function run(payload: StartChargePointsRequest) {
  const {
    idPrefix,
    count,
    sleepTime,
    startChance,
    testCharge,
    duration,
    randomDelay,
    isTwinGun,
    adminPort,
    adminPortIncrement,
  } = payload;

  const endpoint = process.env.WS_URL || "ws://127.0.0.1:9000";

  const tasks: Promise<void>[] = [];
  let adminWsPort = undefined;

  for (let i = 1; i <= count; i++) {
    if ((i === 1 || adminPortIncrement) && adminPort !== undefined) {
      adminWsPort = parseInt(adminPort) + (i - 1);
    } else {
      adminWsPort = undefined;
    }

    const vcp = new VCP({
      endpoint,
      chargePointId: idPrefix + i,
      ocppVersion: OcppVersion.OCPP_1_6,
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
