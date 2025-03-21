import { FastifyInstance } from "fastify";
import { login, user } from "../controllers/authController";
import fs from "fs";
import { LoginValidationSchema } from "../schema";

export async function authRoutes(app: FastifyInstance) {
  app.get("/login", async (request, reply) => {
    const stream = fs.readFileSync("./public/login.html").toString();

    reply.type("text/html").send(stream);
  });

  app.post(
    "/api/auth/login",
    {
      schema: {
        body: LoginValidationSchema,
      },
    },
    login,
  );

  app.get("/api/auth/user", { preHandler: app.auth([app.verifyJwt]) }, user);
}
