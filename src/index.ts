import express from "express";
import { createYoga, YogaInitialContext, MaskError } from "graphql-yoga";
import { MongoClient, Db, ObjectId } from "mongodb";
import dotenv from "dotenv";
import { createServer } from "node:http";
import { createSchema } from "graphql-yoga";

import { GraphQLTypeManager, GraphQLFieldDefinition } from "./graphqlTypes";
import { generateSchema } from "./schemaGenerator";
import { AuthService } from "./services/auth";
import { AuthorizationService } from "./services/authorization";
import { logger } from "./utils/logger";

// Extend YogaInitialContext with our db and user
interface GraphQLContext extends YogaInitialContext {
  db: Db;
  authService: AuthService;
  authorizationService: AuthorizationService;
  currentUser: {
    _id: ObjectId;
    name: string;
    phone: string;
    createdAt: Date;
    currentAppId?: string;
    [key: string]: any;
  } | null;
}

interface CreateTypeInput {
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
    getMyApps: [App!]!
  }
  
  extend type Mutation {
    requestCode(phone: String!, name: String!): Boolean!
    verifyCode(phone: String!, code: String!, appApiKey: String!): String
    createApp(name: String!, description: String, githubUrl: String!): App!
    generateAppApiKey(appId: String!): App!
    revokeAppApiKey(appId: String!): App!
  }
`;

const baseTypeDefs = `
scalar Date

type Query {
  _empty: String
}

type Mutation {
  _empty: String
}
`;

const typeManagementTypeDefs = `
  """
  Input type for defining a GraphQL field with its properties and metadata
  """
  input GraphQLFieldInput {
    "The name of the field"
    name: String!
    
    "The GraphQL type (ID, String, Int, Boolean, Date, or custom type name)"
    type: String!
    
    "Optional description that will appear in the GraphQL schema documentation"
    description: String
    
    "Whether this field returns a list/array of values"
    isList: Boolean!
    
    "Whether this field is required (non-null)"
    isRequired: Boolean!
    
    "For list fields, whether individual list items are required (non-null)"
    isListItemRequired: Boolean
    
    "For ID fields, specifies which type this ID references (foreign key relationship)"
    refType: String
  }

  """
  Input for creating a new GraphQL type with its fields
  """
  input CreateTypeInput {
    "The name of the new type (must be unique)"
    name: String!
    
    "Optional description for the type that will appear in schema documentation"
    description: String
    
    "Array of field definitions for this type"
    fields: [GraphQLFieldInput!]!
  }

  """
  Input for adding a new field to an existing GraphQL type
  """
  input AddFieldInput {
    "The name of the existing type to add the field to"
    typeName: String!
    
    "The field definition to add"
    field: GraphQLFieldInput!
  }

  extend type Mutation {
    """
    Creates a new GraphQL type with the specified fields.
    
    This mutation dynamically adds a new type to your GraphQL schema, complete with
    auto-generated CRUD operations (queries and mutations). The type becomes immediately
    available for use in your API.
    
    Requires authentication.
    """
    createType(input: CreateTypeInput!): Boolean!
    
    """
    Adds a new field to an existing GraphQL type.
    
    This mutation allows you to extend existing types with additional fields.
    All field references and foreign key relationships are validated before adding.
    
    Requires authentication.
    """
    createFieldOnType(input: AddFieldInput!): Boolean!
  }
`;

const authorizationTypeDefs = `
  """
  Authorization rule for managing access to resources
  """
  type AuthorizationRule {
    id: ID!
    name: String!
    description: String
    action: String!
    subject: String!
    conditions: String
    priority: Int!
    isActive: Boolean!
    createdAt: String!
    updatedAt: String!
  }

  """
  Input for creating an authorization rule
  """
  input CreateAuthorizationRuleInput {
    name: String!
    description: String
    action: String!
    subject: String!
    conditions: String
    priority: Int!
    isActive: Boolean!
  }

  extend type Query {
    """
    Get all authorization rules
    """
    getAuthorizationRules: [AuthorizationRule!]!
  }

  extend type Mutation {
    """
    Create a new authorization rule
    """
    createAuthorizationRule(input: CreateAuthorizationRuleInput!): AuthorizationRule!
    
    """
    Update an existing authorization rule
    """
    updateAuthorizationRule(name: String!, input: CreateAuthorizationRuleInput!): AuthorizationRule
    
    """
    Delete an authorization rule
    """
    deleteAuthorizationRule(name: String!): Boolean!
  }
