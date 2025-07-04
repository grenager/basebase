/**
 * Schema Generator
 *
 * This module is responsible for dynamically generating a GraphQL schema from type definitions
 * stored in the database. It handles:
 *
 * 1. Generates GraphQL SDL from type definition documents
 *    - Converts database type definition documents stored in the graphqlTypes collection into GraphQL SDL
 *    - Handles scalar and object types
 *    - Manages list types and required/optional fields
 *    - Prevents conflicts with reserved field names
 *
 * 2. Adds default fields to every type
 *    - Every type (except User) automatically gets these fields:
 *      - id: ID!           - Unique identifier
 *      - creator: User!    - Reference to the creating user
 *      - createdAt: Date!  - Creation timestamp
 *      - updatedAt: Date!  - Last update timestamp
 *
 * 3. Generates CRUD operation methods for each type
 *    For each type, generates:
 *    - Queries:
 *      - get[Type](id: ID!): Type
 *      - get[Type]s(filter: JSON): [Type!]!
 *    - Mutations:
 *      - create[Type](input: TypeInput!): Type!
 *      - update[Type](id: ID!, input: TypeInput!): Type
 *      - delete[Type](id: ID!): Boolean!
 *
 * 4. Generates input types for mutations
 *    - Generates input types for mutations
 *    - Excludes default fields (id, creator, timestamps)
 *    - Handles nested types and references
 *
 * Usage:
 * ```typescript
 * const { typeDefs, resolvers } = generateSchema(types);
 * const schema = makeExecutableSchema({ typeDefs, resolvers });
 * ```
 */

import { GraphQLTypeDefinition, GraphQLField } from "./graphqlTypes";
import { ObjectId } from "mongodb";

// Custom scalar for Date type that serializes to ISO string
export const dateScalar = {
  serialize(value: Date): string {
    return value.toISOString();
  },
  parseValue(value: string): Date {
    return new Date(value);
  },
};

export const scalarResolvers = {
  Date: dateScalar,
  JSON: {
    serialize: (value: any) => value,
    parseValue: (value: any) => value,
  },
};

const RESERVED_FIELD_NAMES = ["id", "creator", "createdAt", "updatedAt"];

const DEFAULT_FIELDS: GraphQLField[] = [
  {
    name: "id",
    type: "ID",
    description: "Unique identifier",
    isList: false,
    isRequired: true,
  },
  {
    name: "creator",
    type: "User",
    description: "User who created this object",
    isList: false,
    isRequired: true,
  },
  {
    name: "createdAt",
    type: "Date",
    description: "When this object was created",
    isList: false,
    isRequired: true,
  },
  {
    name: "updatedAt",
    type: "Date",
    description: "When this object was last updated",
    isList: false,
    isRequired: true,
  },
];

