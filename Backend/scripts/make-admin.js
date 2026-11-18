// Usage: npm run make-admin -- user@example.com
// Promotes an existing user to SuperAdmin (there is no API for the first admin).
import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { User } from "../src/models/User.model.js";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run make-admin -- <email>");
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOneAndUpdate({ email }, { role: "SuperAdmin" }, { returnDocument: "after" });
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exitCode = 1;
  } else {
    console.log(`${user.email} is now SuperAdmin. Log in again to continue.`);
  }
} finally {
  await mongoose.disconnect();
}
