import express from "express";
import { createYoga, YogaInitialContext } from "graphql-yoga";
import { MongoClient, Db } from "mongodb";
import dotenv from "dotenv";
import { createServer } from "node:http";
import { createSchema } from "graphql-yoga";

import { GraphQLTypeManager, GraphQLFieldDefinition } from "./graphqlTypes";
import { generateSchema } from "./schemaGenerator";
import { AuthService } from "./services/auth";

// Extend YogaInitialContext with our db and user
interface GraphQLContext extends YogaInitialContext {
  db: Db;
  authService: AuthService;
  currentUser: any | null;
}

interface AddTypeInput {
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

const client = new MongoClient(MONGODB_URI);

// Authentication mutations
const authTypeDefs = `
  extend type Mutation {
    startPhoneVerification(phone: String!, name: String!): Boolean!
    verifyPhoneAndLogin(phone: String!, code: String!): String
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

  input AddTypeInput {
    name: String!
    description: String
    fields: [GraphQLFieldInput!]!
  }

  input AddFieldInput {
    typeName: String!
    field: GraphQLFieldInput!
  }

  extend type Mutation {
    addType(input: AddTypeInput!): Boolean!
    addFieldToType(input: AddFieldInput!): Boolean!
  }
`;

const typeManagementResolvers = {
  Mutation: {
    addType: async (
      _: any,
      { input }: { input: AddTypeInput },
      context: GraphQLContext
    ) => {
      if (!context.currentUser) {
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

      try {
        await typeManager.addGraphQLType({
          name: input.name,
          description: input.description,
          fields: input.fields,
        });
        return true;
      } catch (error) {
        console.error("Error adding type:", error);
        throw new Error("Failed to add type");
      }
    },

    addFieldToType: async (
      _: any,
      { input }: { input: AddFieldInput },
      context: GraphQLContext
    ) => {
      if (!context.currentUser) {
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

      try {
        await typeManager.updateGraphQLType(input.typeName, {
          fields: [...existingType.fields, input.field],
        });
        return true;
      } catch (error) {
        console.error("Error adding field to type:", error);
        throw new Error("Failed to add field to type");
      }
    },
  },
};

const authResolvers = {
  Mutation: {
    startPhoneVerification: async (
      _: any,
      { phone, name }: { phone: string; name: string },
      context: GraphQLContext
    ) => {
      return context.authService.startPhoneVerification(phone, name);
    },
    verifyPhoneAndLogin: async (
      _: any,
      { phone, code }: { phone: string; code: string },
      context: GraphQLContext
    ) => {
      return context.authService.verifyPhoneAndCreateUser(phone, code);
    },
  },
};

async function getDynamicSchema() {
  const db = client.db();
  const typeManager = new GraphQLTypeManager(db);
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
      schema: await getDynamicSchema(),
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