function generateType(type: GraphQLTypeDefinition): string {
  try {
    console.log(
      `generateType: Processing type ${type.name} with ${type.fields.length} fields`
    );

    // Add default fields to all types, including User
    const allFields = [...DEFAULT_FIELDS, ...type.fields];

    const fields = allFields
      .map((field) => {
        let fieldType = field.type;
        if (field.isList) {
          fieldType = `[${fieldType}${field.isListItemRequired ? "!" : ""}]`;
        }
        if (field.isRequired) {
          fieldType = `${fieldType}!`;
        }

        const description = field.description
          ? `"""${field.description}"""\n  `
          : "";
        return `${description}${field.name}: ${fieldType}`;
      })
      .join("\n  ");

    const description = type.description ? `"""${type.description}"""\n` : "";
    const result = `${description}type ${type.name} {
  ${fields}
}`;

    console.log(`generateType: Successfully generated type ${type.name}`);
    return result;
  } catch (error) {
    console.error(`Error generating type ${type.name}:`, error);
    console.error(
      "Error stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );
    throw error;
  }
}

function generateInputType(type: GraphQLTypeDefinition): string {
  try {
    console.log(`generateInputType: Processing type ${type.name}`);

    const fields = type.fields
      .filter((field) => !RESERVED_FIELD_NAMES.includes(field.name)) // Exclude default fields from input
      .map((field) => {
        // For input types, convert object references to IDs
        let fieldType = field.type;
        if (
          !["ID", "String", "Int", "Float", "Boolean", "Date"].includes(
            fieldType
          )
        ) {
          fieldType = "ID"; // Convert object references to ID type for inputs
        }

        if (field.isList) {
          fieldType = `[${fieldType}${field.isListItemRequired ? "!" : ""}]`;
        }
        if (field.isRequired) {
          fieldType = `${fieldType}!`;
        }

        const description = field.description
          ? `"""${field.description}"""\n  `
          : "";
        return `${description}${field.name}: ${fieldType}`;
      })
      .join("\n  ");

    const result = `input ${type.name}Input {
  ${fields}
}`;

    console.log(
      `generateInputType: Successfully generated input type for ${type.name}`
    );
    return result;
  } catch (error) {
    console.error(`Error generating input type for ${type.name}:`, error);
    console.error(
      "Error stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );
    throw error;
  }
}

function generateQueryType(types: GraphQLTypeDefinition[]): string {
  try {
    console.log(`generateQueryType: Processing ${types.length} types`);

    const queries = types
      .map((type) => {
        const typeName = type.name;
        const uniqueFields = type.fields.filter((field) => field.unique);

        // Generate get{Type} query with all unique fields as optional parameters
        // For query parameters, always use ID type for object references
        const uniqueFieldParams = uniqueFields
          .map((field) => {
            // If the field type is not a scalar, use ID type for the parameter
            const paramType = [
              "ID",
              "String",
              "Int",
              "Float",
              "Boolean",
              "Date",
            ].includes(field.type)
              ? field.type
              : "ID";
            return `${field.name}: ${paramType}`;
          })
          .join(", ");

        const params = uniqueFieldParams
          ? `id: ID, ${uniqueFieldParams}`
          : "id: ID!";

        const baseQueries = [
          `"""Get a single ${typeName} by ID or any unique field"""\n  get${typeName}(${params}): ${typeName}`,
          `"""Get all ${typeName}s, optionally filtered"""\n  get${typeName}s(filter: JSON): [${typeName}!]!`,
        ];

        return baseQueries;
      })
      .flat()
      .join("\n\n  ");

    const result = `type Query {
  ${queries}
}`;

    console.log("generateQueryType: Successfully generated query type");
    return result;
  } catch (error) {
    console.error("Error generating query type:", error);
    console.error(
      "Error stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );
    throw error;
  }
}

function generateMutationType(types: GraphQLTypeDefinition[]): string {
  try {
    console.log(`generateMutationType: Processing ${types.length} types`);

    const mutations = types
      .map((type) => {
        const typeName = type.name;
        const baseFields = [
          `"""Create a new ${typeName}"""\n  create${typeName}(input: ${typeName}Input!): ${typeName}!`,
          `"""Update an existing ${typeName}"""\n  update${typeName}(id: ID!, input: ${typeName}Input!): ${typeName}!`,
          `"""Delete a ${typeName}"""\n  delete${typeName}(id: ID!): Boolean!`,
        ];

        // Add convenience mutations for array fields
        const arrayFields = type.fields
          .filter(
            (field) =>
              field.isList && !RESERVED_FIELD_NAMES.includes(field.name)
          )
          .map((field) => {
            const fieldNameCapitalized =
              field.name.charAt(0).toUpperCase() + field.name.slice(1);
            return [
              `"""Add an item to ${typeName}.${field.name}"""\n  add${typeName}${fieldNameCapitalized}(id: ID!, itemId: ID!): ${typeName}!`,
              `"""Remove an item from ${typeName}.${field.name}"""\n  remove${typeName}${fieldNameCapitalized}(id: ID!, itemId: ID!): ${typeName}!`,
            ];
          })
          .flat();

        return [...baseFields, ...arrayFields];
      })
      .flat()
      .join("\n\n  ");

    const result = `type Mutation {
  ${mutations}
}`;

    console.log("generateMutationType: Successfully generated mutation type");
    return result;
  } catch (error) {
    console.error("Error generating mutation type:", error);
    console.error(
      "Error stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );
    throw error;
  }
}

export interface SchemaGeneratorResult {
  typeDefs: string;
  resolvers: {
    Query: any;
    Mutation: any;
    [typeOrScalar: string]: any;
  };
}

export function generateSchema(
  types: GraphQLTypeDefinition[]
): SchemaGeneratorResult {
  try {
    console.log(
      "generateSchema: Starting with types:",
      types.map((t) => t.name)
    );

    const typeDefinitions = types.map(generateType).join("\n\n");
    console.log("generateSchema: Generated type definitions");

    const inputTypes = types.map(generateInputType).join("\n\n");
    console.log("generateSchema: Generated input types");

    const queryType = generateQueryType(types);
    console.log("generateSchema: Generated query type");

    const mutationType = generateMutationType(types);
    console.log("generateSchema: Generated mutation type");

    const typeDefs = `scalar Date
scalar JSON

${typeDefinitions}

${inputTypes}

${queryType}

${mutationType}`;

    console.log("generateSchema: Combined typeDefs, length:", typeDefs.length);

    // Combine resolvers from all types
    const typeResolvers = types.reduce(
      (acc: any, type) => {
        console.log(
          `generateSchema: Generating resolvers for type: ${type.name}`
        );
        const resolvers = generateResolvers(type);

        // Merge type-specific resolvers
        acc[type.name] = resolvers[type.name];

        // Merge Query resolvers
        acc.Query = { ...acc.Query, ...resolvers.Query };

        // Merge Mutation resolvers
        acc.Mutation = { ...acc.Mutation, ...resolvers.Mutation };

        return acc;
      },
      {
        Query: {},
        Mutation: {},
        ...scalarResolvers,
      }
    );

    console.log(
      "generateSchema: Final resolver keys:",
      Object.keys(typeResolvers)
    );

    return {
      typeDefs,
      resolvers: typeResolvers,
    };
  } catch (error) {
    console.error("Error in generateSchema:", error);
    console.error(
      "Error stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );
    throw error;
  }
}

export function generateResolvers(type: GraphQLTypeDefinition): any {
  try {
    console.log(`generateResolvers: Starting for type ${type.name}`);

    const typeName = type.name;
    const collectionName = `${typeName.toLowerCase()}s`;

    const resolvers: any = {
      // Type resolvers for default fields
      [typeName]: {
        id: (parent: any) => parent._id.toString(),
        creator: async (parent: any, _: any, context: any) => {
          if (!parent.creator) return null;
          const user = await context.db.collection("users").findOne({
            _id: new ObjectId(parent.creator),
          });
          return user ? { ...user, id: user._id.toString() } : null;
        },
      },
      Query: {
        [`get${typeName}`]: async (
          _: any,
          args: Record<string, any>,
          context: any
        ) => {
          if (!context.currentUser) {
            throw new Error("Authentication required");
          }

          // Get all unique fields for this type
          const uniqueFields = type.fields.filter((field) => field.unique);

          // Build query based on provided parameters
          const query: Record<string, any> = {};

          if (args.id) {
            query._id = new ObjectId(args.id);
          } else {
            // Check if any unique field was provided
            const providedUniqueField = uniqueFields.find(
              (field) => args[field.name] !== undefined
            );

            if (!providedUniqueField) {
              throw new Error(
                `Must provide either id or one of the unique fields: ${uniqueFields
                  .map((f) => f.name)
                  .join(", ")}`
              );
            }

            // Handle the case where the unique field references another type
            // In this case, the parameter is an ID but the field stores an ObjectId
            if (
              providedUniqueField.type !== "ID" &&
              !["String", "Int", "Float", "Boolean", "Date"].includes(
                providedUniqueField.type
              )
            ) {
              // Convert the ID parameter to ObjectId for object reference fields
              query[providedUniqueField.name] = new ObjectId(
                args[providedUniqueField.name]
              );
            } else {
              query[providedUniqueField.name] = args[providedUniqueField.name];
            }
          }

          const doc = await context.db
            .collection(collectionName)
            .findOne(query);
          return doc;
        },
        [`get${typeName}s`]: async (
          _: any,
          { filter = {} }: { filter: Record<string, any> },
          context: any
        ) => {
          if (!context.currentUser) {
            throw new Error("Authentication required");
          }

          const query = Object.entries(filter).reduce(
            (acc: any, [key, value]) => {
              // Handle ID fields by converting to ObjectId
              if (value && (key === "_id" || key.endsWith("Id"))) {
                acc[key] = new ObjectId(value as string);
              } else {
                acc[key] = value;
              }
              return acc;
            },
            {}
          );
          return await context.db
            .collection(collectionName)
            .find(query)
            .toArray();
        },
      },
      Mutation: {
        [`create${typeName}`]: async (
          _: any,
          { input }: { input: any },
          context: any
        ) => {
          if (!context.currentUser) {
            throw new Error("Authentication required");
          }

          // Convert ID strings to ObjectIds for references
          const processedInput = Object.entries(input).reduce(
            (acc: any, [key, value]) => {
              const field = type.fields.find((f) => f.name === key);
              if (!field) return acc;

              if (
                field.type !== "ID" &&
                !["String", "Int", "Float", "Boolean", "Date"].includes(
                  field.type
                )
              ) {
                // Handle arrays of references
                if (field.isList && Array.isArray(value)) {
                  acc[key] = value.map((id: string) => new ObjectId(id));
                }
                // Handle single references
                else if (value && typeof value === "string") {
                  acc[key] = new ObjectId(value);
                }
              } else {
                acc[key] = value;
              }
              return acc;
            },
            {}
          );

          const now = new Date();
          const doc = {
            ...processedInput,
            creator: new ObjectId(context.currentUser._id),
            createdAt: now,
            updatedAt: now,
          };

          const { insertedId } = await context.db
            .collection(collectionName)
            .insertOne(doc);
          return {
            ...doc,
            _id: insertedId,
          };
        },
        [`update${typeName}`]: async (
          _: any,
          { id, input }: { id: string; input: any },
          context: any
        ) => {
          if (!context.currentUser) {
            throw new Error("Authentication required");
          }

          // Convert ID strings to ObjectIds for references
          const processedInput = Object.entries(input).reduce(
            (acc: any, [key, value]) => {
              const field = type.fields.find((f) => f.name === key);
              if (!field) return acc;

              if (
                field.type !== "ID" &&
                !["String", "Int", "Float", "Boolean", "Date"].includes(
                  field.type
                )
              ) {
                // Handle arrays of references
                if (field.isList && Array.isArray(value)) {
                  acc[key] = value.map((id: string) => new ObjectId(id));
                }
                // Handle single references
                else if (value && typeof value === "string") {
                  acc[key] = new ObjectId(value);
                }
              } else {
                acc[key] = value;
              }
              return acc;
            },
            {}
          );

          const now = new Date();
          const result = await context.db
            .collection(collectionName)
            .findOneAndUpdate(
              { _id: new ObjectId(id) },
              {
                $set: {
                  ...processedInput,
                  updatedAt: now,
                },
              },
              { returnDocument: "after" }
            );

          return result.value;
        },
        [`delete${typeName}`]: async (
          _: any,
          { id }: { id: string },
          context: any
        ) => {
          if (!context.currentUser) {
            throw new Error("Authentication required");
          }

          const result = await context.db.collection(collectionName).deleteOne({
            _id: new ObjectId(id),
          });

          return result.deletedCount === 1;
        },
        // Add convenience mutations for array fields
        ...type.fields
          .filter(
            (field) =>
              field.isList && !RESERVED_FIELD_NAMES.includes(field.name)
          )
          .reduce((acc: any, field) => {
            const fieldNameCapitalized =
              field.name.charAt(0).toUpperCase() + field.name.slice(1);

            // Add item to array mutation
            acc[`add${typeName}${fieldNameCapitalized}`] = async (
              _: any,
              { id, itemId }: { id: string; itemId: string },
              context: any
            ) => {
              if (!context.currentUser) {
                throw new Error("Authentication required");
              }

              const result = await context.db
                .collection(collectionName)
                .findOneAndUpdate(
                  { _id: new ObjectId(id) },
                  {
                    $addToSet: { [field.name]: new ObjectId(itemId) },
                    $set: { updatedAt: new Date() },
                  },
                  { returnDocument: "after" }
                );

              return result.value;
            };

            // Remove item from array mutation
            acc[`remove${typeName}${fieldNameCapitalized}`] = async (
              _: any,
              { id, itemId }: { id: string; itemId: string },
              context: any
            ) => {
              if (!context.currentUser) {
                throw new Error("Authentication required");
              }

              const result = await context.db
                .collection(collectionName)
                .findOneAndUpdate(
                  { _id: new ObjectId(id) },
                  {
                    $pull: { [field.name]: new ObjectId(itemId) },
                    $set: { updatedAt: new Date() },
                  },
                  { returnDocument: "after" }
                );

              return result.value;
            };

            return acc;
          }, {}),
      },
    };

    // Add resolvers for object reference fields
    type.fields.forEach((field) => {
      if (
        !["ID", "String", "Int", "Float", "Boolean", "Date"].includes(
          field.type
        )
      ) {
        resolvers[typeName][field.name] = async (
          parent: any,
          _: any,
          context: any
        ) => {
          if (!parent[field.name]) return null;

          const collection = `${field.type.toLowerCase()}s`;

          // Handle array of references
          if (field.isList) {
            const ids = parent[field.name].map((id: any) =>
              id instanceof ObjectId ? id : new ObjectId(id)
            );
            const docs = await context.db
              .collection(collection)
              .find({ _id: { $in: ids } })
              .toArray();
            return docs.map((doc: any) => ({ ...doc, id: doc._id.toString() }));
          }

          // Handle single reference
          const id =
            parent[field.name] instanceof ObjectId
              ? parent[field.name]
              : new ObjectId(parent[field.name]);
          const doc = await context.db
            .collection(collection)
            .findOne({ _id: id });
          return doc ? { ...doc, id: doc._id.toString() } : null;
        };
      }
    });

    return resolvers;
  } catch (error) {
    console.error(`Error generating resolvers for type ${type.name}:`, error);
    console.error(
      "Error stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );
    throw error;
  }
}
