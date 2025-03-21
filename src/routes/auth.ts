import { FastifyInstance } from "fastify";
import { login, logout } from "../controllers/authController";
import fs from "fs";
import { LoginValidationSchema } from "../schema";

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/api/auth/login",
    {
      schema: {
        body: LoginValidationSchema,
      },
    },
    login,
  );

  app.get("/login", async (request, reply) => {
    const stream = fs.readFileSync("./public/login.html").toString();

    reply.type("text/html").send(stream);
  });

  app.post(
    "/api/auth/logout",
    { preHandler: app.auth([app.verifyJwt]) },
    logout,
  );
}
