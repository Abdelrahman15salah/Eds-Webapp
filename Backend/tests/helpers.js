import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

let mongod;

export const startDb = async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
};

export const stopDb = async () => {
  await mongoose.disconnect();
  await mongod?.stop();
};

export const clearDb = async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );
};

export const cookieValue = (res, name) => {
  const line = (res.headers["set-cookie"] || []).find((c) => c.startsWith(`${name}=`));
  return line ? decodeURIComponent(line.split(";")[0].slice(name.length + 1)) : undefined;
};

export const rawCookie = (res, name) =>
  (res.headers["set-cookie"] || []).find((c) => c.startsWith(`${name}=`));

export const cookieHeader = (pairs) =>
  Object.entries(pairs)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");

export const validUser = (over = {}) => ({
  name: "Test User",
  email: "test@example.com",
  password: "Passw0rdOk",
  ...over,
});
