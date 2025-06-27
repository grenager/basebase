import express from "express";
import { createYoga, YogaInitialContext, MaskError } from "graphql-yoga";
import { MongoClient, Db } from "mongodb";
import dotenv from "dotenv";
import { createServer } from "node:http";
import { createSchema } from "graphql-yoga";

import { GraphQLTypeManager, GraphQLFieldDefinition } from "./graphqlTypes";
import { generateSchema } from "./schemaGenerator";
import { AuthService } from "./services/auth";
import { logger } from "./utils/logger";

// Extend YogaInitialContext with our db and user
interface GraphQLContext extends YogaInitialContext {
  db: Db;
  authService: AuthService;
  currentUser: any | null;
}

interface createTypeInput {
  name: string;
  description?: string;
  fields: GraphQLFieldDefinition[];
}

interface AddFieldInput {
  typeName: string;
  field: GraphQLFieldDefinition;
}

// Load environment variables
dotenv.config();

const app = express();

// Health check endpoint
app.get("/", (_, res) => {
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

const client = new MongoClient(MONGODB_URI, {
  ssl: true,
  tls: true,
  tlsAllowInvalidCertificates: false,
  retryWrites: true,
  w: "majority",
});

// Authentication mutations and queries
const authTypeDefs = `
  extend type Query {
    getMyUser: User
  }
  
  extend type Mutation {
    requestCode(phone: String!, name: String!): Boolean!
    verifyCode(phone: String!, code: String!): String
  }
`;

const typeManagementTypeDefs = `
  input GraphQLFieldInput {
    name: String!
    type: String!
    isList: Boolean!
    isRequired: Boolean!
    isListItemRequired: Boolean
  }

  input createTypeInput {
    name: String!
    description: String
    fields: [GraphQLFieldInput!]!
  }

  input AddFieldInput {
    typeName: String!
    field: GraphQLFieldInput!
  }

  extend type Mutation {
    createType(input: createTypeInput!): Boolean!
    createFieldOnType(input: AddFieldInput!): Boolean!
  }
`;

const typeManagementResolvers = {
  Mutation: {
    createType: async (
      _: any,
      { input }: { input: createTypeInput },
      context: GraphQLContext
    ) => {
      const isAuthorized = !!context.currentUser;
      let result;

      try {
        if (!isAuthorized) {
          throw new Error("Authentication required");
        }

        const typeManager = new GraphQLTypeManager(context.db);

        // Validate field references
        const errors = await typeManager.validateFieldReferences({
          name: input.name,
          description: input.description,
          fields: input.fields,
        });

        if (errors.length > 0) {
          throw new Error(`Validation errors: ${errors.join(", ")}`);
        }

        await typeManager.addGraphQLType({
          name: input.name,
          description: input.description,
          fields: input.fields,
        });
        result = true;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql("createType", { input }, isAuthorized, result);
      }

      return result;
    },

    createFieldOnType: async (
      _: any,
      { input }: { input: AddFieldInput },
      context: GraphQLContext
    ) => {
      const isAuthorized = !!context.currentUser;
      let result;

      try {
        if (!isAuthorized) {
          throw new Error("Authentication required");
        }

        const typeManager = new GraphQLTypeManager(context.db);

        // Check if type exists
        const existingType = await typeManager.getGraphQLTypeByName(
          input.typeName
        );
        if (!existingType) {
          throw new Error(`Type "${input.typeName}" not found`);
        }

        // Validate the new field
        const errors = await typeManager.validateFieldReferences({
          name: existingType.name,
          fields: [...existingType.fields, input.field],
        });

        if (errors.length > 0) {
          throw new Error(`Validation errors: ${errors.join(", ")}`);
        }

        await typeManager.updateGraphQLType(input.typeName, {
          fields: [...existingType.fields, input.field],
        });
        result = true;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql("createFieldOnType", { input }, isAuthorized, result);
      }

      return result;
    },
  },
};

const authResolvers = {
  Query: {
    getMyUser: async (_: any, __: any, context: GraphQLContext) => {
      const isAuthorized = !!context.currentUser;
      let result;

      try {
        if (!isAuthorized) {
          throw new Error("Authentication required");
        }

        result = context.currentUser;
        // Transform MongoDB document to match GraphQL User type
        if (result) {
          result = {
            id: result._id.toString(),
            name: result.name,
            phone: result.phone,
            createdAt: result.createdAt,
          };
        }
        return result;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql("getMyUser", {}, isAuthorized, result);
      }
    },
  },

  Mutation: {
    requestCode: async (
      _: any,
      { phone, name }: { phone: string; name: string },
      context: GraphQLContext
    ) => {
      let result;
      try {
        result = await context.authService.requestCode(phone, name);
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql(
          "requestCode",
          { phone, name },
          true, // Auth not required for this mutation
          result
        );
      }
      return result;
    },

    verifyCode: async (
      _: any,
      { phone, code }: { phone: string; code: string },
      context: GraphQLContext
    ) => {
      let result;
      try {
        result = await context.authService.verifyPhoneAndCreateUser(
          phone,
          code
        );
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql(
          "verifyCode",
          { phone, code: "[REDACTED]" },
          true, // Auth not required for this mutation
          result
        );
      }
      return result;
    },
  },
};

async function getDynamicSchema() {
  const db = client.db();
  const typeManager = new GraphQLTypeManager(db);

  // Ensure User type exists
  const userType = await typeManager.getGraphQLTypeByName("User");
  if (!userType) {
    await typeManager.addGraphQLType({
      name: "User",
      description: "A user in the system",
      fields: [
        { name: "id", type: "ID", isList: false, isRequired: true },
        { name: "name", type: "String", isList: false, isRequired: true },
        { name: "phone", type: "String", isList: false, isRequired: true },
        { name: "createdAt", type: "Date", isList: false, isRequired: true },
      ],
    });
  }

  const types = await typeManager.getGraphQLTypes();
  const { typeDefs: generatedTypeDefs, resolvers: generatedResolvers } =
    generateSchema(types);

  return createSchema<GraphQLContext>({
    typeDefs: [generatedTypeDefs, authTypeDefs, typeManagementTypeDefs],
    resolvers: [generatedResolvers, authResolvers, typeManagementResolvers],
  });
}

async function startServer() {
  try {
    // Connect to MongoDB
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();

    // Initialize auth service
    const authService = new AuthService(db);
    await authService.initialize();

    // Create GraphQL Yoga instance with database context
    const yoga = createYoga<GraphQLContext>({
      schema: getDynamicSchema,
      context: async ({ request }) => {
        // Extract token from Authorization header
        const authHeader = request.headers.get("authorization");
        let currentUser = null;

        if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.split("Bearer ")[1];
          currentUser = await authService.getUserFromToken(token);
        }

        return {
          db,
          authService,
          currentUser,
        };
      },
      maskedErrors: {
        maskError: ((error: Error) => {
          // Handle authentication errors specifically
          if (error.message === "Authentication required") {
            return {
              message: error.message,
              extensions: {
                code: "UNAUTHENTICATED",
              },
            };
          }
          // Let other errors pass through as internal errors
          return error;
        }) as MaskError,
      },
    });

    // Create server that handles both Express and GraphQL
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);

      if (url.pathname === "/") {
        // Handle health check with Express
        return app(req, res);
      }

      // Handle GraphQL with Yoga
      return yoga(req, res);
    });

    // Start the server
    const PORT = process.env.PORT || 4000;
    server.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
      console.log(`GraphQL endpoint: http://localhost:${PORT}/graphql`);
      console.log(`Health check: http://localhost:${PORT}/`);
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
