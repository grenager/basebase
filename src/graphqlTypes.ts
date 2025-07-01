import { Db, Collection, ObjectId } from "mongodb";

// Types for field definitions
export type GraphQLScalarType =
  | "ID"
  | "String"
  | "Int"
  | "Float"
  | "Boolean"
  | "JSON"
  | "Date";

export interface GraphQLFieldDefinition {
  name: string;
  type: GraphQLScalarType | string; // string for custom types
  description?: string; // Field description for GraphQL documentation
  isList: boolean;
  isRequired: boolean;
  isListItemRequired?: boolean; // For [String!] vs [String]
  refType?: string; // For ID fields, specifies the referenced type
}

export interface GraphQLTypeDefinition {
  _id?: ObjectId;
  name: string;
  description?: string;
  fields: GraphQLFieldDefinition[];
  createdAt: Date;
  updatedAt: Date;
}

export class GraphQLTypeManager {
  private collection: Collection<GraphQLTypeDefinition>;

  constructor(db: Db) {
    this.collection = db.collection("graphqlTypes");
  }

  // Create indexes if they don't exist
  async initialize(): Promise<void> {
    await this.collection.createIndex({ name: 1 }, { unique: true });
  }

  // Add a new GraphQL type
  async addGraphQLType(
    type: Omit<GraphQLTypeDefinition, "_id" | "createdAt" | "updatedAt">
  ): Promise<GraphQLTypeDefinition> {
    const now = new Date();
    const typeWithTimestamps = {
      ...type,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.collection.insertOne(typeWithTimestamps);
    return {
      _id: result.insertedId,
      ...typeWithTimestamps,
    };
  }

  // Get all GraphQL types
  async getGraphQLTypes(): Promise<GraphQLTypeDefinition[]> {
    return await this.collection.find().toArray();
  }

  // Get a specific GraphQL type by name
  async getGraphQLTypeByName(
    name: string
  ): Promise<GraphQLTypeDefinition | null> {
    return await this.collection.findOne({ name });
  }

  // Update an existing GraphQL type
  async updateGraphQLType(
    name: string,
    update: Partial<
      Omit<GraphQLTypeDefinition, "_id" | "name" | "createdAt" | "updatedAt">
    >
  ): Promise<GraphQLTypeDefinition | null> {
    const now = new Date();
    const result = await this.collection.findOneAndUpdate(
      { name },
      {
        $set: {
          ...update,
          updatedAt: now,
        },
      },
      { returnDocument: "after" }
    );
    return result;
  }

  // Delete a GraphQL type
  async deleteGraphQLType(name: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ name });
    return result.deletedCount === 1;
  }

  // Check if a type exists
  async typeExists(name: string): Promise<boolean> {
    const count = await this.collection.countDocuments({ name });
    return count > 0;
  }

  // Validate field references
  async validateFieldReferences(
    type: Omit<GraphQLTypeDefinition, "_id" | "createdAt" | "updatedAt">
  ): Promise<string[]> {
    const errors: string[] = [];
    const customTypes = new Set(
      type.fields
        .filter((field) => !isScalarType(field.type))
        .map((field) => field.type)
    );

    // Check custom type references
    for (const customType of customTypes) {
      if (!(await this.typeExists(customType))) {
        errors.push(`Referenced type "${customType}" does not exist`);
      }
    }

    // Check refType references
    const refTypes = new Set(
      type.fields
        .filter((field) => field.refType)
        .map((field) => field.refType!)
    );

    for (const refType of refTypes) {
      if (!(await this.typeExists(refType))) {
        errors.push(`Referenced type "${refType}" in refType does not exist`);
      }
    }

    return errors;
  }
}

// Helper function to check if a type is a scalar
export function isScalarType(type: string): boolean {
  const scalarTypes: GraphQLScalarType[] = [
    "ID",
    "String",
    "Int",
    "Float",
    "Boolean",
    "JSON",
    "Date",
  ];
  return scalarTypes.includes(type as GraphQLScalarType);
}

// Helper function to check if a type is a custom type (references another GraphQL type)
export function isCustomType(type: string): boolean {
  return !isScalarType(type);
}

// Example usage:
/*
const typeManager = new GraphQLTypeManager(db);
await typeManager.initialize();

// Define a User type
await typeManager.addGraphQLType({
  name: 'User',
  description: 'A user in the system',
  fields: [
    { name: 'id', type: 'ID', description: 'Unique user identifier', isList: false, isRequired: true },
    { name: 'email', type: 'String', description: 'User email address', isList: false, isRequired: true },
    { name: 'name', type: 'String', description: 'Full name of the user', isList: false, isRequired: true },
    { name: 'posts', type: 'Post', description: 'All posts authored by this user', isList: true, isRequired: true, isListItemRequired: true },
    { name: 'friends', type: 'User', description: 'List of friends', isList: true, isRequired: false, isListItemRequired: false }
  ]
});

// Define a Post type with foreign key to User
await typeManager.addGraphQLType({
  name: 'Post',
  description: 'A blog post',
  fields: [
    { name: 'id', type: 'ID', description: 'Unique post identifier', isList: false, isRequired: true },
    { name: 'title', type: 'String', description: 'Post title', isList: false, isRequired: true },
    { name: 'content', type: 'String', description: 'Post content in markdown', isList: false, isRequired: true },
    { name: 'author', type: 'User', description: 'The user who authored this post', isList: false, isRequired: true }
  ]
});

// When creating a Post:
// - GraphQL input expects: { title: "Hello", content: "...", author: "60d5ec49eb36d73a7c7b1234" }
// - MongoDB stores: { title: "Hello", content: "...", author: ObjectId("60d5ec49eb36d73a7c7b1234") }
// - GraphQL output returns: { id: "...", title: "Hello", content: "...", author: { id: "60d5ec49eb36d73a7c7b1234", name: "John", email: "..." } }
*/