`;

const typeManagementResolvers = {
  Mutation: {
    createType: async (
      _: any,
      { input }: { input: CreateTypeInput },
      context: GraphQLContext
    ) => {
      const isAuthorized = !!context.currentUser;
      let result;

      try {
        if (!isAuthorized) {
          throw new Error("Authentication required");
        }

        // Check for reserved field names "id" and "creator"
        const idField = input.fields.find((field) => field.name === "id");
        if (idField) {
          throw new Error(
            'Field name "id" is reserved and automatically added to all types'
          );
        }

        const creatorField = input.fields.find(
          (field) => field.name === "creator"
        );
        if (creatorField) {
          throw new Error(
            'Field name "creator" is reserved and automatically added to all types'
          );
        }

        const typeManager = new GraphQLTypeManager(context.db);

        // Validate field references
        const errors = await typeManager.validateFieldReferences({
          name: input.name,
          description: input.description,
          fields: input.fields,
          creator: new ObjectId(context.currentUser?._id),
        });

        if (errors.length > 0) {
          throw new Error(`Validation errors: ${errors.join(", ")}`);
        }

        await typeManager.addGraphQLType({
          name: input.name,
          description: input.description,
          fields: input.fields,
          creator: new ObjectId(context.currentUser?._id),
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

        // Check for reserved field names "id" and "creator"
        if (input.field.name === "id") {
          throw new Error(
            'Field name "id" is reserved and automatically added to all types'
          );
        }

        if (input.field.name === "creator") {
          throw new Error(
            'Field name "creator" is reserved and automatically added to all types'
          );
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
          description: existingType.description,
          fields: [...existingType.fields, input.field],
          creator: existingType.creator,
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
        if (!isAuthorized || !context.currentUser) {
          throw new Error("Authentication required");
        }

        result = {
          id: context.currentUser._id.toString(),
          name: context.currentUser.name,
          phone: context.currentUser.phone,
          createdAt: context.currentUser.createdAt,
          email: context.currentUser.email || null,
          profileImageUrl: context.currentUser.profileImageUrl || null,
        };
        return result;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql("getMyUser", {}, isAuthorized, result);
      }
    },

    getMyApps: async (_: any, __: any, context: GraphQLContext) => {
      const isAuthorized = !!context.currentUser;
      let result;

      try {
        if (!isAuthorized || !context.currentUser) {
          throw new Error("Authentication required");
        }

        const apps = await context.db
          .collection("apps")
          .find({
            creator: new ObjectId(context.currentUser._id),
          })
          .toArray();

        result = apps.map((app) => ({
          ...app,
          id: app._id.toString(),
          creator: app.creator.toString(),
        }));

        return result;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql("getMyApps", {}, isAuthorized, result);
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
      {
        phone,
        code,
        appApiKey,
      }: { phone: string; code: string; appApiKey: string },
      context: GraphQLContext
    ) => {
      let result;
      try {
        result = await context.authService.verifyPhoneAndCreateUser(
          phone,
          code,
          appApiKey
        );
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql(
          "verifyCode",
          { phone, code: "[REDACTED]", appApiKey: "[REDACTED]" },
          true, // Auth not required for this mutation
          result
        );
      }
      return result;
    },

    createApp: async (
      _: any,
      {
        name,
        description,
        githubUrl,
      }: { name: string; description?: string; githubUrl: string },
      context: GraphQLContext
    ) => {
      const isAuthorized = !!context.currentUser;
      let result;

      try {
        if (!isAuthorized || !context.currentUser) {
          throw new Error("Authentication required");
        }

        const now = new Date();
        const app = {
          name,
          description,
          githubUrl,
          creator: new ObjectId(context.currentUser._id),
          createdAt: now,
          updatedAt: now,
        };

        const { insertedId } = await context.db
          .collection("apps")
          .insertOne(app);

        // Generate initial API key
        const apiKey = await context.authService.generateApiKey();
        const apiKeyExpiresAt = new Date();
        apiKeyExpiresAt.setFullYear(apiKeyExpiresAt.getFullYear() + 1); // 1 year expiry

        const updatedApp = await context.db.collection("apps").findOneAndUpdate(
          { _id: insertedId },
          {
            $set: {
              apiKey,
              apiKeyExpiresAt,
            },
          },
          { returnDocument: "after" }
        );

        if (!updatedApp?.value) {
          throw new Error("Failed to update app");
        }

        result = {
          ...updatedApp.value,
          id: updatedApp.value._id.toString(),
          creator: updatedApp.value.creator.toString(),
        };

        return result;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql(
          "createApp",
          { name, description, githubUrl },
          isAuthorized,
          result
        );
      }
    },

    generateAppApiKey: async (
      _: any,
      { appId }: { appId: string },
      context: GraphQLContext
    ) => {
      const isAuthorized = !!context.currentUser;
      let result;

      try {
        if (!isAuthorized || !context.currentUser) {
          throw new Error("Authentication required");
        }

        // Find the app and verify ownership
        const app = await context.db.collection("apps").findOne({
          _id: new ObjectId(appId),
          creator: new ObjectId(context.currentUser._id),
        });

        if (!app) {
          throw new Error("App not found or you don't have permission");
        }

        // Generate new API key
        const apiKey = await context.authService.generateApiKey();
        const apiKeyExpiresAt = new Date();
        apiKeyExpiresAt.setFullYear(apiKeyExpiresAt.getFullYear() + 1); // 1 year expiry

        // Update the app with new API key
        const updatedApp = await context.db.collection("apps").findOneAndUpdate(
          { _id: new ObjectId(appId) },
          {
            $set: {
              apiKey,
              apiKeyExpiresAt,
              updatedAt: new Date(),
            },
          },
          { returnDocument: "after" }
        );

        if (!updatedApp?.value) {
          throw new Error("Failed to update app");
        }

        result = {
          ...updatedApp.value,
          id: updatedApp.value._id.toString(),
          creator: updatedApp.value.creator.toString(),
        };

        return result;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql("generateAppApiKey", { appId }, isAuthorized, result);
      }
    },

    revokeAppApiKey: async (
      _: any,
      { appId }: { appId: string },
      context: GraphQLContext
    ) => {
      const isAuthorized = !!context.currentUser;
      let result;

      try {
        if (!isAuthorized || !context.currentUser) {
          throw new Error("Authentication required");
        }

        // Find the app and verify ownership
        const app = await context.db.collection("apps").findOne({
          _id: new ObjectId(appId),
          creator: new ObjectId(context.currentUser._id),
        });

        if (!app) {
          throw new Error("App not found or you don't have permission");
        }

        // Remove API key
        const updatedApp = await context.db.collection("apps").findOneAndUpdate(
          { _id: new ObjectId(appId) },
          {
            $set: {
              apiKey: null,
              apiKeyExpiresAt: null,
              updatedAt: new Date(),
            },
          },
          { returnDocument: "after" }
        );

        if (!updatedApp?.value) {
          throw new Error("Failed to update app");
        }

        result = {
          ...updatedApp.value,
          id: updatedApp.value._id.toString(),
          creator: updatedApp.value.creator.toString(),
        };

        return result;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql("revokeAppApiKey", { appId }, isAuthorized, result);
      }
    },
  },
};

const authorizationResolvers = {
  Query: {
    getAuthorizationRules: async (_: any, __: any, context: GraphQLContext) => {
      const isAuthorized = !!context.currentUser;
      let result;

      try {
        if (!isAuthorized) {
          throw new Error("Authentication required");
        }

        const rules = await context.authorizationService.getRules();
        result = rules.map((rule) => ({
          id: rule._id?.toString(),
          name: rule.name,
          description: rule.description,
          action: rule.action,
          subject: rule.subject,
          conditions: rule.conditions ? JSON.stringify(rule.conditions) : null,
          priority: rule.priority,
          isActive: rule.isActive,
          createdAt: rule.createdAt.toISOString(),
          updatedAt: rule.updatedAt.toISOString(),
        }));
        return result;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql("getAuthorizationRules", {}, isAuthorized, result);
      }
    },
  },

  Mutation: {
    createAuthorizationRule: async (
      _: any,
      { input }: { input: any },
      context: GraphQLContext
    ) => {
      const isAuthorized = !!context.currentUser;
      let result;

      try {
        if (!isAuthorized) {
          throw new Error("Authentication required");
        }

        // Parse conditions string to object if provided
        const ruleInput = {
          ...input,
          conditions: input.conditions
            ? JSON.parse(input.conditions)
            : undefined,
        };

        const rule = await context.authorizationService.createRule(ruleInput);
        result = {
          id: rule._id?.toString(),
          name: rule.name,
          description: rule.description,
          action: rule.action,
          subject: rule.subject,
          conditions: rule.conditions ? JSON.stringify(rule.conditions) : null,
          priority: rule.priority,
          isActive: rule.isActive,
          createdAt: rule.createdAt.toISOString(),
          updatedAt: rule.updatedAt.toISOString(),
        };
        return result;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql(
          "createAuthorizationRule",
          { input },
          isAuthorized,
          result
        );
      }
    },

    updateAuthorizationRule: async (
      _: any,
      { name, input }: { name: string; input: any },
      context: GraphQLContext
    ) => {
      const isAuthorized = !!context.currentUser;
      let result;

      try {
        if (!isAuthorized) {
          throw new Error("Authentication required");
        }

        // Parse conditions string to object if provided
        const ruleInput = {
          ...input,
          conditions: input.conditions
            ? JSON.parse(input.conditions)
            : undefined,
        };

        const rule = await context.authorizationService.updateRule(
          name,
          ruleInput
        );
        if (!rule) return null;

        result = {
          id: rule._id?.toString(),
          name: rule.name,
          description: rule.description,
          action: rule.action,
          subject: rule.subject,
          conditions: rule.conditions ? JSON.stringify(rule.conditions) : null,
          priority: rule.priority,
          isActive: rule.isActive,
          createdAt: rule.createdAt.toISOString(),
          updatedAt: rule.updatedAt.toISOString(),
        };
        return result;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql(
          "updateAuthorizationRule",
          { name, input },
          isAuthorized,
          result
        );
      }
    },

    deleteAuthorizationRule: async (
      _: any,
      { name }: { name: string },
      context: GraphQLContext
    ) => {
      const isAuthorized = !!context.currentUser;
      let result;

      try {
        if (!isAuthorized) {
          throw new Error("Authentication required");
        }

        result = await context.authorizationService.deleteRule(name);
        return result;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql(
          "deleteAuthorizationRule",
          { name },
          isAuthorized,
          result
        );
      }
    },
  },
};

async function getDynamicSchema() {
  const db = client.db();
  const typeManager = new GraphQLTypeManager(db);

  console.log("Starting schema generation...");

  // Ensure User type exists
  const userType = await typeManager.getGraphQLTypeByName("User");
  if (!userType) {
    console.log("Creating default User type...");
    await typeManager.addGraphQLType({
      name: "User",
      description: "A user in the system",
      fields: [
        { name: "name", type: "String", isList: false, isRequired: true },
        { name: "phone", type: "String", isList: false, isRequired: true },
        { name: "email", type: "String", isList: false, isRequired: false },
        {
          name: "profileImageUrl",
          type: "String",
          isList: false,
          isRequired: false,
        },
      ],
      creator: new ObjectId("000000000000000000000000"), // System-created type
    });
  }

  // Ensure App type exists
  const appType = await typeManager.getGraphQLTypeByName("App");
  if (!appType) {
    console.log("Creating default App type...");
    await typeManager.addGraphQLType({
      name: "App",
      description: "An application in the system",
      fields: [
        { name: "name", type: "String", isList: false, isRequired: true },
        {
          name: "description",
          type: "String",
          isList: false,
          isRequired: false,
        },
        { name: "githubUrl", type: "String", isList: false, isRequired: true },
        { name: "apiKey", type: "String", isList: false, isRequired: false },
        {
          name: "apiKeyExpiresAt",
          type: "Date",
          isList: false,
          isRequired: false,
        },
      ],
      creator: new ObjectId("000000000000000000000000"), // System-created type
    });
  }

  const types = await typeManager.getGraphQLTypes();
  console.log(
    "Loaded types from database:",
    types.map((t) => t.name)
  );

  const { typeDefs: generatedTypeDefs, resolvers: generatedResolvers } =
    generateSchema(types);

  console.log("Base type definitions:", baseTypeDefs);
  console.log("Generated type definitions:", generatedTypeDefs);

  const schema = createSchema<GraphQLContext>({
    typeDefs: [
      baseTypeDefs,
      generatedTypeDefs,
      authTypeDefs,
      typeManagementTypeDefs,
      authorizationTypeDefs,
    ],
    resolvers: [
      generatedResolvers,
      authResolvers,
      typeManagementResolvers,
      authorizationResolvers,
    ],
  });

  console.log("Schema created successfully");
  return schema;
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

    // Initialize authorization service
    const authorizationService = new AuthorizationService(db);
    await authorizationService.initialize();

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
        } else if (authHeader?.startsWith("ApiKey ")) {
          const apiKey = authHeader.split("ApiKey ")[1];
          const auth = await authService.validateApiKey(apiKey);
          if (auth) {
            currentUser = await db.collection("users").findOne({
              _id: new ObjectId(auth.userId),
            });
            if (currentUser) {
              currentUser.currentAppId = auth.appId;
            }
          }
        }

        return {
          db,
          authService,
          authorizationService,
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
