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
  isList: boolean;
  isRequired: boolean;
  isListItemRequired?: boolean; // For [String!] vs [String]
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

    for (const customType of customTypes) {
      if (!(await this.typeExists(customType))) {
        errors.push(`Referenced type "${customType}" does not exist`);
      }
    }

    return errors;
  }
}

// Helper function to check if a type is a scalar
function isScalarType(type: string): boolean {
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

// Example usage:
/*
const typeManager = new GraphQLTypeManager(db);
await typeManager.initialize();

// Define a User type
await typeManager.addGraphQLType({
  name: 'User',
  description: 'A user in the system',
  fields: [
    { name: 'id', type: 'ID', isList: false, isRequired: true },
    { name: 'email', type: 'String', isList: false, isRequired: true },
    { name: 'name', type: 'String', isList: false, isRequired: true },
    { name: 'posts', type: 'Post', isList: true, isRequired: true, isListItemRequired: true }
  ]
});
*/
