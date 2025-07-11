import express from "express";
import { createYoga, YogaInitialContext, MaskError } from "graphql-yoga";
import { MongoClient, Db, ObjectId } from "mongodb";
import dotenv from "dotenv";
import { createServer } from "node:http";
import { createSchema } from "graphql-yoga";

import { GraphQLField, GraphQLTypeManager } from "./graphqlTypes";
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
    currentProjectId?: string;
    [key: string]: any;
  } | null;
}

interface CreateTypeInput {
  name: string;
  description?: string;
  fields: GraphQLField[];
}

// Load environment variables
dotenv.config();

const Project = express();

// Health check endpoint
Project.get("/", (_, res) => {
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
    getMyProject: Project
  }
  
  extend type Mutation {

    # for authentication
    requestCode(phone: String!, name: String!): Boolean!
    verifyCode(phone: String!, code: String!, projectApiKey: String!): String

    # for project management
    generateProjectApiKey(projectId: String!): Project!
    revokeProjectApiKey(projectId: String!): Project!
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
    isList: Boolean
    
    "Whether this field is required (non-null)"
    isRequired: Boolean
    
    "For list fields, whether individual list items are required (non-null)"
    isListItemRequired: Boolean
    
    "Whether this field should have a unique index in MongoDB"
    unique: Boolean
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
    createFieldOnType(typeName: String!, field: GraphQLFieldInput!): Boolean!
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
        if (!context.currentUser || !context.currentUser.currentProjectId) {
          throw new Error("Authentication and project selection required");
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

        // Set default values for isList and isRequired
        const fieldsWithDefaults = input.fields.map((field) => ({
          ...field,
          isList: field.isList ?? false,
          isRequired: field.isRequired ?? false,
        }));

        // Validate field references
        const errors = await typeManager.validateFieldReferences({
          name: input.name,
          description: input.description,
          fields: fieldsWithDefaults,
          creator: new ObjectId(context.currentUser._id),
          projectId: new ObjectId(context.currentUser.currentProjectId),
        });

        if (errors.length > 0) {
          throw new Error(`Validation errors: ${errors.join(", ")}`);
        }

        await typeManager.addGraphQLType({
          name: input.name,
          description: input.description,
          fields: fieldsWithDefaults,
          creator: new ObjectId(context.currentUser._id),
          projectId: new ObjectId(context.currentUser.currentProjectId),
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
      { typeName, field }: { typeName: string; field: GraphQLField },
      context: GraphQLContext
    ) => {
      const isAuthorized = !!context.currentUser;
      let result;

      console.log(
        "createFieldOnType",
        context.currentUser,
        context.currentUser?.currentProjectId
      );

      try {
        if (!context.currentUser || !context.currentUser.currentProjectId) {
          throw new Error("Authentication and project selection required");
        }

        // Check for reserved field names "id" and "creator"
        if (field.name === "id") {
          throw new Error(
            'Field name "id" is reserved and automatically added to all types'
          );
        }

        if (field.name === "creator") {
          throw new Error(
            'Field name "creator" is reserved and automatically added to all types'
          );
        }

        const typeManager = new GraphQLTypeManager(context.db);

        // Check if type exists
        const existingType = await typeManager.getGraphQLTypeByName(typeName);
        if (!existingType) {
          throw new Error(`Type "${typeName}" not found`);
        }

        // Set default values for isList and isRequired
        const fieldWithDefaults = {
          ...field,
          isList: field.isList ?? false,
          isRequired: field.isRequired ?? false,
        };

        // Validate field references for the new field
        const errors = await typeManager.validateFieldReferences({
          name: typeName,
          fields: [fieldWithDefaults],
          creator: new ObjectId(context.currentUser._id),
          projectId: new ObjectId(context.currentUser.currentProjectId),
        });

        if (errors.length > 0) {
          throw new Error(`Validation errors: ${errors.join(", ")}`);
        }

        // Add field to type
        await typeManager.updateGraphQLType(typeName, {
          fields: [...existingType.fields, fieldWithDefaults],
        });
        result = true;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql(
          "createFieldOnType",
          { typeName, field },
          isAuthorized,
          result
        );
      }

      return result;
    },
  },
};

const authResolvers = {
  Query: {
    getMyProject: async (_: any, __: any, context: GraphQLContext) => {
      const isAuthorized = !!context.currentUser;
      let result;

      try {
        if (!isAuthorized || !context.currentUser) {
          throw new Error("Authentication required");
        }

        if (!context.currentUser.currentProjectId) {
          throw new Error("No project selected");
        }

        const project = await context.db.collection("projects").findOne({
          _id: new ObjectId(context.currentUser.currentProjectId),
        });

        if (!project) {
          throw new Error(
            `Project not found for id ${context.currentUser.currentProjectId}`
          );
        }

        result = {
          id: project._id.toString(),
          name: project.name,
          description: project.description || null,
          githubUrl: project.githubUrl || null,
          apiKey: project.apiKey || null,
          apiKeyExpiresAt: project.apiKeyExpiresAt || null,
          creator: project.creator.toString(),
        };
        return result;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql("getMyProject", {}, isAuthorized, result);
      }
    },

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
        projectApiKey,
      }: { phone: string; code: string; projectApiKey: string },
      context: GraphQLContext
    ) => {
      let result;
      try {
        result = await context.authService.verifyPhoneAndCreateUser(
          phone,
          code,
          projectApiKey
        );
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql(
          "verifyCode",
          { phone, code: "[REDACTED]", projectApiKey: "[REDACTED]" },
          true, // Auth not required for this mutation
          result
        );
      }
      return result;
    },

    generateProjectApiKey: async (
      _: any,
      { projectId }: { projectId: string },
      context: GraphQLContext
    ) => {
      const isAuthorized = !!context.currentUser;
      let result;

      try {
        if (!isAuthorized || !context.currentUser) {
          throw new Error("Authentication required");
        }

        // Find the Project and verify ownership
        const Project = await context.db.collection("projects").findOne({
          _id: new ObjectId(projectId),
        });

        if (!Project) {
          throw new Error(`Project not found for id ${projectId}`);
        }

        if (Project.creator.toString() !== context.currentUser._id.toString()) {
          throw new Error(
            "You don't have permission to generate an API key for this project"
          );
        }

        // Generate new API key
        const apiKey = await context.authService.generateApiKey();
        const apiKeyExpiresAt = new Date();
        apiKeyExpiresAt.setFullYear(apiKeyExpiresAt.getFullYear() + 1); // 1 year expiry

        // Update the Project with new API key
        const updatedProject = await context.db
          .collection("projects")
          .findOneAndUpdate(
            { _id: new ObjectId(projectId) },
            {
              $set: {
                apiKey,
                apiKeyExpiresAt,
                updatedAt: new Date(),
              },
            },
            { returnDocument: "after" }
          );

        if (!updatedProject) {
          throw new Error("Failed to update Project");
        }

        result = {
          ...updatedProject,
          id: updatedProject._id.toString(),
          creator: updatedProject.creator.toString(),
        };

        return result;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql(
          "generateProjectApiKey",
          { projectId },
          isAuthorized,
          result
        );
      }
    },

    revokeProjectApiKey: async (
      _: any,
      { projectId }: { projectId: string },
      context: GraphQLContext
    ) => {
      const isAuthorized = !!context.currentUser;
      let result;

      try {
        if (!isAuthorized || !context.currentUser) {
          throw new Error("Authentication required");
        }

        // Find the Project and verify ownership
        const Project = await context.db.collection("projects").findOne({
          _id: new ObjectId(projectId),
          creator: new ObjectId(context.currentUser._id),
        });

        if (!Project) {
          throw new Error(`Project not found for id ${projectId}`);
        }

        if (Project.creator.toString() !== context.currentUser._id.toString()) {
          throw new Error(
            "You don't have permission to generate an API key for this project"
          );
        }

        // Remove API key
        const updatedProject = await context.db
          .collection("projects")
          .findOneAndUpdate(
            { _id: new ObjectId(projectId) },
            {
              $set: {
                apiKey: null,
                apiKeyExpiresAt: null,
                updatedAt: new Date(),
              },
            },
            { returnDocument: "after" }
          );

        if (!updatedProject) {
          throw new Error("Failed to update Project");
        }

        result = {
          ...updatedProject,
          id: updatedProject._id.toString(),
          creator: updatedProject.creator.toString(),
        };

        return result;
      } catch (error) {
        result = error;
        throw error;
      } finally {
        logger.graphql(
          "revokeProjectApiKey",
          { projectId },
          isAuthorized,
          result
        );
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
  try {
    console.log("Starting schema generation...");

    const db = client.db();
    const typeManager = new GraphQLTypeManager(db);

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
        projectId: new ObjectId("000000000000000000000000"), // System-created type
      });
    }

    // Ensure Project type exists
    const projectType = await typeManager.getGraphQLTypeByName("Project");
    if (!projectType) {
      console.log("Creating default Project type...");
      await typeManager.addGraphQLType({
        name: "Project",
        description: "A project that contains types and data",
        fields: [
          { name: "name", type: "String", isList: false, isRequired: true },
          {
            name: "description",
            type: "String",
            isList: false,
            isRequired: false,
          },
          {
            name: "githubUrl",
            type: "String",
            isList: false,
            isRequired: false,
          },
          { name: "apiKey", type: "String", isList: false, isRequired: false },
          {
            name: "apiKeyExpiresAt",
            type: "Date",
            isList: false,
            isRequired: false,
          },
        ],
        creator: new ObjectId("000000000000000000000000"), // System-created type
        projectId: new ObjectId("000000000000000000000000"), // System-created type
      });
    }

    const types = await typeManager.getGraphQLTypes();
    console.log(
      "Loaded types from database:",
      types.map((t) => t.name)
    );

    console.log("Generating schema from types...");
    const { typeDefs: generatedTypeDefs, resolvers: generatedResolvers } =
      generateSchema(types);

    console.log("Generated typeDefs length:", generatedTypeDefs.length);
    console.log("Generated resolvers keys:", Object.keys(generatedResolvers));

    console.log("Creating GraphQL schema...");
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
  } catch (error) {
    console.error("Error in getDynamicSchema:", error);
    console.error(
      "Error stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );
    throw error;
  }
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
        try {
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
                currentUser.currentProjectId = auth.ProjectId;
              }
            }
          }
          // Note: currentUser can be null for unauthenticated requests like requestCode

          return {
            db,
            authService,
            authorizationService,
            currentUser,
          };
        } catch (error) {
          console.error("Error in context function:", error);
          console.error(
            "Error stack:",
            error instanceof Error ? error.stack : "No stack trace"
          );
          throw error;
        }
      },
      maskedErrors: {
        maskError: ((error: Error) => {
          console.error("GraphQL error occurred:", error);
          console.error("Error stack:", error.stack);

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
      try {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        console.log(`Request: ${req.method} ${url.pathname}`);

        if (url.pathname === "/") {
          // Handle health check with Express
          return Project(req, res);
        }

        // Handle GraphQL with Yoga
        return yoga(req, res);
      } catch (error) {
        console.error("Error handling request:", error);
        console.error(
          "Error stack:",
          error instanceof Error ? error.stack : "No stack trace"
        );

        // Send 500 error response
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Internal Server Error",
            message: error instanceof Error ? error.message : "Unknown error",
          })
        );
      }
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
