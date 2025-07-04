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

const RESERVED_FIELD_NAMES = ["id", "creator", "createdAt", "updatedAt"];

// Import this from the GraphQL schema definition
export interface GraphQLField {
  name: string;
  type: GraphQLScalarType | string;
  description?: string;
  isList?: boolean;
  isRequired?: boolean;
  isListItemRequired?: boolean;
  unique?: boolean;
}

export interface GraphQLTypeDefinition {
  _id?: ObjectId;
  name: string;
  description?: string;
  fields: GraphQLField[];
  creator: ObjectId;
  projectId: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export class GraphQLTypeManager {
  private typesCollection: Collection<GraphQLTypeDefinition>;

  constructor(private db: Db) {
    this.typesCollection = db.collection("graphqlTypes");
  }

  private validateNoReservedFields(fields: GraphQLField[]): string[] {
    const errors: string[] = [];

    for (const field of fields) {
      if (RESERVED_FIELD_NAMES.includes(field.name)) {
        errors.push(
          `Field name "${field.name}" is reserved and automatically added to all types`
        );
      }
    }

    return errors;
  }

  // Create indexes if they don't exist
  async initialize(): Promise<void> {
    await this.typesCollection.createIndex({ name: 1 }, { unique: true });
  }

  // Add a new GraphQL type
  async addGraphQLType(
    type: Omit<GraphQLTypeDefinition, "createdAt" | "updatedAt" | "_id">
  ): Promise<void> {
    const now = new Date();

    const typeWithDefaults: GraphQLTypeDefinition = {
      ...type,
      fields: [...type.fields], // Keep user-defined fields only
      createdAt: now,
      updatedAt: now,
    };

    await this.typesCollection.insertOne(typeWithDefaults);

    // Create collection for the new type
    const collectionName = type.name.toLowerCase();
    const collection = this.db.collection(collectionName);

    // Create unique indexes for fields marked as unique
    const uniqueFields = type.fields.filter((field) => field.unique);
    for (const field of uniqueFields) {
      await collection.createIndex({ [field.name]: 1 }, { unique: true });
    }
  }

  // Get all GraphQL types
  async getGraphQLTypes(): Promise<GraphQLTypeDefinition[]> {
    return await this.typesCollection.find().toArray();
  }

  // Get a specific GraphQL type by name
  async getGraphQLTypeByName(
    name: string
  ): Promise<GraphQLTypeDefinition | null> {
    return await this.typesCollection.findOne({ name });
  }

  // Update an existing GraphQL type
  async updateGraphQLType(
    typeName: string,
    update: Partial<GraphQLTypeDefinition>
  ): Promise<void> {
    // Validate no reserved fields in update
    if (update.fields) {
      const errors = this.validateNoReservedFields(update.fields);
      if (errors.length > 0) {
        throw new Error(errors.join(", "));
      }
    }

    const now = new Date();
    await this.typesCollection.updateOne(
      { name: typeName },
      {
        $set: {
          ...update,
          updatedAt: now,
        },
      }
    );

    // If fields were updated, update indexes
    if (update.fields) {
      const collectionName = typeName.toLowerCase();
      const collection = this.db.collection(collectionName);

      // Create unique indexes for new unique fields
      const uniqueFields = update.fields.filter((field) => field.unique);
      for (const field of uniqueFields) {
        await collection.createIndex({ [field.name]: 1 }, { unique: true });
      }
    }
  }

  // Delete a GraphQL type
  async deleteGraphQLType(name: string): Promise<boolean> {
    const result = await this.typesCollection.deleteOne({ name });
    return result.deletedCount === 1;
  }

  // Check if a type exists
  async typeExists(name: string): Promise<boolean> {
    const count = await this.typesCollection.countDocuments({ name });
    return count > 0;
  }

  // Validate field references
  async validateFieldReferences(
    type: Omit<GraphQLTypeDefinition, "createdAt" | "updatedAt" | "_id">
  ): Promise<string[]> {
    const errors = this.validateNoReservedFields(type.fields);

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
  const isScalar = scalarTypes.includes(type as GraphQLScalarType);
  console.log(`Checking if ${type} is scalar:`, isScalar);
  return isScalar;
}

// Helper function to check if a type is a custom type (references another GraphQL type)
export function isCustomType(type: string): boolean {
  const isCustom = !isScalarType(type);
  console.log(`Checking if ${type} is custom type:`, isCustom);
  return isCustom;
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
