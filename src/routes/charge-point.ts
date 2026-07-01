import { FastifyInstance } from "fastify";
import {
    startVcp,
    stopVcp,
    getVcpStatus,
    getConnectorStatus,
    changeVcpStatus, sendCommand,
} from "../controllers/chargePointController";
import {
  StartVcpValidationSchema,
  StopVcpValidationSchema,
  StatusValidationSchema,
  ChangeVcpStatusValidationSchema,
  ConnectorStatusValidationSchema,
} from "../schema";

export async function chargePointRoutes(app: FastifyInstance) {
  app.post(
    "start",
    {
      schema: {
        body: StartVcpValidationSchema,
      },
      preHandler: app.auth([app.verifyJwt]),
    },
    startVcp,
  );
  app.post(
    "stop",
    {
      schema: { body: StopVcpValidationSchema },
      preHandler: app.auth([app.verifyJwt]),
    },
    stopVcp,
  );
  app.get(
    "status",
    {
      schema: {
        querystring: StatusValidationSchema,
      },
      preHandler: app.auth([app.verifyJwt]),
    },
    getVcpStatus,
  );
  app.post(
    "change-status",
    {
      schema: {
        body: ChangeVcpStatusValidationSchema,
      },
      preHandler: app.auth([app.verifyJwt]),
    },
    changeVcpStatus,
  );
  app.get(
    "connector-status",
    {
      schema: { querystring: ConnectorStatusValidationSchema },
      preHandler: app.auth([app.verifyJwt]),
    },
    getConnectorStatus,
  );
    app.post(
        "send-command",
        {
            schema: {
                body: ChangeVcpStatusValidationSchema,
            },
            preHandler: app.auth([app.verifyJwt]),
        },
        sendCommand,
    );
}
