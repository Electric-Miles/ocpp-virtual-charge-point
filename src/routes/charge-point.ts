import { FastifyInstance } from "fastify";
import {
    startVcp,
    stopVcp,
    getVcpStatus,
    getConnectorStatus,
    changeVcpStatus, sendCommand,
    setChargingProfile,
    getDlmDeviceTypes,
    startDlmDevice,
    updateDlmDevice,
    stopDlmDevice,
    getDlmStatus,
} from "../controllers/chargePointController";
import {
  StartVcpValidationSchema,
  StopVcpValidationSchema,
  StatusValidationSchema,
  ChangeVcpStatusValidationSchema,
  ConnectorStatusValidationSchema,
  SetChargingProfileValidationSchema,
  StartDlmValidationSchema,
  UpdateDlmValidationSchema,
  StopDlmValidationSchema,
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
    app.post(
        "set-charging-profile",
        {
            schema: {
                body: SetChargingProfileValidationSchema,
            },
            preHandler: app.auth([app.verifyJwt]),
        },
        setChargingProfile,
    );
    app.get(
        "dlm/types",
        {
            preHandler: app.auth([app.verifyJwt]),
        },
        getDlmDeviceTypes,
    );
    app.get(
        "dlm/status",
        {
            preHandler: app.auth([app.verifyJwt]),
        },
        getDlmStatus,
    );
    app.post(
        "dlm/start",
        {
            schema: { body: StartDlmValidationSchema },
            preHandler: app.auth([app.verifyJwt]),
        },
        startDlmDevice,
    );
    app.post(
        "dlm/update",
        {
            schema: { body: UpdateDlmValidationSchema },
            preHandler: app.auth([app.verifyJwt]),
        },
        updateDlmDevice,
    );
    app.post(
        "dlm/stop",
        {
            schema: { body: StopDlmValidationSchema },
            preHandler: app.auth([app.verifyJwt]),
        },
        stopDlmDevice,
    );
}
