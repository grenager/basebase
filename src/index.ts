import { createServer } from "node:http";
import express from "express";
import { createYoga } from "graphql-yoga";
import mongoose from "mongoose";
import dotenv from "dotenv";

import { schema } from "./schema";

// Load environment variables
dotenv.config();

const app = express();

// Create GraphQL Yoga instance
const yoga = createYoga({
  schema,
  graphiql: true, // Enable GraphiQL interface for development
});

// Mount GraphQL Yoga middleware
app.use("/graphql", yoga);

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("MONGODB_URI must be defined in environment variables");
}

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log("Connected to MongoDB");

    // Start the server
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}/graphql`);
    });
  })
  .catch((error) => {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  });
