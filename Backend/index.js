import dotenv from "dotenv";
dotenv.config();
import { connectDB } from "./src/config/db.js";
import { createApp } from "./src/app.js";

const PORT = process.env.PORT;
await connectDB();
const app = createApp();

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
