import express from "express";
import { createYoga, YogaInitialContext } from "graphql-yoga";
import { MongoClient, Db } from "mongodb";
import dotenv from "dotenv";
import { createServer } from "node:http";
import { createSchema } from "graphql-yoga";

import { GraphQLTypeManager } from "./graphqlTypes";
import { generateSchema } from "./schemaGenerator";
import { ResolverContext } from "./defaultResolvers";

// Extend YogaInitialContext with our db
interface GraphQLContext extends YogaInitialContext {
  db: Db;
}

// Load environment variables
dotenv.config();

const app = express();

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "basebase",
    graphql: "/graphql",
  });
});

// MongoDB setup
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("MONGODB_URI must be defined in environment variables");
}

const client = new MongoClient(MONGODB_URI);

async function getDynamicSchema() {
  const db = client.db();
  const typeManager = new GraphQLTypeManager(db);
  const types = await typeManager.getGraphQLTypes();
  const { typeDefs, resolvers } = generateSchema(types);
  return createSchema<GraphQLContext>({
    typeDefs,
    resolvers,
  });
}

async function startServer() {
  try {
    // Connect to MongoDB
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();

    // Create GraphQL Yoga instance with database context
    const yoga = createYoga<GraphQLContext>({
      schema: await getDynamicSchema(),
      context: { db },
    });

    // Create server
    const server = createServer(yoga);

    // Start the server
    const PORT = process.env.PORT || 4000;
    server.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}/graphql`);
    });
  } catch (error) {
    console.error("Error starting server:", error);
    await client.close();
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  await client.close();
  process.exit(0);
});

startServer();
