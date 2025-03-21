import "dotenv/config";
import fastify, { FastifyReply, FastifyRequest } from "fastify";
import {
  changeVcpStatus,
  getVcpStatus,
  startVcp,
  stopVcp,
} from "./controllers/chargePointController";
import {
  ChangeVcpStatusValidationSchema,
  StartVcpValidationSchema,
  StatusValidationSchema,
  StopVcpValidationSchema,
} from "./schema";
import fs from "fs";
import { authRoutes } from "./routes/auth";
import fastifyJwt from "@fastify/jwt";
import fastifyAuth from "@fastify/auth";

const app = fastify({
  logger: true,
});

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT) || 3000;

app.register(fastifyJwt, { secret: process.env.JWT_SECRET || "secret" });

app
  .decorate(
    "verifyJwt",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.send(err);
      }
    },
  )
  .register(fastifyAuth)
  .after(() => {
    app.post(
      "/api/vcp/start",
      {
        schema: {
          body: StartVcpValidationSchema,
        },
        preHandler: app.auth([app.verifyJwt]),
      },
      startVcp,
    );
    app.post(
      "/api/vcp/stop",
      { schema: { body: StopVcpValidationSchema } },
      stopVcp,
    );
    app.get(
      "/api/vcp/status",
      {
        schema: {
          querystring: StatusValidationSchema,
        },
      },
      getVcpStatus,
    );
    app.post(
      "/api/vcp/change-status",
      {
        schema: {
          body: ChangeVcpStatusValidationSchema,
        },
      },
      changeVcpStatus,
    );

    app.register(authRoutes);

    app.get(
      "/control",
      // { preHandler: app.auth([app.verifyJwt]) },
      async (request, reply) => {
        const stream = fs.readFileSync("./public/control.html").toString();

        reply.type("text/html").send(stream);
      },
    );
  });

const start = async () => {
  try {
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err);

    process.exit(1);
  }
};

start();
