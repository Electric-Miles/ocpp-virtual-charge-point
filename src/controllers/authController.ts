import { FastifyRequest, FastifyReply } from "fastify";
import { LoginRequestSchema } from "../schema";

const users = {
  password: "P@55W0rd0!!", // TODO: read from env
  users: [
    {
      first_name: "Chimezie",
      email: "chimezie@electricmiles.co.uk",
    },
  ],
};

export const login = async (
  request: FastifyRequest<{ Body: LoginRequestSchema }>,
  reply: FastifyReply,
) => {
  const { email, password } = request.body;

  if (email == "" || password == "") {
    return reply.status(401).send({
      status: "error",
      message: "Invalid username or password",
    });
  }

  if (password !== users.password) {
    return reply.status(401).send({
      status: "error",
      message: "Invalid username or password",
    });
  }

  const user = users.users.find((user) => user.email === email);

  if (!user) {
    return reply.status(401).send({
      status: "error",
      message: "Invalid username or password",
    });
  }

  const token = await reply.jwtSign(user);

  reply.setCookie("vcp_access_token", token, {
    path: "/",
    secure: true,
    httpOnly: true,
  });

  return reply.send({
    status: "success",
    message: "Logged in successfully",
    data: {
      access_token: token,
    },
  });
};

export async function logout(request: FastifyRequest, reply: FastifyReply) {
  reply.clearCookie("access_token");

  return reply.send({ status: "success", message: "Logged out successfully" });
}
